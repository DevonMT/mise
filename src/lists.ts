import { db, type Item, type List, type ListKind } from './db'
import { addItem } from './list'

const ACTIVE_KEY = 'mise.activeList'

/**
 * Make sure at least one list exists and return the id we should open.
 * Dexie only runs .upgrade() when migrating an existing DB, so a fresh
 * install lands on v3 with an empty `lists` table — this covers both.
 */
export async function ensureSeed(): Promise<number> {
  // One atomic transaction so concurrent callers (React StrictMode double-mount,
  // or two effects) can't each create a duplicate "Groceries" list.
  return db.transaction('rw', db.lists, async () => {
    const existing = await db.lists.orderBy('id').first()
    if (existing?.id != null) return existing.id
    return db.lists.add({ name: 'Groceries', kind: 'grocery', createdAt: Date.now() })
  })
}

export function readActiveId(): number | null {
  const raw = localStorage.getItem(ACTIVE_KEY)
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) ? n : null
}

export function writeActiveId(id: number): void {
  localStorage.setItem(ACTIVE_KEY, String(id))
}

/** The stored active list, falling back to the first list if it's gone. */
export async function resolveActiveId(): Promise<number> {
  const stored = readActiveId()
  if (stored != null && (await db.lists.get(stored))) return stored
  const id = await ensureSeed()
  writeActiveId(id)
  return id
}

export async function createList(name: string, kind: ListKind): Promise<number> {
  const id = await db.lists.add({ name: name.trim() || 'Untitled', kind, createdAt: Date.now() })
  return id
}

export async function renameList(id: number, name: string): Promise<void> {
  await db.lists.update(id, { name: name.trim() || 'Untitled' })
}

/** Delete a list and its items, returning both so an Undo can restore them. */
export async function deleteList(id: number): Promise<{ list: List; items: Item[] } | null> {
  const list = await db.lists.get(id)
  if (!list) return null
  const items = await db.items.filter((i) => i.listId === id).toArray()
  await db.items.bulkDelete(items.map((i) => i.id!))
  await db.lists.delete(id)
  return { list, items }
}

export async function restoreList(snapshot: { list: List; items: Item[] }): Promise<void> {
  await db.lists.add(snapshot.list)
  if (snapshot.items.length) await db.items.bulkAdd(snapshot.items)
}

/**
 * Move every item from `sourceId` into `targetId`, reusing addItem() so
 * duplicates merge by canonical key + unit exactly as they do anywhere else.
 * The source list is deleted. Returns how many items moved.
 */
export async function mergeInto(sourceId: number, targetId: number): Promise<number> {
  if (sourceId === targetId) return 0
  const rows = await db.items.filter((i) => i.listId === sourceId).toArray()
  for (const r of rows) {
    await addItem({
      listId: targetId,
      displayName: r.displayName,
      canonicalKey: r.canonicalKey,
      quantity: r.quantity,
      unit: r.unit,
      section: r.section,
      backlog: r.backlog,
      dueAt: r.dueAt,
      notes: r.notes,
    })
  }
  await db.items.bulkDelete(rows.map((i) => i.id!))
  await db.lists.delete(sourceId)
  return rows.length
}

/** The list a recipe or an AI capture should land on. */
export async function defaultGroceryListId(preferred: number): Promise<number | null> {
  const p = await db.lists.get(preferred)
  if (p?.kind === 'grocery') return preferred
  const first = await db.lists.filter((l) => l.kind === 'grocery').first()
  return first?.id ?? null
}

/* ---- The pantry loop ------------------------------------------------ */

/**
 * Push everything marked "out" in a pantry list onto a grocery list.
 * They stay marked out — you haven't actually bought them yet. Buying is what
 * restocks them (see restockFromPurchase).
 */
export async function addOutToGroceries(
  pantryId: number,
  groceryId: number,
): Promise<number> {
  const out = await db.items.filter((i) => i.listId === pantryId && !!i.checked).toArray()
  for (const p of out) {
    await addItem({
      listId: groceryId,
      displayName: p.displayName,
      canonicalKey: p.canonicalKey,
      quantity: p.quantity,
      unit: p.unit,
      section: p.section,
    })
  }
  return out.length
}

/**
 * Closing the loop: clearing checked-off groceries means "I bought these", so
 * anything they match in a pantry goes back to in-stock. Returns the pantry
 * rows we flipped so an Undo can put them back.
 */
export async function restockFromPurchase(bought: Item[]): Promise<Item[]> {
  if (!bought.length) return []
  const keys = new Set(bought.map((b) => b.canonicalKey))
  const pantryIds = new Set(
    (await db.lists.filter((l) => l.kind === 'pantry').toArray()).map((l) => l.id!),
  )
  if (!pantryIds.size) return []

  const flipped = await db.items
    .filter((i) => pantryIds.has(i.listId) && !!i.checked && keys.has(i.canonicalKey))
    .toArray()
  for (const f of flipped) await db.items.update(f.id!, { checked: false })
  return flipped
}

export async function undoRestock(flipped: Item[]): Promise<void> {
  for (const f of flipped) await db.items.update(f.id!, { checked: true })
}
