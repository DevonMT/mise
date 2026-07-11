import { db, type CatalogEntry, type Section } from './db'
import { estimatePrices } from './parse'

/** Record an add into the catalog: bump its count and refresh its details.
 *  Called from addItem() so every add path (manual, capture, recipe) feeds it. */
export async function recordCatalog(o: {
  canonicalKey: string
  displayName: string
  unit?: string
  section: Section
}): Promise<void> {
  const existing = await db.catalog.where('canonicalKey').equals(o.canonicalKey).first()
  if (existing?.id != null) {
    await db.catalog.update(existing.id, {
      count: existing.count + 1,
      displayName: o.displayName,
      unit: o.unit,
      section: o.section,
      lastAdded: Date.now(),
    })
  } else {
    await db.catalog.add({
      canonicalKey: o.canonicalKey,
      displayName: o.displayName,
      unit: o.unit,
      section: o.section,
      count: 1,
      favorite: false,
      lastAdded: Date.now(),
    })
  }
}

export async function toggleFavorite(entry: CatalogEntry): Promise<void> {
  if (entry.id != null) await db.catalog.update(entry.id, { favorite: !entry.favorite })
}

export async function removeFromCatalog(entry: CatalogEntry): Promise<void> {
  if (entry.id != null) await db.catalog.delete(entry.id)
}

/** Set a remembered price for one item (upserts a catalog entry if needed). */
export async function setPrice(
  canonicalKey: string,
  displayName: string,
  section: Section,
  price: number | undefined,
): Promise<void> {
  const existing = await db.catalog.where('canonicalKey').equals(canonicalKey).first()
  if (existing?.id != null) {
    await db.catalog.update(existing.id, { price })
  } else {
    await db.catalog.add({
      canonicalKey,
      displayName,
      section,
      count: 0,
      favorite: false,
      lastAdded: Date.now(),
      price,
    })
  }
}

/**
 * Ask Claude to price catalog items for a store and save the results.
 * mode 'missing' only fills items with no price; 'all' re-prices everything.
 * Returns how many prices were written.
 */
export async function estimateStorePrices(
  store: string,
  mode: 'missing' | 'all',
): Promise<number> {
  const all = await db.catalog.toArray()
  const targets = mode === 'all' ? all : all.filter((c) => c.price == null)
  if (targets.length === 0) return 0

  const estimates = await estimatePrices(
    store,
    targets.map((c) => ({ canonicalKey: c.canonicalKey, displayName: c.displayName, unit: c.unit })),
  )
  const byKey = new Map(estimates.map((e) => [e.canonicalKey, e.price]))

  let n = 0
  await db.transaction('rw', db.catalog, async () => {
    for (const c of targets) {
      const p = byKey.get(c.canonicalKey)
      if (p != null && Number.isFinite(p) && c.id != null) {
        await db.catalog.update(c.id, { price: p })
        n++
      }
    }
  })
  return n
}

