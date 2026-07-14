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
}

/** A saved recipe. */
export interface Recipe {
  id?: number
  title: string
  servings: number
  ingredients: Array<Pick<Item, 'displayName' | 'canonicalKey' | 'quantity' | 'unit' | 'section'>>
  /** Free-text cooking steps, if captured. */
  instructions?: string
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
