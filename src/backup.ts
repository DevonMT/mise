import { db } from './db'

/**
 * Local backup. Mise stores everything in on-device IndexedDB with no server
 * copy, so a browser eviction or clear wipes it with no recourse — unless you
 * have an export. This is that safety net: dump every table to JSON, and
 * restore it back with bulkPut (merges by primary key — safe to re-run).
 */

export interface Backup {
  mise: 1
  exportedAt: number
  items: unknown[]
  recipes: unknown[]
  staples: unknown[]
  catalog: unknown[]
  lists: unknown[]
}

export async function exportAll(): Promise<Backup> {
  const [items, recipes, staples, catalog, lists] = await Promise.all([
    db.items.toArray(),
    db.recipes.toArray(),
    db.staples.toArray(),
    db.catalog.toArray(),
    db.lists.toArray(),
  ])
  return { mise: 1, exportedAt: Date.now(), items, recipes, staples, catalog, lists }
}

export interface RestoreCounts {
  items: number
  recipes: number
  staples: number
  catalog: number
  lists: number
}

export async function importAll(json: string): Promise<RestoreCounts> {
  let data: Partial<Backup>
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error("That doesn't look like a Mise backup file.")
  }
  if (!data || data.mise !== 1) throw new Error("That doesn't look like a Mise backup file.")

  await db.transaction('rw', db.items, db.recipes, db.staples, db.catalog, db.lists, async () => {
    if (Array.isArray(data.lists)) await db.lists.bulkPut(data.lists as never[])
    if (Array.isArray(data.items)) await db.items.bulkPut(data.items as never[])
    if (Array.isArray(data.recipes)) await db.recipes.bulkPut(data.recipes as never[])
    if (Array.isArray(data.staples)) await db.staples.bulkPut(data.staples as never[])
    if (Array.isArray(data.catalog)) await db.catalog.bulkPut(data.catalog as never[])
  })

  return {
    items: data.items?.length ?? 0,
    recipes: data.recipes?.length ?? 0,
    staples: data.staples?.length ?? 0,
    catalog: data.catalog?.length ?? 0,
    lists: data.lists?.length ?? 0,
  }
}

/** Trigger a file download of the backup (saves to the device's Downloads). */
export async function downloadBackup(): Promise<void> {
  const backup = await exportAll()
  const stamp = new Date(backup.exportedAt).toISOString().slice(0, 10)
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `mise-backup-${stamp}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
