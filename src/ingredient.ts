import { db, liveLists, type Item, type List, type RecipeIngredient } from './db'
import { addItem, findMergeTarget, formatQty } from './list'
import { DEFAULT_PANTRY_UID, ensurePantryList } from './lists'
import { sameIngredient } from './match'

/** The part of a recipe line the ingredient sheet needs. */
export type IngredientLine = Pick<RecipeIngredient, 'displayName' | 'canonicalKey' | 'section'> &
  Partial<Pick<RecipeIngredient, 'quantity' | 'unit' | 'buyCount' | 'sizeAmount' | 'sizeUnit' | 'packaging'>>

export interface Holding {
  item: Item
  list: List
}

/** Where an ingredient already is: in a pantry, and/or on a shopping list. */
export interface IngredientStatus {
  pantry: Holding[]
  onList: Holding[]
  /** The pantry row an "Add to Pantry" would touch, and the line an "Add to
   *  Shopping List" would merge into on the target list, so the sheet can say
   *  what a tap will do instead of guessing from everything that matches. */
  pantryTarget?: Item
  listTarget?: Item
}

/** The pantry row for an ingredient, by name alone: a pantry row says "I have
 *  it", so a row that happens to carry a unit ("Flour", lb) is still the one.
 *  In stock wins over marked out. */
async function findPantryRow(pantryId: number, ing: IngredientLine): Promise<Item | undefined> {
  const rows = await db.items.where('listId').equals(pantryId).filter((i) => sameIngredient(i, ing)).toArray()
  return rows.find((r) => !r.checked) ?? rows[0]
}

/**
 * Everything that already answers to this ingredient, read live: a pantry row
 * (in stock, out, or an "always have" staple) and any line on a grocery list.
 * Matching is the ingredient matcher's (match.ts), so a recipe's "ground cumin"
 * finds the pantry's "Cumin". Parked "next time" lines count: they are on a list.
 */
export async function ingredientStatus(ing: IngredientLine, listId?: number): Promise<IngredientStatus> {
  const lists = (await liveLists()).filter((l) => l.kind === 'pantry' || l.kind === 'grocery')
  const byId = new Map(lists.map((l) => [l.id!, l]))
  const rows = await db.items.filter((i) => byId.has(i.listId) && !i.pending).toArray()
  const out: IngredientStatus = { pantry: [], onList: [] }
  for (const item of rows) {
    if (!sameIngredient(item, ing)) continue
    const list = byId.get(item.listId)!
    ;(list.kind === 'pantry' ? out.pantry : out.onList).push({ item, list })
  }
  // Same pick as ensurePantryList(): the shared one, else the first.
  const pantries = lists.filter((l) => l.kind === 'pantry')
  const pantry = pantries.find((l) => l.uid === DEFAULT_PANTRY_UID) ?? pantries[0]
  if (pantry?.id != null) out.pantryTarget = await findPantryRow(pantry.id, ing)
  if (listId != null) {
    out.listTarget = await findMergeTarget({
      listId,
      displayName: ing.displayName,
      canonicalKey: ing.canonicalKey,
      unit: ing.unit,
    })
  }
  return out
}

export type ListAdd = { result: 'added' | 'merged'; listId: number; item: Item }

/** Put an ingredient on a shopping list, merging into the line already there
 *  (same thing by name, same unit) instead of adding a second. */
export async function addIngredientToList(
  ing: IngredientLine,
  factor: number,
  listId: number,
): Promise<ListAdd> {
  const quantity = ing.quantity != null ? Math.round(ing.quantity * factor * 100) / 100 : undefined
  const input = {
    listId,
    displayName: ing.displayName,
    canonicalKey: ing.canonicalKey,
    quantity,
    unit: ing.unit,
    section: ing.section,
  }
  const target = await findMergeTarget(input)
  const id = await addItem(input)
  return { result: target ? 'merged' : 'added', listId, item: (await db.items.get(id))! }
}

export type PantryAdd = { result: 'added' | 'restocked' | 'already'; item: Item }

/**
 * Stock the pantry with an ingredient. A pantry row is "do I have it", not "how
 * much": the recipe's amount is not stored. If a matching row is there and
 * marked out it comes back in stock; if it is already in stock nothing changes.
 */
export async function addIngredientToPantry(ing: IngredientLine): Promise<PantryAdd> {
  const pantryId = await ensurePantryList()
  const input = { listId: pantryId, displayName: ing.displayName, canonicalKey: ing.canonicalKey }
  const target = await findPantryRow(pantryId, ing)
  if (target?.id != null) {
    if (!target.checked) return { result: 'already', item: target }
    await db.items.update(target.id, { checked: false })
    return { result: 'restocked', item: { ...target, checked: false } }
  }
  const id = await addItem({ ...input, section: ing.section })
  return { result: 'added', item: (await db.items.get(id))! }
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** What the sheet says about where this ingredient already is. Exported for the tests. */
export function statusLines(ing: IngredientLine, st: IngredientStatus): string[] {
  const lines: string[] = []
  // "as Cumin" only when the row is named differently from the recipe line.
  const as = (name: string) => (same(name, ing.displayName) ? '' : ` as “${name}”`)
  for (const { item } of st.pantry) {
    const state = item.checked ? 'In your pantry, marked out' : item.alwaysHave ? 'In your pantry, always on hand' : 'In your pantry'
    lines.push(state + as(item.displayName))
  }
  for (const { item, list } of st.onList) {
    const amount = formatQty(item)
    const tags = [item.checked ? 'in cart' : '', item.backlog ? 'next time' : ''].filter(Boolean)
    lines.push(
      `On ${list.name}${amount ? `, ${amount}` : ''}${tags.length ? ` (${tags.join(', ')})` : ''}${as(item.displayName)}`,
    )
  }
  return lines
}
