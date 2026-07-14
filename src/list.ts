import { db, canonicalize, type Item, type Section } from './db'
import { SECTION_ORDER } from './sections'
import { recordCatalog } from './catalog'

/** Units that just mean "a count of whole things" — treated as interchangeable
 *  (and with no unit) so "2 onions" and "1 whole onion" merge. */
const COUNT_UNITS = new Set(['whole', 'each', 'ct', 'count', 'pc', 'pcs', 'piece', 'pieces'])

/** Normalized unit used only for merge comparison. Count-ish units collapse to ''. */
export function unitKey(unit?: string | null): string {
  const s = (unit ?? '').trim().toLowerCase()
  return COUNT_UNITS.has(s) ? '' : s
}

export interface NewItem {
  listId: number
  displayName: string
  /** Optional pre-normalized merge key (e.g. from the AI parse); falls back to canonicalize(). */
  canonicalKey?: string
  quantity?: number
  unit?: string
  section: Section
  backlog?: boolean
  dueAt?: number
  notes?: string
}

/**
 * Add an item to a list, merging into an existing line there when the
 * canonical key + unit match. Returns the id of the affected row.
 * This is the single merge engine — capture, quick-add, recipes, list merges,
 * and the pantry restock all go through it.
 */
export async function addItem(input: NewItem): Promise<number> {
  const canonicalKey = input.canonicalKey?.trim() || canonicalize(input.displayName)
  const backlog = input.backlog ?? false

  await recordCatalog({
    canonicalKey,
    displayName: input.displayName.trim(),
    unit: input.unit,
    section: input.section,
  })

  const existing = await db.items
    .where('canonicalKey')
    .equals(canonicalKey)
    .filter(
      (i) =>
        i.listId === input.listId &&
        i.backlog === backlog &&
        unitKey(i.unit) === unitKey(input.unit),
    )
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
    listId: input.listId,
    displayName: input.displayName.trim(),
    canonicalKey,
    quantity: input.quantity,
    unit: input.unit,
    section: input.section,
    checked: false,
    backlog,
    createdAt: Date.now(),
    dueAt: input.dueAt,
    notes: input.notes,
  })
}

export interface Group {
  /** Section key for section-grouped kinds, or a bucket key for tasks. */
  key: string
  label: string
  emoji: string
  items: Item[]
}

/** Group items by store section, in store-walk order. */
export function groupBySection(items: Item[], meta: Record<Section, { label: string; emoji: string }>): Group[] {
  const map = new Map<Section, Item[]>()
  for (const item of items) {
    const arr = map.get(item.section) ?? []
    arr.push(item)
    map.set(item.section, arr)
  }
  return [...map.entries()]
    .sort((a, b) => SECTION_ORDER[a[0]] - SECTION_ORDER[b[0]])
    .map(([section, list]) => ({
      key: section,
      label: meta[section].label,
      emoji: meta[section].emoji,
      items: list.sort(
        (a, b) => Number(a.checked) - Number(b.checked) || a.createdAt - b.createdAt,
      ),
    }))
}

/** Local midnight for a timestamp — due dates are day-granular. */
export function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const DAY = 86_400_000

/** Group tasks by when they're due: the thing you actually want to see. */
export function groupByDue(items: Item[], now: number): Group[] {
  const today = startOfDay(now)
  const buckets: Array<{ key: string; label: string; emoji: string; items: Item[] }> = [
    { key: 'overdue', label: 'Overdue', emoji: '🔴', items: [] },
    { key: 'today', label: 'Today', emoji: '📌', items: [] },
    { key: 'tomorrow', label: 'Tomorrow', emoji: '🌅', items: [] },
    { key: 'week', label: 'This week', emoji: '🗓️', items: [] },
    { key: 'later', label: 'Later', emoji: '🕓', items: [] },
    { key: 'none', label: 'No date', emoji: '•', items: [] },
  ]
  const at = (k: string) => buckets.find((b) => b.key === k)!

  for (const i of items) {
    if (i.dueAt == null) at('none').items.push(i)
    else {
      const d = startOfDay(i.dueAt)
      if (d < today) at('overdue').items.push(i)
      else if (d === today) at('today').items.push(i)
      else if (d === today + DAY) at('tomorrow').items.push(i)
      else if (d <= today + 7 * DAY) at('week').items.push(i)
      else at('later').items.push(i)
    }
  }

  for (const b of buckets) {
    b.items.sort(
      (a, c) =>
        Number(a.checked) - Number(c.checked) ||
        (a.dueAt ?? Infinity) - (c.dueAt ?? Infinity) ||
        a.createdAt - c.createdAt,
    )
  }
  return buckets.filter((b) => b.items.length > 0)
}

export function formatQty(item: Pick<Item, 'quantity' | 'unit'>): string {
  if (item.quantity == null) return ''
  const q = Number.isInteger(item.quantity)
    ? String(item.quantity)
    : item.quantity.toFixed(2).replace(/\.?0+$/, '')
  return item.unit ? `${q} ${item.unit}` : q
}

/** Short, human due label for a task row. */
export function formatDue(dueAt: number, now: number): { text: string; tone: 'over' | 'soon' | 'calm' } {
  const today = startOfDay(now)
  const d = startOfDay(dueAt)
  const days = Math.round((d - today) / DAY)
  if (days < 0) return { text: days === -1 ? 'Yesterday' : `${-days}d late`, tone: 'over' }
  if (days === 0) return { text: 'Today', tone: 'soon' }
  if (days === 1) return { text: 'Tomorrow', tone: 'soon' }
  if (days <= 6)
    return {
      text: new Date(dueAt).toLocaleDateString(undefined, { weekday: 'short' }),
      tone: 'calm',
    }
  return {
    text: new Date(dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    tone: 'calm',
  }
}

/** <input type="date"> wants yyyy-mm-dd in *local* time. */
export function toDateInput(t: number): string {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function fromDateInput(s: string): number | undefined {
  if (!s) return undefined
  const [y, m, d] = s.split('-').map(Number)
  if (!y || !m || !d) return undefined
  return new Date(y, m - 1, d).getTime()
}
