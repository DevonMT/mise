import { db, type Item, type List, type ListKind } from './db'
import { lastSyncedAt, syncEnabled } from './sync'
import { addItem } from './list'

const ACTIVE_KEY = 'mise.activeList'

/**
 * Make sure at least one list exists and return the id we should open.
 * Dexie only runs .upgrade() when migrating an existing DB, so a fresh
 * install lands on v3 with an empty `lists` table — this covers both.
 */
/**
 * Identities for the lists the app makes on your behalf.
 *
 * DETERMINISTIC, not random, and that is the whole point. A default list is a
 * singleton per account, so every device has to arrive at the SAME identity for
 * it — otherwise the phone mints one Pantry, the laptop mints another, sync
 * does what it is told and unions them, and you have two Pantries that nobody
 * created. Three separate places seed a Pantry (here, the settings path, and
 * the v5 staples migration), each of which was minting its own.
 *
 * A list the user creates still gets a random uid. This is only for the ones
 * the app decides to make, which are exactly the ones that must converge.
 */
export const DEFAULT_LIST_UID = 'default:list'
export const DEFAULT_PANTRY_UID = 'default:pantry'

export async function ensureSeed(): Promise<number> {
  // One atomic transaction so concurrent callers (React StrictMode double-mount,
  // or two effects) can't each create a duplicate "Groceries" list.
  return db.transaction('rw', db.lists, async () => {
    const existing = await db.lists.orderBy('id').first()
    if (existing?.id != null) return existing.id
    // Neutral default — Mise isn't only for groceries. Grocery *kind* (the
    // richest), but the name/icon are the user's to change.
    return db.lists.add({
      name: 'My list',
      kind: 'grocery',
      icon: 'list',
      createdAt: Date.now(),
      uid: DEFAULT_LIST_UID,
    })
  })
}

/**
 * Make sure a Pantry exists, on every install rather than only new ones.
 *
 * It is no longer an optional extra: "things I always have" lives there now,
 * so Settings has nowhere to put them without it. Seeded EMPTY — guessing
 * somebody's staples is worse than an empty list that says what it is for.
 */
export async function ensureDefaultLists(): Promise<void> {
  // A device that is going to sync but never has must NOT seed yet.
  //
  // Seeding now makes a "My list" that then sits beside the "Groceries" the
  // account already had — two grocery lists, one of which nobody asked for, and
  // the second-most common way this app grew duplicates. Wait for the first
  // sync; if it brings lists there is nothing to seed, and if it brings none
  // this runs again and seeds then.
  if (syncEnabled() && lastSyncedAt() == null) return
  await ensureSeed()
  await ensurePantryList()
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

export async function createList(name: string, kind: ListKind, icon?: string): Promise<number> {
  const id = await db.lists.add({
    name: name.trim() || 'Untitled',
    kind,
    icon,
    createdAt: Date.now(),
  })
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

/**
 * The Pantry list, made if it isn't there yet.
 *
 * Every install gets one now — the pantry is where "things I always have"
 * lives, and Settings needs somewhere to put them. Reuses an existing pantry
 * list rather than making a second, and is a transaction so two callers racing
 * (StrictMode's double mount, or a sync arriving at the same moment) cannot
 * each create one.
 */
export async function ensurePantryList(): Promise<number> {
  return db.transaction('rw', db.lists, async () => {
    const existing = await db.lists.filter((l) => l.kind === 'pantry').first()
    if (existing?.id != null) return existing.id
    return db.lists.add({
      name: 'Pantry',
      kind: 'pantry',
      icon: 'pantry',
      createdAt: Date.now(),
      uid: DEFAULT_PANTRY_UID,
    })
  })
}

/**
 * Remove duplicate lists that the app created, and only those.
 *
 * The seeders used to mint a random uid each, so two devices each produced
 * their own "Pantry" and sync — correctly doing what it is told — kept both.
 * Deterministic ids stop that happening again, but the duplicates already made
 * carry random ids and will not merge on their own.
 *
 * DELIBERATELY TIMID. It removes a list only when ALL of these hold:
 *
 *   - it is EMPTY. Nothing is ever merged, moved or overwritten, so the worst
 *     case is that an empty list survives that could have gone.
 *   - it is not the only list of its kind, and not the oldest of them.
 *   - its name is one the app itself uses. A second Pantry called "Freezer" is
 *     something you made on purpose.
 *
 * Anything with items in it is left alone and reported, because merging two
 * lists somebody filled is a decision for them, not a repair to run at startup.
 */
const APP_MADE_NAMES = new Set(['my list', 'pantry', 'groceries'])

export async function dedupeDefaultLists(): Promise<{ removed: string[]; leftAlone: string[] }> {
  const removed: string[] = []
  const leftAlone: string[] = []

  const lists = await db.lists.orderBy('id').toArray()
  const byKind = new Map<string, typeof lists>()
  for (const l of lists) {
    const arr = byKind.get(l.kind) ?? []
    arr.push(l)
    byKind.set(l.kind, arr)
  }

  for (const [, group] of byKind) {
    if (group.length < 2) continue
    // Oldest wins: it is the one whose id other things are most likely to hold.
    const [, ...rest] = group.sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
    for (const dup of rest) {
      if (dup.id == null) continue
      if (!APP_MADE_NAMES.has(dup.name.trim().toLowerCase())) continue
      const count = await db.items.filter((i) => i.listId === dup.id).count()
      if (count > 0) {
        leftAlone.push(dup.name)
        continue
      }
      // The delete hook writes a tombstone, so the removal reaches the other
      // devices instead of the duplicate coming straight back on the next pull.
      await db.lists.delete(dup.id)
      removed.push(dup.name)
    }
  }
  return { removed, leftAlone }
}
