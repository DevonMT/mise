import { db, canonicalize, type Item, type Section } from './db'
import { SECTION_ORDER } from './sections'

/** Units that just mean "a count of whole things" — treated as interchangeable
 *  (and with no unit) so "2 onions" and "1 whole onion" merge. */
const COUNT_UNITS = new Set(['whole', 'each', 'ct', 'count', 'pc', 'pcs', 'piece', 'pieces'])

/** Normalized unit used only for merge comparison. Count-ish units collapse to ''. */
export function unitKey(unit?: string | null): string {
  const s = (unit ?? '').trim().toLowerCase()
  return COUNT_UNITS.has(s) ? '' : s
}

export interface NewItem {
  displayName: string
  /** Optional pre-normalized merge key (e.g. from the AI parse); falls back to canonicalize(). */
  canonicalKey?: string
  quantity?: number
  unit?: string
  section: Section
  backlog?: boolean
}

/**
 * Add an item to the list, merging into an existing active line when the
 * canonical key + unit match. Returns the id of the affected row.
 */
export async function addItem(input: NewItem): Promise<number> {
  const canonicalKey = input.canonicalKey?.trim() || canonicalize(input.displayName)
  const backlog = input.backlog ?? false

  const existing = await db.items
    .where('canonicalKey')
    .equals(canonicalKey)
    .filter((i) => i.backlog === backlog && unitKey(i.unit) === unitKey(input.unit))
    .first()

  if (existing?.id != null) {
    const merged = (existing.quantity ?? 0) + (input.quantity ?? 0)
    await db.items.update(existing.id, {
      quantity: input.quantity != null ? merged || undefined : existing.quantity,
      checked: false,
    })
    return existing.id
  }

  return db.items.add({
    displayName: input.displayName.trim(),
    canonicalKey,
    quantity: input.quantity,
    unit: input.unit,
    section: input.section,
    checked: false,
    backlog,
    createdAt: Date.now(),
  })
}

export interface SectionGroup {
  section: Section
  items: Item[]
}

/** Group active-list items by section, in store-walk order. */
export function groupBySection(items: Item[]): SectionGroup[] {
  const map = new Map<Section, Item[]>()
  for (const item of items) {
    const arr = map.get(item.section) ?? []
    arr.push(item)
    map.set(item.section, arr)
  }
  return [...map.entries()]
    .sort((a, b) => SECTION_ORDER[a[0]] - SECTION_ORDER[b[0]])
    .map(([section, list]) => ({
      section,
      items: list.sort(
        (a, b) => Number(a.checked) - Number(b.checked) || a.createdAt - b.createdAt,
      ),
    }))
}

export function formatQty(item: Pick<Item, 'quantity' | 'unit'>): string {
  if (item.quantity == null) return ''
  const q = Number.isInteger(item.quantity)
    ? String(item.quantity)
    : item.quantity.toFixed(2).replace(/\.?0+$/, '')
  return item.unit ? `${q} ${item.unit}` : q
}
