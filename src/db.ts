import Dexie, { type Table } from 'dexie'

/** Fixed store-section taxonomy — drives the aisle grouping order.
 *  Additive only: `section` is a plain string index in IndexedDB, so new keys
 *  need no migration, but the existing keys must never be renamed/removed or
 *  items already filed under them would orphan. */
export type Section =
  | 'produce'
  | 'bakery'
  | 'deli'
  | 'meat'
  | 'dairy'
  | 'frozen'
  | 'pantry'
  | 'baking'
  | 'condiments'
  | 'snacks'
  | 'beverages'
  | 'household'
  | 'personal'
  | 'other'

/**
 * What a list is *for*. The kind decides which of Mise's smarts wake up
 * (see kinds.ts) — the underlying item shape is shared by all of them.
 */
export type ListKind =
  | 'grocery'
  | 'tasks'
  | 'pantry'
  | 'packing'
  | 'wishlist'
  | 'mealplan'
  | 'routine'

/**
 * When something recurs.
 *
 * Two shapes, because they are genuinely different questions and forcing one
 * into the other lies. "Tuesdays and Fridays" is anchored to the week and does
 * not drift. "Every other day" is anchored to a START and walks through the
 * week — it is Monday one week and Tuesday the next, so it has no weekday to
 * be filed under.
 *
 * Meals are almost always weekly. Training is almost always cadence. One
 * mechanism serves both, and neither has to pretend to be the other.
 */
export type Schedule =
  | { every: 'week'; days: number[] }        // 0=Sun … 6=Sat
  | { every: 'days'; interval: number; from: number }  // from = local midnight

export interface List {
  id?: number
  /**
   * Sync identity. Minted on the device that created the row and never reused.
   * The `id` above is a per-device Dexie counter — item 5 on the phone is not
   * item 5 on the laptop — so `uid` is the only thing a merge can key on.
   * Optional because rows created before sync existed are backfilled in v4.
   */
  uid?: string
  /** Epoch ms of the last local edit. The last-write-wins comparand. */
  updatedAt?: number
  name: string
  kind: ListKind
  /** Icon key (see Icon.tsx LIST_ICON_KEYS). Falls back to the kind's default. */
  icon?: string
  createdAt: number
}

export interface Item {
  id?: number
  /**
   * Sync identity. Minted on the device that created the row and never reused.
   * The `id` above is a per-device Dexie counter — item 5 on the phone is not
   * item 5 on the laptop — so `uid` is the only thing a merge can key on.
   * Optional because rows created before sync existed are backfilled in v4.
   */
  uid?: string
  /** Epoch ms of the last local edit. The last-write-wins comparand. */
  updatedAt?: number
  /** Which list this belongs to. */
  listId: number
  displayName: string
  /** Normalized key used to merge duplicates across sources (e.g. "onion"). */
  canonicalKey: string
  /**
   * The "Need" layer — how much a recipe calls for: a *measure*.
   * `quantity` 0.5 + `unit` "cup"; `quantity` 3 + `unit` "clove". This scales
   * with servings and drives duplicate-merging. Left untouched by Refine — the
   * specific product you buy lives in the Buy layer below.
   */
  quantity?: number
  unit?: string
  /**
   * The "Buy" layer — the specific purchase, set by Refine (or edited by hand).
   * Separate from quantity/unit so refining never destroys the recipe amount.
   * A purchase is: `buyCount` of a package, each package being `sizeAmount`
   * `sizeUnit` of `packaging`. e.g. 3 × (15 oz) can; 1 × (16 oz) jar; 2 lb.
   */
  /** How many packages/units to put in the cart. Undefined = no pack chosen. */
  buyCount?: number
  /** How much is in ONE package — the number (16). Null when the packaging is
   *  self-describing (a dozen, a bunch, a single pound). */
  sizeAmount?: number
  /** The measure that `sizeAmount` is in: oz, lb, ct, ml, g, gallon… */
  sizeUnit?: string
  /** The countable purchase noun: jar, can, bag, box, dozen, bunch, lb, each. */
  packaging?: string
  section: Section
  /**
   * grocery: in the cart · tasks: done · pantry: out of stock.
   * NB: booleans are NOT indexable in IndexedDB — never query this with
   * .where('checked'); filter in JS instead.
   */
  checked: boolean
  /** true = parked in the "next time" backlog, not on the active trip. */
  backlog: boolean
  createdAt: number
  /** Tasks only: due date (epoch ms, midnight-local). */
  dueAt?: number
  /** Tasks only: free-text detail. */
  notes?: string
  /** The specific product picked via Refine (brand/size), e.g. "Store brand
   *  salsa, 16 oz jar". The row keeps the basic displayName; this shows on tap. */
  detail?: string
  /**
   * Pantry only: something you always have, so a recipe asking for it must not
   * put it on a shopping list. Salt, oil, pepper.
   *
   * This replaces the separate `staples` table, which held the same idea in a
   * second place under a different name and was the source of a genuine
   * "which one of these is the pantry?" confusion. One list now, with a flag,
   * so adding salt to the pantry and telling Mise never to buy salt are the
   * same act in the same place.
   *
   * NOTE it is independent of `checked`. A staple that has run OUT is still a
   * staple — you just want it on the list this once, which is exactly what
   * marking it out does.
   */
  alwaysHave?: boolean
  /**
   * Scheduled kinds only (meal plan, routine): when this recurs. Absent means
   * unscheduled, which is a real and useful state — a meal you have picked but
   * not placed, an exercise you are not currently doing.
   */
  schedule?: Schedule
  /**
   * Meal plan only: the saved recipe this stands for, by its sync uid rather
   * than its local id, because the local id means nothing on another device and
   * a meal plan is exactly the kind of thing that syncs.
   *
   * Nullable on purpose: "Leftovers" and "Out" are legitimate entries in a
   * week's plan and are not recipes.
   */
  recipeUid?: string
}

/** One line of a recipe. `optional` ingredients are never added to the list
 *  by default — you opt into them. */
export type RecipeIngredient = Pick<
  Item,
  | 'displayName'
  | 'canonicalKey'
  | 'quantity'
  | 'unit'
  // The pack the recipe itself named ("2 × 10½ oz can") — kept so adding the
  // recipe to a list tells you which size to grab, not just "2 can".
  | 'buyCount'
  | 'sizeAmount'
  | 'sizeUnit'
  | 'packaging'
  | 'section'
> & { optional?: boolean }

/** A saved recipe. */
export interface Recipe {
  id?: number
  /**
   * Sync identity. Minted on the device that created the row and never reused.
   * The `id` above is a per-device Dexie counter — item 5 on the phone is not
   * item 5 on the laptop — so `uid` is the only thing a merge can key on.
   * Optional because rows created before sync existed are backfilled in v4.
   */
  uid?: string
  /** Epoch ms of the last local edit. The last-write-wins comparand. */
  updatedAt?: number
  title: string
  servings: number
  ingredients: RecipeIngredient[]
  /** Free-text cooking steps, if captured. */
  instructions?: string
  /** Serving suggestions / variations the recipe offers (not shopping items). */
  tips?: string[]
  source?: string
  createdAt: number
}

/**
 * DEPRECATED, kept so the v5 migration can read it and so a sync from a device
 * still on v4 does not fail. Nothing writes it any more: see `Item.alwaysHave`.
 */
export interface Staple {
  id?: number
  /**
   * Sync identity. Minted on the device that created the row and never reused.
   * The `id` above is a per-device Dexie counter — item 5 on the phone is not
   * item 5 on the laptop — so `uid` is the only thing a merge can key on.
   * Optional because rows created before sync existed are backfilled in v4.
   */
  uid?: string
  /** Epoch ms of the last local edit. The last-write-wins comparand. */
  updatedAt?: number
  canonicalKey: string
  displayName: string
}

/** Everything you've ever added — powers quick re-add (favorites) and
 *  the remembered price per item. Global, not per-list: it describes *you*. */
export interface CatalogEntry {
  id?: number
  /**
   * Sync identity. Minted on the device that created the row and never reused.
   * The `id` above is a per-device Dexie counter — item 5 on the phone is not
   * item 5 on the laptop — so `uid` is the only thing a merge can key on.
   * Optional because rows created before sync existed are backfilled in v4.
   */
  uid?: string
  /** Epoch ms of the last local edit. The last-write-wins comparand. */
  updatedAt?: number
  canonicalKey: string
  displayName: string
  unit?: string
  section: Section
  count: number
  favorite: boolean
  lastAdded: number
  /** Remembered price for the cost estimate — the price of ONE package
   *  (one jar/can/lb), so the line total is price × buyCount. */
  price?: number
  /** Remembered specific product from Refine (brand/size), shown on tap. */
  detail?: string
  /** Remembered Buy layer, so re-adding a refined favorite brings its pack
   *  spec back. Mirrors the fields on Item. */
  buyCount?: number
  sizeAmount?: number
  sizeUnit?: string
  packaging?: string
}

/** The record kinds that sync. Matches the server's allow-list. */
export type SyncKind =
  | 'list'
  | 'item'
  | 'recipe'
  /** Retired: staples moved into the pantry as a flag. Kept so a device
   *  still on the old schema can finish syncing. */
  | 'staple'
  | 'catalog'
  | 'setting'

/**
 * A delete, remembered. Without this a delete cannot travel: the next pull from
 * any other device — which still has the row — would put it straight back.
 * Grow-only locally; the server forgets them after 90 days.
 */
export interface Tombstone {
  id?: number
  kind: SyncKind
  uid: string
  deletedAt: number
}

/**
 * A synced preference.
 *
 * In the database rather than localStorage so it rides the existing sync engine
 * with no special case: same uid/updatedAt stamping, same last-write-wins, same
 * merge. The `uid` is the KEY, not a random id — two devices must recognise
 * each other's "mise.store" as the same record rather than accumulating one per
 * device, and a key is the only thing both of them already agree on.
 *
 * localStorage is still the read path for anything needed synchronously before
 * React renders (the theme), and is kept in step from here.
 */
export interface Setting {
  id?: number
  uid?: string
  updatedAt?: number
  key: string
  value: string
}

export class MiseDB extends Dexie {
  items!: Table<Item, number>
  recipes!: Table<Recipe, number>
  staples!: Table<Staple, number>
  catalog!: Table<CatalogEntry, number>
  lists!: Table<List, number>
  tombstones!: Table<Tombstone, number>
  settings!: Table<Setting, number>

  constructor() {
    super('mise')
    this.version(1).stores({
      items: '++id, canonicalKey, section, checked, backlog',
      recipes: '++id, title',
      staples: '++id, &canonicalKey',
    })
    this.version(2).stores({
      catalog: '++id, &canonicalKey, favorite, count',
    })
    // v3: lists become first-class. Every existing item belongs to the
    // grocery list it was always implicitly on.
    this.version(3)
      .stores({
        lists: '++id, kind',
        items: '++id, listId, canonicalKey, section, checked, backlog',
      })
      .upgrade(async (tx) => {
        const id = await tx.table('lists').add({
          name: 'Groceries',
          kind: 'grocery',
          createdAt: Date.now(),
        })
        await tx
          .table('items')
          .toCollection()
          .modify((i: Item) => {
            i.listId = id as number
          })
      })

    // v4: sync. Every row gains a `uid` (its identity across devices) and an
    // `updatedAt` (which edit wins), and deletes start leaving tombstones.
    //
    // Purely additive: no existing field is renamed, moved or dropped, and the
    // local `++id` primary keys are untouched, so every call site that holds an
    // id keeps working. A device that never signs in behaves exactly as before,
    // just with two more fields it ignores.
    this.version(4)
      .stores({
        lists: '++id, &uid, kind',
        items: '++id, &uid, listId, canonicalKey, section, checked, backlog',
        recipes: '++id, &uid, title',
        staples: '++id, &uid, &canonicalKey',
        catalog: '++id, &uid, &canonicalKey, favorite, count',
        tombstones: '++id, &[kind+uid]',
      })

    // v5: staples move into the pantry as a flag. See Item.alwaysHave.
    this.version(5)
      .stores({
        items: '++id, &uid, listId, canonicalKey, section, checked, backlog',
      })
      .upgrade(async (tx) => {
        const staples = await tx.table('staples').toArray()
        if (!staples.length) return

        // They need somewhere to live. Reuse a pantry list if there is one
        // rather than making a second.
        const lists = await tx.table('lists').toArray()
        let pantry = lists.find((l: { kind?: string }) => l.kind === 'pantry')
        if (!pantry) {
          const id = await tx.table('lists').add({
            name: 'Pantry',
            kind: 'pantry',
            icon: 'pantry',
            createdAt: Date.now(),
            uid: 'default:pantry',
            updatedAt: Date.now(),
          })
          pantry = { id }
        }

        const existing = await tx.table('items').toArray()
        const have = new Set(
          existing
            .filter((i: { listId?: number }) => i.listId === pantry.id)
            .map((i: { canonicalKey: string }) => i.canonicalKey),
        )
        const now = Date.now()
        for (const st of staples) {
          if (have.has(st.canonicalKey)) {
            // Already in the pantry — just mark it.
            const row = existing.find(
              (i: { listId?: number; canonicalKey: string }) =>
                i.listId === pantry.id && i.canonicalKey === st.canonicalKey,
            )
            if (row) await tx.table('items').update(row.id, { alwaysHave: true, updatedAt: now })
            continue
          }
          await tx.table('items').add({
            listId: pantry.id,
            displayName: st.displayName,
            canonicalKey: st.canonicalKey,
            section: 'pantry',
            checked: false, // in stock; a staple you have is not "out"
            backlog: false,
            alwaysHave: true,
            createdAt: now,
            updatedAt: now,
            uid: newUid(),
          })
        }
        // The rows themselves are cleared by migrateStaples() after the upgrade
        // commits, because deleting them has to leave tombstones and a Dexie
        // upgrade transaction is the wrong place to be writing those.
      })
      .upgrade(async (tx) => {
        // Backfill. `updatedAt` falls back to createdAt where there is one, so
        // rows keep a truthful order rather than all claiming to be edited at
        // the moment of the upgrade — which would make this device beat every
        // other device on every row the first time it syncs.
        const now = Date.now()
        for (const name of ['lists', 'items', 'recipes', 'staples', 'catalog']) {
          await tx
            .table(name)
            .toCollection()
            .modify((row: { uid?: string; updatedAt?: number; createdAt?: number }) => {
              if (!row.uid) row.uid = newUid()
              if (row.updatedAt == null) row.updatedAt = row.createdAt ?? now
            })
        }
      })

    // v6: preferences become synced rows. See Setting.
    this.version(6).stores({
      settings: '++id, &key, &uid',
    })
  }
}

/**
 * A record id that is unique across devices without coordination.
 * `randomUUID` needs a secure context; Mise is HTTPS everywhere it syncs, but
 * the fallback keeps a plain-HTTP dev server working.
 */
export function newUid(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  const b = new Uint8Array(16)
  c.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

export const db = new MiseDB()

// When another copy of Mise (the installed app + a browser tab, or two tabs)
// needs to change the schema, close this connection so it isn't the one that
// blocks the upgrade — a blocked upgrade hangs every query forever with no
// error, which looks exactly like "all my data vanished".
db.on('versionchange', () => db.close())

/** Read every table, but never hang: if the open is blocked by another copy of
 *  Mise the promise rejects after `ms` so the UI can say so instead of spinning
 *  on "Reading…". Returns the raw arrays/counts. */
export async function readAllWithTimeout(ms = 8000): Promise<{
  items: Item[]
  recipes: number
  lists: List[]
  catalog: number
}> {
  const read = (async () => ({
    items: await db.items.toArray(),
    recipes: await db.recipes.count(),
    lists: await db.lists.toArray(),
    catalog: await db.catalog.count(),
  }))()
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('STORAGE_BLOCKED')), ms),
  )
  return Promise.race([read, timeout])
}

/**
 * Clear the migrated `staples` rows, leaving tombstones.
 *
 * Deliberately NOT part of the v5 upgrade. Deleting them has to propagate, and
 * this app's own sync rule is that absence never deletes — only a tombstone
 * does. Without one, the next pull would hand every staple straight back from
 * the server and the migration would appear to undo itself overnight.
 *
 * Runs after open, is idempotent, and is safe on a device that never synced.
 */
export async function migrateStaples(): Promise<number> {
  const rows = await db.staples.toArray()
  if (!rows.length) return 0
  const now = Date.now()
  await db.transaction('rw', db.staples, db.tombstones, async () => {
    for (const st of rows) {
      // Only rows carrying a uid were ever synced; one without has no
      // counterpart on the server and needs no tombstone.
      if (st.uid) await db.tombstones.put({ kind: 'staple', uid: st.uid, deletedAt: now })
    }
    await db.staples.clear()
  })
  return rows.length
}

/** Normalize a free-text name into a merge key: lowercase, singular-ish, trimmed. */
export function canonicalize(name: string): string {
  let k = name.trim().toLowerCase()
  // strip a leading article
  k = k.replace(/^(a|an|the)\s+/, '')
  // naive singularization for common cases
  if (k.endsWith('ies')) k = k.slice(0, -3) + 'y'
  else if (k.endsWith('oes')) k = k.slice(0, -2)
  else if (k.endsWith('ses')) k = k.slice(0, -2)
  else if (k.endsWith('s') && !k.endsWith('ss')) k = k.slice(0, -1)
  return k
}
