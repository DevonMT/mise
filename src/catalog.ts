import { db, type CatalogEntry, type Section } from './db'

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
