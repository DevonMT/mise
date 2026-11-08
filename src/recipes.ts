import { db, canonicalize, type Recipe, type Item, type RecipeIngredient } from './db'
import { addItem, fallsOn, startOfDay, type NewItem } from './list'
import { buyLine, type BuyPlan } from './buy'
import { getInStockKeys } from './lists'
import { getStapleKeys, isStaple, standardizeLines, type ParseResult } from './parse'
import { changedCount, fillFromTable, filledCount, listAmount, mergeEstimate, openGaps } from './packSizes'

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
      sizeEstimated: i.sizeEstimated || undefined,
      amountEstimated: i.amountEstimated || undefined,
      estimateAsked: i.estimateAsked || undefined,
      section: i.section,
      optional: i.optional || undefined,
      // A range keeps its top only when it is one (#811).
      quantityMax:
        i.quantityMax != null && i.quantity != null && i.quantityMax > i.quantity ? i.quantityMax : undefined,
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

/** Lines one Standardize call may send; matches STANDARDIZE_MAX_LINES in server/src/parseContract.ts. */
export const STANDARDIZE_MAX_LINES = 60

export interface Standardized {
  /** Lines the table or the model filled. */
  filled: number
  /** Set when the model's pass failed; the table's fills are saved anyway. */
  error?: string
}

/**
 * Standardize a saved recipe (#774): fill in the pack sizes and amounts it left
 * out, gaps only, so a size or amount already there (stated, edited, or an
 * earlier estimate) never changes. The table first, saved at once; then, only
 * with AI, the model for what the table did not know. Without AI it is the
 * table alone and nothing errors.
 */
export async function standardizeRecipe(recipe: Recipe, ai: boolean): Promise<Standardized> {
  if (recipe.id == null) return { filled: 0 }
  const before = recipe.ingredients
  let lines = before.map(fillFromTable)
  const save = async () => {
    if (changedCount(before, lines) > 0) await db.recipes.update(recipe.id!, { ingredients: lines })
  }
  await save()
  // One call asks about at most 60 lines (the server's STANDARDIZE_MAX_LINES);
  // the rest wait for the next tap, unmarked.
  const gaps = ai ? openGaps(lines).slice(0, STANDARDIZE_MAX_LINES) : []
  if (!gaps.length) return { filled: filledCount(before, lines) }
  try {
    const { answers, asked: seen } = await standardizeLines(
      { title: recipe.title, servings: recipe.servings },
      gaps.map((i) => ({
        index: i,
        displayName: lines[i].displayName,
        quantity: lines[i].quantity ?? null,
        unit: lines[i].unit ?? null,
      })),
    )
    // Marked tried: a line this call sent AND the server says the model saw,
    // answered or not. The model was told to leave "oil for frying" alone, and
    // asking again would spend another call and keep the button up forever.
    const asked = new Set(gaps.filter((i) => seen.has(i)))
    const byIndex = new Map(answers.filter((a) => asked.has(a.index)).map((a) => [a.index, a]))
    const tried = <T extends Recipe['ingredients'][number]>(l: T, i: number): T => {
      const m = mergeEstimate(l, byIndex.get(i))
      return asked.has(i) ? { ...m, estimateAsked: true } : m
    }
    lines = lines.map(tried)
    // Re-read, so an edit made while the model was thinking is not lost: the
    // answers go into the saved row's lines, gaps only, and only into a line
    // still at the index (and with the name) it was asked about.
    const now = await db.recipes.get(recipe.id)
    if (!now) return { filled: 0 }
    const merged = now.ingredients.map((l, i) => (l.displayName === lines[i]?.displayName ? tried(l, i) : l))
    if (changedCount(now.ingredients, merged) > 0) await db.recipes.update(recipe.id, { ingredients: merged })
    return { filled: filledCount(before, lines) }
  } catch (e) {
    return { filled: filledCount(before, lines), error: e instanceof Error ? e.message : String(e) }
  }
}

/** A recipe line left off the list because the pantry has it: the line as it
 *  would have been added (already scaled), so "Add anyway" is one call. */
export type Skipped = NewItem

/**
 * Add a recipe's ingredients to a grocery list, scaled by `factor` (default 1).
 *
 * Skipped, in this order: always-on-hand pantry items (silently, always); optional
 * ingredients, unless their index is in `includeOptional` (that's how the detail
 * view opts specific ones in); and anything an in-stock pantry item matches
 * (getInStockKeys). Only the last is reported, in `skipped`, because it is the
 * one a person can disagree with ("I used the last of it") and `addSkipped`
 * puts those lines back. A pantry item marked out never skips anything.
 */
/**
 * One recipe line as a list line. The amount is the recipe's (an estimated
 * amount stays on the recipe, see listAmount); the pack is `plan`, from the buy
 * math or the review sheet (#811). With no plan the pack is left off, so the
 * row shows the amount alone.
 */
export function recipeListLine(
  ing: RecipeIngredient,
  factor: number,
  listId: number,
  plan: BuyPlan | Pick<NewItem, 'buyCount' | 'sizeAmount' | 'sizeUnit' | 'packaging'> | null,
  extra?: Pick<NewItem, 'detail' | 'section'>,
): NewItem {
  return {
    listId,
    displayName: ing.displayName,
    canonicalKey: ing.canonicalKey,
    // A range goes on the list at its top: that is what you buy for (#811).
    ...listAmount({ ...ing, quantity: ing.quantityMax ?? ing.quantity }, factor),
    buyCount: plan?.buyCount,
    sizeAmount: plan?.sizeAmount,
    sizeUnit: plan?.sizeUnit,
    packaging: plan?.packaging,
    section: extra?.section ?? ing.section,
    ...(extra?.detail ? { detail: extra.detail } : {}),
  }
}

export async function addRecipeToList(
  recipe: Recipe,
  factor = 1,
  listId: number,
  includeOptional?: Set<number>,
): Promise<{ added: number; skipped: Skipped[] }> {
  const [staples, stocked] = await Promise.all([getStapleKeys(), getInStockKeys()])
  let added = 0
  const skipped: Skipped[] = []
  for (let i = 0; i < recipe.ingredients.length; i++) {
    const ing = recipe.ingredients[i]
    if (isStaple(staples, ing)) continue
    if (ing.optional && !includeOptional?.has(i)) continue
    const line = recipeListLine(ing, factor, listId, buyLine(ing, factor).plan)
    if (isStaple(stocked, ing)) {
      skipped.push(line)
      continue
    }
    await addItem(line)
    added++
  }
  return { added, skipped }
}

/** Put lines that were skipped for being in the pantry on the list after all.
 *  Returns how many were added. */
export async function addSkipped(skipped: Skipped[]): Promise<number> {
  for (const line of skipped) await addItem(line)
  return skipped.length
}

/** "Skipped 2 you have: sugar, vanilla", naming at most three. */
export function skippedMessage(skipped: Skipped[]): string {
  const names: string[] = []
  const seen = new Set<string>()
  for (const s of skipped) {
    const k = s.displayName.trim().toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    names.push(k)
  }
  const shown = names.slice(0, 3).join(', ')
  const more = names.length > 3 ? ` +${names.length - 3} more` : ''
  return `Skipped ${skipped.length} you have: ${shown}${more}`
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
  /** Lines left off because the pantry has them (see addRecipeToList). */
  skipped: Skipped[]
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
 * merge, staple- and pantry-skipping and scaling all apply.
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
  const skipped: Skipped[] = []
  for (const [uid, factor] of factorByUid) {
    skipped.push(...(await addRecipeToList(byUid.get(uid)!, factor, listId)).skipped)
  }

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

  return { recipes: factorByUid.size, meals, notThisWeek, missing, skipped, undo }
}
