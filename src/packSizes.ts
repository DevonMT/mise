import type { RecipeIngredient } from './db'
import { packCount } from './list'

/**
 * Standard amounts and pack sizes for a recipe (#774).
 *
 * A recipe that says "1 can Rotel" or just "Velveeta" leaves you guessing in
 * the aisle. Since 2026-11-04 Mise fills that gap with the standard US pack
 * (a 10 oz can, a 32 oz block) and marks it as an estimate, reversing the
 * 2026-08-11 rule that a pack size was never invented. Spices and herbs with
 * no amount get an estimated tsp/tbsp the same way.
 *
 * ORDER. This table first, the model second. The table is a short list of
 * products whose standard size is well known, so where it has an answer it
 * beats a guess, including the parse model's own estimate. The model fills
 * what the table does not know (at parse time, and via /api/standardize when
 * Standardize is tapped with AI on). Without AI it is the table alone.
 *
 * RULES THAT MATTER.
 * - Only gaps are filled. A stated size, a stated amount, or an estimate
 *   already saved is never changed (Standardize can be tapped twice).
 * - A pack size goes only on a line counted in containers or whole things
 *   ("1 can", "2 blocks", "1 Velveeta", a bare "Velveeta"), never on a cooking
 *   measure: "8 oz Velveeta" is an amount, and "1 cup salsa" is Refine's job.
 * - Every filled field is flagged (`sizeEstimated`, `amountEstimated`) so the
 *   UI can mark it, and so editing the amount by hand can clear the mark.
 */

export interface PackSize {
  /** One package: 10 + "oz" in a "can". */
  size: number
  unit: string
  packaging: string
}

interface PackRule extends PackSize {
  match: RegExp
  /** A different size when the line names another container ("1 can broth" is 14.5 oz, a carton is 32). */
  alt?: Record<string, number>
}

/**
 * Ordered: the first match wins, so the specific spelling goes above the
 * general one (Rotel above diced tomatoes, refried above beans, sweetened
 * condensed milk above the condensed soups).
 */
const PACKS: PackRule[] = [
  // Tomatoes
  { match: /\brotel\b|diced tomatoes (and|&|with) (green )?chil/, size: 10, unit: 'oz', packaging: 'can' },
  { match: /\btomato paste\b/, size: 6, unit: 'oz', packaging: 'can' },
  { match: /\btomato sauce\b/, size: 15, unit: 'oz', packaging: 'can', alt: { can: 15 } },
  { match: /\b(crushed|whole peeled|whole|peeled|san marzano) tomatoes\b/, size: 28, unit: 'oz', packaging: 'can' },
  { match: /\b(diced|stewed|petite diced|fire roasted) tomatoes\b|\bcanned tomatoes\b/, size: 14.5, unit: 'oz', packaging: 'can' },
  // Cheese
  { match: /\bvelveeta\b|\bprocess(ed)? cheese( product)?\b/, size: 32, unit: 'oz', packaging: 'block' },
  { match: /\bcream cheese\b/, size: 8, unit: 'oz', packaging: 'block' },
  { match: /\bshredded\b.*\bcheese\b|\bcheese\b.*\bshredded\b/, size: 8, unit: 'oz', packaging: 'bag' },
  // Milk in cans (above the soups, which also say "condensed")
  { match: /\bsweetened condensed milk\b/, size: 14, unit: 'oz', packaging: 'can' },
  { match: /\bevaporated milk\b/, size: 12, unit: 'oz', packaging: 'can' },
  { match: /\bcoconut milk\b/, size: 13.5, unit: 'oz', packaging: 'can' },
  // Condensed soups
  { match: /\bcream of (mushroom|chicken|celery|potato|onion|shrimp)\b|\bcondensed\b.*\bsoup\b|\bcheddar cheese soup\b/, size: 10.5, unit: 'oz', packaging: 'can' },
  // Beans and other cans
  { match: /\brefried beans\b/, size: 16, unit: 'oz', packaging: 'can' },
  { match: /\b(black|pinto|kidney|cannellini|navy|great northern|white|garbanzo|butter|chili|baked|ranch style|red) beans\b|\bchickpeas\b/, size: 15, unit: 'oz', packaging: 'can' },
  { match: /\bcream(ed|-style)? corn\b/, size: 14.75, unit: 'oz', packaging: 'can' },
  { match: /\b(whole kernel|canned|sweet) corn\b/, size: 15.25, unit: 'oz', packaging: 'can' },
  { match: /\b(diced |chopped )?green chil(e|i|ies|es)\b/, size: 4, unit: 'oz', packaging: 'can' },
  { match: /\bchipotles?\b.*\badobo\b/, size: 7, unit: 'oz', packaging: 'can' },
  { match: /\benchilada sauce\b/, size: 10, unit: 'oz', packaging: 'can' },
  { match: /\bpumpkin puree\b|\b(canned|pure) pumpkin\b/, size: 15, unit: 'oz', packaging: 'can' },
  { match: /(?<!(fresh|ahi|sushi[- ]grade|seared) )\btuna\b(?! (steaks?|fillets?|loin|tartare|poke))/, size: 5, unit: 'oz', packaging: 'can' },
  { match: /\b(chicken|beef|vegetable|veggie|bone) (broth|stock)\b|^(broth|stock) \|/, size: 32, unit: 'oz', packaging: 'carton', alt: { can: 14.5 } },
  // Jars and tubs
  { match: /\bsalsa\b|\bqueso dip\b/, size: 16, unit: 'oz', packaging: 'jar' },
  { match: /\b(marinara|pasta sauce|spaghetti sauce)\b/, size: 24, unit: 'oz', packaging: 'jar' },
  { match: /\bsour cream\b/, size: 16, unit: 'oz', packaging: 'tub' },
  { match: /\b(cool whip|whipped topping)\b/, size: 8, unit: 'oz', packaging: 'tub' },
  // Refrigerated dough
  { match: /\bcrescent( roll)?s?\b/, size: 8, unit: 'oz', packaging: 'can' },
  { match: /\b(refrigerated )?biscuit dough\b|\bcanned biscuits\b/, size: 16.3, unit: 'oz', packaging: 'can' },
  // Boxes, bags and packets
  { match: /\bfrozen (chopped )?spinach\b/, size: 10, unit: 'oz', packaging: 'box' },
  { match: /\bcake mix\b/, size: 15.25, unit: 'oz', packaging: 'box' },
  { match: /\b(instant )?pudding mix\b|\binstant pudding\b/, size: 3.4, unit: 'oz', packaging: 'box' },
  { match: /\bchocolate chips\b/, size: 12, unit: 'oz', packaging: 'bag' },
  { match: /\btortilla chips\b/, size: 13, unit: 'oz', packaging: 'bag' },
  { match: /\b(taco|ranch|fajita|chili|onion soup|italian dressing|gravy) (seasoning|mix|dressing mix|soup mix)\b/, size: 1, unit: 'oz', packaging: 'packet' },
  { match: /\b(spaghetti|penne|rigatoni|elbow macaroni|macaroni|fettuccine|linguine|rotini|ziti|egg noodles|lasagna noodles|pasta)\b/, size: 16, unit: 'oz', packaging: 'box' },
]

/** Container words a recipe counts in. "1 block Velveeta", "2 cans". */
const CONTAINERS: Record<string, string> = {
  can: 'can', cans: 'can', jar: 'jar', jars: 'jar', block: 'block', blocks: 'block',
  package: 'package', packages: 'package', pkg: 'package', pkgs: 'package', pack: 'package',
  box: 'box', boxes: 'box', bag: 'bag', bags: 'bag', bottle: 'bottle', bottles: 'bottle',
  carton: 'carton', cartons: 'carton', tub: 'tub', tubs: 'tub', packet: 'packet', packets: 'packet',
  envelope: 'packet', envelopes: 'packet', container: 'container', containers: 'container',
  pouch: 'pouch', pouches: 'pouch', tube: 'tube', tubes: 'tube', brick: 'block', loaf: 'block',
}
/** A count of whole things, the same as no unit ("1 Velveeta"). */
const COUNTS = new Set(['', 'whole', 'each', 'ea', 'ct', 'count', 'piece', 'pieces', 'item', 'items'])

/**
 * Amounts for a spice or herb the recipe names without one. Deliberately
 * modest: an estimate that is a little low is tasted and adjusted; one that is
 * high has already gone in. Ordered, first match wins.
 */
const AMOUNTS: Array<{ match: RegExp; quantity: number; unit: string; fresh?: boolean }> = [
  { match: /\bred pepper flakes\b|\bcrushed red pepper\b|\bchil(e|i) flakes\b/, quantity: 0.5, unit: 'tsp' },
  { match: /\bcayenne\b/, quantity: 0.25, unit: 'tsp' },
  { match: /\bchil(i|e) powder\b|\bcurry powder\b|\btaco seasoning\b/, quantity: 1, unit: 'tbsp' },
  { match: /\b(smoked )?paprika\b/, quantity: 1, unit: 'tsp' },
  { match: /\b(ground )?cumin\b/, quantity: 1, unit: 'tsp' },
  { match: /\bgarlic powder\b|\bonion powder\b|\bgarlic salt\b|\bmustard powder\b|\bdry mustard\b/, quantity: 1, unit: 'tsp' },
  { match: /\b(ground )?(cinnamon|ginger|turmeric|coriander)\b/, quantity: 1, unit: 'tsp' },
  { match: /\b(ground )?(nutmeg|cloves|allspice|cardamom)\b/, quantity: 0.25, unit: 'tsp' },
  { match: /\bitalian seasoning\b|\bcajun seasoning\b|\bcreole seasoning\b|\bold bay\b|\bseasoning salt\b|\bseasoned salt\b|\bherbes de provence\b/, quantity: 1, unit: 'tsp' },
  { match: /\bbay lea(f|ves)\b/, quantity: 2, unit: 'whole' },
  // One line for both, above either alone, so the salt is not lost.
  { match: /\bsalt (and|&) (black )?pepper\b/, quantity: 0.5, unit: 'tsp' },
  { match: /\b(black |white )?pepper(corns)?\b/, quantity: 0.25, unit: 'tsp' },
  { match: /\b(kosher |sea |table )?salt\b/, quantity: 0.5, unit: 'tsp' },
  // Herbs: fresh ones are chopped by the tablespoon, dried by the teaspoon.
  { match: /\b(cilantro|parsley|basil|dill|mint|chives|thyme|oregano|rosemary|sage|tarragon|marjoram)\b/, quantity: 1, unit: 'tsp', fresh: true },
]

/** Words that mean the line is not the spice itself: "bell pepper", "garlic cloves". */
const NOT_A_SPICE = /\b(bell|jalape\w*|poblano|serrano|habanero|banana|anaheim|sweet|hot|chipotle|roasted red) peppers?\b|(?<!crushed )\b(green|red|yellow|orange) pepper\b(?! flakes)|\bpeppers\b|\bgarlic cloves?\b|\bcloves? (of )?garlic\b|\bpeppercorn sauce\b|\bpepper jack\b|\bsalted butter\b|\bsalt pork\b|\bpickles?\b|\bsausages?\b|\bginger (ale|beer)\b|\bgingersnaps?\b|\b(cinnamon|sweet) rolls?\b|\bcinnamon (sticks?|sugar|toast|bread)\b|\bmint (chocolate|chips|ice cream)\b|\bbasil pesto\b|\bpesto\b/

/** Lowercase, accents and trademarks gone, "Ro-Tel" as "rotel". */
function norm(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[®™©]/g, '')
    .toLowerCase()
    .replace(/\bro-?tel\b/g, 'rotel')
    .replace(/\s+/g, ' ')
    .trim()
}

type Line = Pick<RecipeIngredient, 'displayName' | 'canonicalKey' | 'section'> &
  Partial<Pick<RecipeIngredient, 'quantity' | 'unit' | 'buyCount' | 'sizeAmount' | 'sizeUnit' | 'packaging' | 'sizeEstimated' | 'amountEstimated'>>

const text = (l: Pick<Line, 'displayName' | 'canonicalKey'>) => norm(`${l.displayName} | ${l.canonicalKey ?? ''}`)
const unitOf = (l: Pick<Line, 'unit'>) => norm(l.unit ?? '')

/**
 * The line counts containers ("2 cans"), or is one bare thing ("Velveeta",
 * "1 Velveeta"): a pack size can go on it. A count of more than one with no
 * container ("12 lasagna noodles", "8 crescent rolls") counts PIECES, not
 * packages, so it gets none: 12 noodles is not 12 boxes.
 */
export function countedLine(l: Pick<Line, 'unit' | 'quantity'>): boolean {
  const u = unitOf(l)
  if (u in CONTAINERS) return true
  return COUNTS.has(u) && (l.quantity == null || l.quantity <= 1)
}

/** No package chosen: no count, no size, no container. */
export function hasPack(l: Pick<Line, 'buyCount' | 'sizeAmount' | 'packaging'>): boolean {
  return l.buyCount != null || l.sizeAmount != null || !!l.packaging?.trim()
}

/** A line that could carry a standard pack size but has none. */
export function needsSize(l: Line): boolean {
  return !hasPack(l) && countedLine(l)
}

/** A line with no amount at all. */
export function needsAmount(l: Line): boolean {
  return l.quantity == null
}

/** The table's standard pack for this line, or null. The container the line names picks an `alt` size. */
export function lookupPack(l: Line): PackSize | null {
  const t = text(l)
  const said = CONTAINERS[unitOf(l)]
  for (const r of PACKS) {
    if (!r.match.test(t)) continue
    const size = (said ? r.alt?.[said] : undefined) ?? r.size
    return { size, unit: r.unit, packaging: said && said !== 'container' ? said : r.packaging }
  }
  return null
}

/** The table's estimated amount for a spice or herb with none, or null. */
export function lookupAmount(l: Line): { quantity: number; unit: string } | null {
  const t = text(l)
  if (NOT_A_SPICE.test(t)) return null
  for (const a of AMOUNTS) {
    if (!a.match.test(t)) continue
    // A fresh herb (filed with produce) is chopped by the tablespoon.
    if (a.fresh && l.section === 'produce') return { quantity: 2, unit: 'tbsp' }
    return { quantity: a.quantity, unit: a.unit }
  }
  return null
}

/** What a model estimated for one line. Anything can be null or nonsense: it is checked before use. */
export interface Estimate {
  quantity?: number | null
  unit?: string | null
  buyCount?: number | null
  sizeAmount?: number | null
  sizeUnit?: string | null
  packaging?: string | null
}

const goodNum = (n: unknown, max: number): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= max
const goodWord = (s: unknown): s is string =>
  typeof s === 'string' && s.trim().length > 0 && s.trim().length <= 20 && !/[\p{Cc}<>{}]/u.test(s)

/** Put a pack on a line that has none: the count follows the line's own count of containers. */
function withPack<T extends Line>(l: T, p: PackSize, buyCount?: number | null): T {
  const n = buyCount ?? (l.quantity != null && l.quantity > 0 ? packCount(l.quantity) : 1)
  const out: T = { ...l, buyCount: n, sizeAmount: p.size, sizeUnit: p.unit, packaging: p.packaging, sizeEstimated: true }
  // A bare "Velveeta" is one of them, counted in its package.
  if (l.quantity == null) Object.assign(out, { quantity: 1, unit: p.packaging, amountEstimated: true })
  return out
}

/**
 * Fill a line's gaps from the table. Never changes a field that is set.
 * Returns the line unchanged (same object) when there was nothing to fill.
 */
export function fillFromTable<T extends Line>(l: T): T {
  let out = l
  if (needsSize(out)) {
    const p = lookupPack(out)
    if (p) out = withPack(out, p)
  }
  if (needsAmount(out)) {
    const a = lookupAmount(out)
    if (a) out = { ...out, quantity: a.quantity, unit: a.unit, amountEstimated: true }
  }
  return out
}

/**
 * Fill a line's remaining gaps from a model's estimate, gaps only, after the
 * table. Each value is checked: a size needs a number and a unit, an amount a
 * positive number; anything else is dropped rather than trusted.
 */
export function mergeEstimate<T extends Line>(l: T, e: Estimate | undefined): T {
  if (!e) return l
  let out = l
  if (needsAmount(out) && goodNum(e.quantity, 1000)) {
    const unit = e.unit == null ? undefined : goodWord(e.unit) ? e.unit.trim() : null
    if (unit !== null) out = { ...out, quantity: e.quantity, unit, amountEstimated: true }
  }
  if (needsSize(out) && goodNum(e.sizeAmount, 1000) && goodWord(e.sizeUnit)) {
    const packaging = goodWord(e.packaging) ? e.packaging.trim().toLowerCase() : CONTAINERS[unitOf(out)] ?? 'package'
    const count = goodNum(e.buyCount, 50) ? Math.ceil(e.buyCount) : null
    out = withPack(out, { size: e.sizeAmount, unit: e.sizeUnit.trim(), packaging }, count)
  }
  return out
}

/**
 * At parse time: the model has already estimated (flagged) where it could. The
 * table still goes first, so a table hit replaces the model's estimated size;
 * a size the source stated (not flagged) is kept. Amounts the model estimated
 * stay, because it saw the recipe's yield and the table did not.
 */
export function standardizeParsed<T extends Line>(l: T): T {
  if (l.sizeEstimated && lookupPack(l)) {
    l = { ...l, buyCount: undefined, sizeAmount: undefined, sizeUnit: undefined, packaging: undefined, sizeEstimated: undefined }
  }
  return fillFromTable(l)
}

/**
 * The lines a model is asked about on Standardize, after the table: no amount
 * at all, or counted in a named container ("1 jar harissa") with no size. A
 * line counted in whole things ("2 onions") is not asked about: it is almost
 * always loose produce, and only the table claims the exceptions ("1 Velveeta").
 */
export function openGaps(lines: Line[]): number[] {
  const out: number[] = []
  lines.forEach((l, i) => {
    if (needsAmount(l) || (needsSize(l) && unitOf(l) in CONTAINERS)) out.push(i)
  })
  return out
}

/** Whether Standardize has anything to do: the table would fill a line, or (with AI) a gap is left for the model. */
export function canStandardize(lines: Line[], ai: boolean): boolean {
  if (lines.some((l) => fillFromTable(l) !== l)) return true
  return ai && openGaps(lines).length > 0
}

/** How many lines differ between two versions of the same list (Standardize's toast). */
export function changedCount(before: Line[], after: Line[]): number {
  let n = 0
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) n++
  return n
}
