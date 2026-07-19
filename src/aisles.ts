import { useEffect, useState } from 'react'
import type { Section } from './db'
import { SECTIONS } from './sections'

/**
 * Per-store aisle order. The on-list grouping walks sections in whatever order
 * matches YOUR store's layout (Walmart ≠ Harps), overriding the built-in
 * store-walk default. Kept in localStorage — it parallels `mise.store`, needs
 * no Dexie migration, and is reconciled against the current taxonomy on read so
 * adding/removing sections never corrupts a saved order.
 */

const KEY = 'mise.aisleOrder'
/** Fired when the order OR the active store changes, so grouping re-reads live. */
export const AISLE_EVENT = 'mise:aisles'

/** All section keys in the built-in store-walk default order. */
const DEFAULT_ORDER: Section[] = SECTIONS.map((s) => s.key)

/** Normalize a store name into its storage key ('' = no store / the Lite default). */
function storeKey(store: string): string {
  return store.trim().toLowerCase()
}

function readAll(): Record<string, Section[]> {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, Section[]>) : {}
  } catch {
    return {}
  }
}

/** Merge a stored order with the current taxonomy: keep the stored order for
 *  still-valid sections, drop any unknown keys, and append any sections the
 *  stored order is missing (new additions land after the customized ones). */
function reconcile(stored: Section[]): Section[] {
  const valid = new Set<Section>(DEFAULT_ORDER)
  const seen = new Set<Section>()
  const out: Section[] = []
  for (const s of stored) {
    if (valid.has(s) && !seen.has(s)) {
      out.push(s)
      seen.add(s)
    }
  }
  for (const s of DEFAULT_ORDER) if (!seen.has(s)) out.push(s)
  return out
}

/** The section order for a store — the saved custom order, else the default. */
export function getAisleOrder(store: string): Section[] {
  const stored = readAll()[storeKey(store)]
  return stored ? reconcile(stored) : DEFAULT_ORDER.slice()
}

/** Whether this store has a custom order saved (drives the Reset button). */
export function hasCustomOrder(store: string): boolean {
  return storeKey(store) in readAll()
}

export function setAisleOrder(store: string, order: Section[]): void {
  const all = readAll()
  all[storeKey(store)] = order
  localStorage.setItem(KEY, JSON.stringify(all))
  window.dispatchEvent(new CustomEvent(AISLE_EVENT))
}

/** Drop a store's custom order — grouping falls back to the store-walk default. */
export function resetAisleOrder(store: string): void {
  const all = readAll()
  delete all[storeKey(store)]
  localStorage.setItem(KEY, JSON.stringify(all))
  window.dispatchEvent(new CustomEvent(AISLE_EVENT))
}

/** Rank map for sorting groups: section -> its index in the order. */
export function rankFrom(order: Section[]): Record<Section, number> {
  return Object.fromEntries(order.map((s, i) => [s, i])) as Record<Section, number>
}

/** The active store's section order, re-read whenever the order or the active
 *  store changes (same tab via AISLE_EVENT, other tabs via `storage`). */
export function useAisleOrder(): Section[] {
  const read = () => getAisleOrder(localStorage.getItem('mise.store') ?? '')
  const [order, setOrder] = useState<Section[]>(read)
  useEffect(() => {
    const refresh = () => setOrder(read())
    window.addEventListener(AISLE_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(AISLE_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])
  return order
}
