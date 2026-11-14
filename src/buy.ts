import type { RecipeIngredient } from './db'
import { liquidProduct, unitInfo } from './fit'
import { formatBuy, packCount } from './list'
import { kitchenNumber } from './recipeText'
import { countedLine, lookupPack, soldSizes, type PackSize } from './packSizes'

/**
 * What to buy for a recipe line (#811): the layer between a recipe and a list.
 *
 * The recipe keeps its own words ("2 to 3 soup cans of broth"). Buying is a
 * different question: which size of package, and how many, covers the amount
 * with the least left over. The sizes come from the pack table
 * (packSizes.ts, `soldSizes`); a product the table doesn't know is left for
 * Refine, which asks the model with the amount attached.
 *
 * RULES.
 * - Buy for the top of a range (`quantityMax`): you can't un-buy at the stove.
 * - A can used as a measure ("soup can") is that can, filled: 10.5 fl oz.
 * - Least left over wins; a tie goes to fewer packages, then the smaller one.
 *   One size per line: a list row holds one pack, so no "1 carton + 1 can".
 * - Units compare only within a family, with two bridges: a liquid's bare "oz"
 *   is read as fluid ounces, and a dry good with a weight per cup (`perCup`)
 *   turns cups into ounces. Anything else is not guessed.
 */

/** A can a recipe measures with, in fl oz. "Soup can" is the condensed soup's 10.5 oz can. */
const MEASURE_CANS: Record<string, number> = { 'soup can': 10.5 }

export const SOUP_CAN = 'soup can'

function normUnit(u: string | undefined | null): string {
  return (u ?? '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/s$/, '')
}

/** fl oz in one of this measuring can, or null when the unit isn't one. */
export function measureCan(unit: string | undefined | null): number | null {
  return MEASURE_CANS[normUnit(unit)] ?? null
}

/** Containers and plain counts: the amount is a number of packages, not a measure. */
const CONTAINER_UNITS = new Set([
  'can', 'jar', 'block', 'package', 'pkg', 'pack', 'box', 'boxe', 'bag', 'bottle', 'carton',
  'tub', 'packet', 'envelope', 'container', 'pouch', 'tube', 'brick', 'loaf',
])

export interface BuyPlan {
  buyCount: number
  sizeAmount: number
  sizeUnit: string
  packaging: string
}

export interface BuyLine {
  /** What goes on the list, or null when nothing can be worked out yet. */
  plan: BuyPlan | null
  /** The sizes the product is sold in, for the review's size chips. */
  sizes: PackSize[]
  /** 'refine' when the table doesn't know this product: Refine can ask the model. */
  open?: 'refine'
}

/** The amount to buy for, before packages: the top of a range, scaled. */
export function buyQuantity(l: Pick<RecipeIngredient, 'quantity' | 'quantityMax'>, factor: number): number | null {
  // A synced or hand-edited range can arrive upside down: never buy below the recipe's own amount.
  const q = l.quantityMax != null && l.quantity != null ? Math.max(l.quantity, l.quantityMax) : (l.quantityMax ?? l.quantity)
  return q != null && q > 0 && factor > 0 ? q * factor : null
}

/**
 * The need in `size.unit`'s base (oz, fl oz or one), or null when it can't be
 * compared soundly. `liquid` and `perCup` are the two bridges between volume
 * and weight described above.
 */
function needIn(
  l: RecipeIngredient,
  q: number,
  size: PackSize,
  liquid: boolean,
  perCup: number | undefined,
): number | null {
  const target = unitInfo(size.unit)
  if (!target) return null
  // Volume in fl oz, or weight in oz, of what the line asks for.
  let have: { family: string; base: number } | null = null
  const can = measureCan(l.unit)
  const u = normUnit(l.unit)
  if (can != null) have = { family: 'volume', base: q * can }
  else if (CONTAINER_UNITS.has(u) || u === '' || u === 'whole' || u === 'each') {
    // Counted in packages: each one is the line's own size, or the table's size
    // for the container it names. A bare count with neither is not a measure.
    // A stated size is the package, always. An estimated one is only a copy of
    // what the table or a learned size said when it was filled, so the lookup
    // now wins (a learned size corrected from 10 to 9.8 oz must not make "1 jar"
    // need two), and it counts packages only on a line counted in them: "6
    // hamburger buns" with ≈ an 8 ct package is six buns, not six packages.
    const own = l.sizeAmount != null && l.sizeUnit ? { size: l.sizeAmount, unit: l.sizeUnit } : null
    const table =
      own && !l.sizeEstimated
        ? own
        : own
          ? countedLine(l) ? (lookupPack(l) ?? own) : null
          : CONTAINER_UNITS.has(u) ? lookupPack(l) : null
    const info = table && unitInfo(table.unit)
    if (table && info) have = { family: info.family, base: q * table.size * info.factor }
    // "2 eggs", "10 tortillas": pieces, against a package sized in pieces (12 ct).
    else if (!CONTAINER_UNITS.has(u) && target.family === 'count') have = { family: 'count', base: q }
    else return null
  } else {
    const info = unitInfo(l.unit)
    if (!info) return null
    have = { family: info.family, base: q * info.factor }
  }
  if (have.family === target.family) {
    // A liquid's "oz" on both sides is the same ounce; nothing to convert.
    return have.base / target.factor
  }
  if (have.family === 'volume' && target.family === 'weight') {
    if (liquid) return have.base / target.factor // fl oz read as oz
    if (perCup) return ((have.base / 8) * perCup) / target.factor
  }
  return null
}

/**
 * Least left over; ties go to fewer packages, then the smaller package. Each
 * entry's `need` is in its own size's unit (needIn), and totals compare in the
 * family's base (oz, fl oz, one): learned sizes can mix units (#814), a 10 oz
 * box beside a 1 lb bag, where the table's rules never do.
 */
function leastLeftOver(entries: Array<{ size: PackSize; need: number }>): BuyPlan | null {
  let best: { plan: BuyPlan; total: number; count: number; base: number } | null = null
  for (const { size, need } of entries) {
    const factor = unitInfo(size.unit)?.factor
    if (!factor || !(size.size > 0)) continue
    const base = size.size * factor
    // Half a percent of slack, so 2 × 10.5 oz against 21 oz is exactly 2.
    const count = packCount(need / size.size - 0.005)
    const total = count * base
    const better =
      !best ||
      total < best.total - 1e-9 ||
      (Math.abs(total - best.total) <= 1e-9 && (count < best.count || (count === best.count && base < best.base)))
    if (better) {
      best = { plan: { buyCount: count, sizeAmount: size.size, sizeUnit: size.unit, packaging: size.packaging }, total, count, base }
    }
  }
  return best?.plan ?? null
}

/**
 * What to buy for one recipe line at `factor` servings. Pure: the review sheet
 * shows it, and addRecipeToList uses the same answer.
 */
export function buyLine(l: RecipeIngredient, factor = 1, size?: PackSize): BuyLine {
  const sold = soldSizes(l)
  // A size the SOURCE stated ("2 (10 oz) cans") beats the table, as in #774: it
  // is the only size planned for, and it joins the chips if the table lacks it.
  const stated: PackSize | null =
    l.sizeAmount != null && l.sizeUnit && l.packaging && !l.sizeEstimated
      ? { size: l.sizeAmount, unit: l.sizeUnit, packaging: l.packaging }
      : null
  const table = sold?.sizes ?? []
  const sizes =
    stated && !table.some((s) => s.size === stated.size && s.unit === stated.unit && s.packaging === stated.packaging)
      ? [stated, ...table]
      : table
  const q = buyQuantity(l, factor)
  if (sold && q != null) {
    const liquid = liquidProduct(l.displayName, sizes[0]?.packaging)
    const pool = (size ? [size] : stated ? [stated] : sizes)
      .map((s) => {
        const need = needIn(l, q, s, liquid, sold.perCup)
        return need == null ? null : { size: s, need }
      })
      .filter((x): x is { size: PackSize; need: number } => x != null)
    if (pool.length) {
      const plan = leastLeftOver(pool)
      if (plan) return { plan, sizes }
    }
  }
  // The line's own pack (the recipe stated it, or Standardize filled it):
  // scale the count, and keep the pack. A range scales to its top.
  if (l.buyCount != null && l.sizeAmount != null && l.sizeUnit && l.packaging) {
    const top = l.quantityMax != null && l.quantity ? l.quantityMax / l.quantity : 1
    return {
      plan: { buyCount: packCount(l.buyCount * factor * top), sizeAmount: l.sizeAmount, sizeUnit: l.sizeUnit, packaging: l.packaging },
      sizes,
    }
  }
  // Loose produce and meat are bought by the pound or the piece: nothing to refine.
  const loose = l.section === 'produce' || l.section === 'meat'
  return { plan: null, sizes, open: q != null && !loose ? 'refine' : undefined }
}

/**
 * The Soup Can chip (#811). A liquid counted in cans ("2 cans broth") may mean
 * its own can or, in a casserole, the condensed soup's can used as a cup. The
 * review offers the other reading as one chip; tapping it returns the line
 * rewritten, and the review saves it to the recipe so it is asked once.
 * Null when the line is neither a liquid in plain cans nor in soup cans.
 */
export function soupCanToggle(l: RecipeIngredient): { on: boolean; line: RecipeIngredient } | null {
  const u = normUnit(l.unit)
  if (u === SOUP_CAN) {
    // Back to the product's own can: the table's size for it, marked as an estimate.
    const own = soldSizes(l)?.sizes.find((s) => s.packaging === 'can')
    return {
      on: true,
      line: own
        ? { ...l, unit: 'can', sizeAmount: own.size, sizeUnit: own.unit, packaging: 'can', buyCount: undefined, sizeEstimated: true }
        : { ...l, unit: 'can' },
    }
  }
  // A condensed soup is the can being measured WITH, never measured by it.
  if (u !== 'can' || !liquidProduct(l.displayName) || /\bsoup\b|\bcream of\b/i.test(l.displayName)) return null
  return {
    on: false,
    line: { ...l, unit: SOUP_CAN, buyCount: undefined, sizeAmount: undefined, sizeUnit: undefined, packaging: undefined, sizeEstimated: undefined },
  }
}

/** "2 × 14.5 oz can". */
export function planText(p: BuyPlan): string {
  return formatBuy(p)
}

/** The recipe's own amount, range and all: "2 to 3 soup cans", "⅔ cup". */
export function recipeAmount(
  l: Pick<RecipeIngredient, 'quantity' | 'quantityMax' | 'unit'>,
  factor = 1,
): string {
  if (l.quantity == null) return l.unit ?? ''
  const lo = kitchenNumber(l.quantity * factor)
  const hi = l.quantityMax != null ? kitchenNumber(l.quantityMax * factor) : null
  const top = l.quantityMax ?? l.quantity
  // "whole" marks a countable thing: "3 eggs" reads better than "3 whole eggs".
  const said = l.unit && l.unit !== 'whole' ? l.unit : ''
  const unit = said ? ' ' + (top * factor > 1 && measureCan(said) != null ? said.replace(/(can)$/i, '$1s') : said) : ''
  return `${hi ? `${lo} to ${hi}` : lo}${unit}`
}
