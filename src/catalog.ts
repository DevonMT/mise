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

/** Set favorite on/off by key. Also syncs the stored name/unit/section to the
 *  current item, so favoriting a refined item keeps its refined name. */
export async function setFavoriteByKey(
  canonicalKey: string,
  displayName: string,
  section: Section,
  favorite: boolean,
  unit?: string,
): Promise<void> {
  const existing = await db.catalog.where('canonicalKey').equals(canonicalKey).first()
  if (existing?.id != null) {
    await db.catalog.update(existing.id, { favorite, displayName, unit, section })
  } else {
    await db.catalog.add({
      canonicalKey,
      displayName,
      unit,
      section,
      count: 0,
      favorite,
      lastAdded: Date.now(),
    })
  }
}

/** Keep the catalog's stored name/unit in sync when an item is renamed/edited. */
export async function syncCatalogName(
  canonicalKey: string,
  displayName: string,
  unit?: string,
): Promise<void> {
  const existing = await db.catalog.where('canonicalKey').equals(canonicalKey).first()
  if (existing?.id != null) {
    await db.catalog.update(existing.id, { displayName, unit })
  }
}

export async function removeFromCatalog(entry: CatalogEntry): Promise<void> {
  if (entry.id != null) await db.catalog.delete(entry.id)
}

/** Sync a catalog entry to a refined choice: keep the basic displayName, but
 *  remember the specific product as `detail`, plus its size (unit) and price. */
export async function applyRefinement(
  canonicalKey: string,
  detail: string,
  unit: string | undefined,
  section: Section,
  price: number,
): Promise<void> {
  const existing = await db.catalog.where('canonicalKey').equals(canonicalKey).first()
  if (existing?.id != null) {
    await db.catalog.update(existing.id, { detail, unit, price })
  } else {
    await db.catalog.add({
      canonicalKey,
      displayName: canonicalKey,
      unit,
      section,
      count: 0,
      favorite: false,
      lastAdded: Date.now(),
      detail,
      price,
    })
  }
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

/** Distinct canonical keys of items on a grocery list right now (active, not
 *  backlog). This — NOT the whole historical catalog — is what pricing targets,
 *  so we never pay to price things you've since removed. */
export async function priceableKeys(): Promise<Set<string>> {
  const lists = await db.lists.toArray()
  const groceryIds = new Set(lists.filter((l) => l.kind === 'grocery').map((l) => l.id))
  const items = await db.items.toArray()
  return new Set(
    items.filter((i) => groceryIds.has(i.listId) && !i.backlog).map((i) => i.canonicalKey),
  )
}

/**
 * Ask Claude to price the items ON YOUR GROCERY LISTS for a store, and save the
 * results. mode 'missing' only fills ones with no price yet; 'all' re-prices
 * them. Never touches catalog entries that aren't currently on a list.
 * Returns how many prices were written.
 */
export async function estimateStorePrices(
  store: string,
  mode: 'missing' | 'all',
): Promise<number> {
  const keys = await priceableKeys()
  if (keys.size === 0) return 0

  // Make sure each on-list item has a catalog entry to hold its price.
  const items = await db.items.toArray()
  for (const it of items) {
    if (!keys.has(it.canonicalKey)) continue
    const existing = await db.catalog.where('canonicalKey').equals(it.canonicalKey).first()
    if (!existing) {
      await db.catalog.add({
        canonicalKey: it.canonicalKey,
        displayName: it.displayName,
        unit: it.unit,
        section: it.section,
        count: 0,
        favorite: false,
        lastAdded: Date.now(),
      })
    }
  }

  const catalog = await db.catalog.toArray()
  const onList = catalog.filter((c) => keys.has(c.canonicalKey))
  const targets = mode === 'all' ? onList : onList.filter((c) => c.price == null)
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

