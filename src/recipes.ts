import { db, canonicalize, type Recipe, type Item } from './db'
import { addItem, fallsOn, packCount, startOfDay } from './list'
import { getStapleKeys, type ParseResult } from './parse'

const KNOWN_UNITS = new Set([
  'cup', 'cups', 'tbsp', 'tsp', 'oz', 'lb', 'lbs', 'g', 'kg', 'ml', 'l',
  'clove', 'cloves', 'can', 'cans', 'bunch', 'pkg', 'stick', 'sticks',
  'whole', 'dozen', 'pinch', 'slice', 'slices', 'quart', 'pint', 'gal',
])

/** Best-effort local parse of manually-typed ingredient lines (no AI). */
export function parseManualIngredients(text: string): Recipe['ingredients'] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      let quantity: number | undefined
      let unit: string | undefined
      let name = line
      const m = line.match(/^(\d+(?:\.\d+)?|\d+\/\d+)\s+(.*)$/)
      if (m) {
        quantity = m[1].includes('/')
          ? Number(m[1].split('/')[0]) / Number(m[1].split('/')[1])
          : Number(m[1])
        let rest = m[2]
        const words = rest.split(/\s+/)
        if (words.length > 1 && KNOWN_UNITS.has(words[0].toLowerCase())) {
          unit = words[0]
          rest = words.slice(1).join(' ')
        }
        name = rest
      }
      return {
        displayName: name,
        canonicalKey: canonicalize(name),
        quantity: quantity != null && Number.isFinite(quantity) ? quantity : undefined,
        unit,
        section: 'other' as const,
      }
    })
}

/**
 * Save (or update) a recipe from a parse result, if it looks like a recipe.
 * Dedupes by title. Returns the recipe id, or null if it wasn't a recipe.
 */
export async function saveRecipeFromParse(result: ParseResult): Promise<number | null> {
  if (result.sourceType !== 'recipe' || !result.recipeTitle) return null

  const tips = (result.tips ?? []).map((t) => t.trim()).filter(Boolean)
  const recipe: Omit<Recipe, 'id'> = {
    title: result.recipeTitle.trim(),
    servings: result.servings ?? 0,
    ingredients: result.items.map((i) => ({
      displayName: i.displayName,
      canonicalKey: i.canonicalKey,
      quantity: i.quantity ?? undefined,
      unit: i.unit ?? undefined,
      buyCount: i.buyCount ?? undefined,
      sizeAmount: i.sizeAmount ?? undefined,
      sizeUnit: i.sizeUnit ?? undefined,
      packaging: i.packaging ?? undefined,
      section: i.section,
      optional: i.optional || undefined,
    })),
    instructions: result.instructions ?? undefined,
    tips: tips.length ? tips : undefined,
    source: undefined,
    createdAt: Date.now(),
  }

  const existing = await db.recipes.where('title').equals(recipe.title).first()
  if (existing?.id != null) {
    await db.recipes.update(existing.id, recipe)
    return existing.id
  }
  return db.recipes.add(recipe as Recipe)
}

/** Add a recipe's ingredients to a grocery list, scaled by `factor` (default 1).
 *  Staples are skipped. Optional ingredients are skipped too, unless their index
 *  is in `includeOptional` — that's how the detail view opts specific ones in.
 *  Returns how many items were added. */
export async function addRecipeToList(
  recipe: Recipe,
  factor = 1,
  listId: number,
  includeOptional?: Set<number>,
): Promise<number> {
  const staples = await getStapleKeys()
  let added = 0
  for (let i = 0; i < recipe.ingredients.length; i++) {
    const ing = recipe.ingredients[i]
    if (staples.has(ing.canonicalKey)) continue
    if (ing.optional && !includeOptional?.has(i)) continue
    await addItem({
      listId,
      displayName: ing.displayName,
      canonicalKey: ing.canonicalKey,
      quantity: ing.quantity != null ? round2(ing.quantity * factor) : undefined,
      unit: ing.unit,
      // Doubling the recipe doubles the cans — and half a can still means
      // buying one, so the scaled pack count rounds up.
      buyCount: ing.buyCount != null ? packCount(ing.buyCount * factor) : undefined,
      sizeAmount: ing.sizeAmount,
      sizeUnit: ing.sizeUnit,
      packaging: ing.packaging,
      section: ing.section,
    })
    added++
  }
  return added
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * How many times a plan entry happens in the 7 days starting today.
 *
 * `null` for an entry with no schedule — a meal picked but not placed, which
 * is not the same as a meal happening zero times.
 */
export function timesThisWeek(schedule: Item['schedule'], now: number): number | null {
  if (!schedule || (schedule.every === 'week' && !schedule.days.length)) return null
  const today = new Date(startOfDay(now))
  let n = 0
  for (let i = 0; i < 7; i++) {
    // Noon, so a DST change cannot push a day into its neighbour.
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i, 12).getTime()
    if (fallsOn(schedule, d)) n++
  }
  return n
}

export type PlanShop = {
  /** Distinct recipes that went on the list. */
  recipes: number
  /** Meals those stand for — chili on Monday and Thursday is two. */
  meals: number
  /** Scheduled, but not in the next 7 days. */
  notThisWeek: number
  /** Plan entries whose recipe is gone. */
  missing: number
  /** Puts the grocery list back exactly as it was. */
  undo: () => Promise<void>
}

/**
 * Shop the week: send the meals planned for the next 7 days to a shopping list.
 *
 * Deciding what to eat and deciding what to buy are the same decision; doing
 * the second by hand from the first is the part that was happening in
 * someone's head.
 *
 * WHAT COUNTS. Each entry once per time it falls in the next 7 days, so a meal
 * planned twice is bought twice. An unscheduled entry — picked, not yet placed
 * — counts once: it was chosen to be eaten. A meal scheduled only outside the
 * week is skipped. The same recipe planned as two entries is summed before
 * scaling, so packs round up once ("1.5 cans" is two, not one plus one).
 *
 * It used to send every entry exactly once — including ones not happening this
 * week — and a second tap doubled the list with no way back. Hence `undo`.
 *
 * "Leftovers" and "Out" are plan entries with nothing to buy; they carry no
 * recipe and are not counted. Everything goes through addRecipeToList, so the
 * merge, staple-skipping and scaling all apply.
 */
export async function shopTheWeek(
  planItems: Item[],
  listId: number,
  now = Date.now(),
): Promise<PlanShop> {
  const recipes = await db.recipes.toArray()
  const byUid = new Map(recipes.filter((r) => r.uid).map((r) => [r.uid!, r]))

  const factorByUid = new Map<string, number>()
  let meals = 0
  let notThisWeek = 0
  let missing = 0
  for (const entry of planItems) {
    if (!entry.recipeUid) continue
    if (!byUid.has(entry.recipeUid)) {
      missing++
      continue
    }
    const times = timesThisWeek(entry.schedule, now) ?? 1
    if (times === 0) {
      notThisWeek++
      continue
    }
    meals += times
    factorByUid.set(entry.recipeUid, (factorByUid.get(entry.recipeUid) ?? 0) + times)
  }

  // The list as it was, for undo: every row that was there, whole.
  const before = await db.items.filter((i) => i.listId === listId).toArray()
  for (const [uid, factor] of factorByUid) await addRecipeToList(byUid.get(uid)!, factor, listId)

  const undo = async () => {
    const was = new Map(before.map((r) => [r.id!, r]))
    const now = await db.items.filter((i) => i.listId === listId).toArray()
    await db.transaction('rw', db.items, async () => {
      for (const row of now) {
        const old = was.get(row.id!)
        if (!old) await db.items.delete(row.id!)
        else if (JSON.stringify({ ...row, updatedAt: 0 }) !== JSON.stringify({ ...old, updatedAt: 0 }))
          await db.items.put(old)
      }
    })
  }

  return { recipes: factorByUid.size, meals, notThisWeek, missing, undo }
}
