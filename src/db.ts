import Dexie, { type Table } from 'dexie'

/** Fixed store-section taxonomy — drives the aisle grouping order. */
export type Section =
  | 'produce'
  | 'meat'
  | 'dairy'
  | 'bakery'
  | 'frozen'
  | 'pantry'
  | 'household'
  | 'other'

/**
 * What a list is *for*. The kind decides which of Mise's smarts wake up
 * (see kinds.ts) — the underlying item shape is shared by all of them.
 */
export type ListKind = 'grocery' | 'tasks' | 'pantry'

export interface List {
  id?: number
  name: string
  kind: ListKind
  /** Icon key (see Icon.tsx LIST_ICON_KEYS). Falls back to the kind's default. */
  icon?: string
  createdAt: number
}

export interface Item {
  id?: number
  /** Which list this belongs to. */
  listId: number
  displayName: string
  /** Normalized key used to merge duplicates across sources (e.g. "onion"). */
  canonicalKey: string
  quantity?: number
  unit?: string
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
}

/** One line of a recipe. `optional` ingredients are never added to the list
 *  by default — you opt into them. */
export type RecipeIngredient = Pick<
  Item,
  'displayName' | 'canonicalKey' | 'quantity' | 'unit' | 'section'
> & { optional?: boolean }

/** A saved recipe. */
export interface Recipe {
  id?: number
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

/** A staple you always have — filtered out of grocery lists. */
export interface Staple {
  id?: number
  canonicalKey: string
  displayName: string
}

/** Everything you've ever added — powers quick re-add (favorites) and
 *  the remembered price per item. Global, not per-list: it describes *you*. */
export interface CatalogEntry {
  id?: number
  canonicalKey: string
  displayName: string
  unit?: string
  section: Section
  count: number
  favorite: boolean
  lastAdded: number
  /** Remembered unit price for the cost estimate. */
  price?: number
  /** Remembered specific product from Refine (brand/size), shown on tap. */
  detail?: string
}

export class MiseDB extends Dexie {
  items!: Table<Item, number>
  recipes!: Table<Recipe, number>
  staples!: Table<Staple, number>
  catalog!: Table<CatalogEntry, number>
  lists!: Table<List, number>

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
  }
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
