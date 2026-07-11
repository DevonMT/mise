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

export interface Item {
  id?: number
  displayName: string
  /** Normalized key used to merge duplicates across sources (e.g. "onion"). */
  canonicalKey: string
  quantity?: number
  unit?: string
  section: Section
  checked: boolean
  /** true = parked in the "next time" backlog, not on the active trip. */
  backlog: boolean
  createdAt: number
}

/** A saved recipe (Phase 3 — table defined now so the schema is stable). */
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

/** A staple you always have — filtered out of the list (Phase 2). */
export interface Staple {
  id?: number
  canonicalKey: string
  displayName: string
}

/** Everything you've ever added — powers quick re-add (favorites + frequent)
 *  and, later, the cost estimate (remembered price per item). */
export interface CatalogEntry {
  id?: number
  canonicalKey: string
  displayName: string
  unit?: string
  section: Section
  count: number
  favorite: boolean
  lastAdded: number
  /** Remembered unit price for the cost estimate (Phase 4). */
  price?: number
}

export class MiseDB extends Dexie {
  items!: Table<Item, number>
  recipes!: Table<Recipe, number>
  staples!: Table<Staple, number>
  catalog!: Table<CatalogEntry, number>

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
