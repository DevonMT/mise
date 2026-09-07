import { db, newUid } from './db'

/*
 * NAMED prefs.ts, not settings.ts.
 *
 * Settings.tsx (the view) already exists, and TypeScript refuses two files
 * differing only in case on a case-insensitive filesystem — the same collision
 * that is why RecipesView.tsx is not Recipes.tsx.
 */

/**
 * Preferences that follow the account, and the ones that deliberately do not.
 *
 * WHAT SYNCS: your store, its aisle walk, the theme, whether you have seen the
 * swipe hint. Things you decide once and would be annoyed to set again on the
 * other device.
 *
 * WHAT MUST NOT, and why each one would actually break something:
 *
 *   mise.sync.enabled   The switch itself. Syncing it means turning sync off on
 *                       the laptop silently switches it off on the phone, and a
 *                       device that never opted in would start syncing because
 *                       another one did.
 *   mise.sync.device    This device's identity. If every device shared one, the
 *                       server could not tell who pushed a change and the rule
 *                       that stops a device being woken by its own edit fails.
 *   mise.sync.last      A local timestamp. Meaningless anywhere else.
 *   mise.activeList     Which list you are looking at. Your phone is on the
 *                       shopping list in a shop while the laptop is on the meal
 *                       plan; syncing this would yank each between them.
 *
 * The exclusions are the interesting half. "Sync everything" applied literally
 * to the first two would make sync impossible to turn off and impossible to
 * attribute.
 */
export const SYNCED_KEYS = ['mise.store', 'mise.aisles', 'mise.theme', 'mise.swipeHint'] as const

export type SyncedKey = (typeof SYNCED_KEYS)[number]

const isSynced = (k: string): k is SyncedKey => (SYNCED_KEYS as readonly string[]).includes(k)

/** Fires when a synced setting arrives from another device, so a view showing
 *  one can re-read it without a reload. */
export const SETTINGS_EVENT = 'mise:settings'

/**
 * Write a preference.
 *
 * Both places, deliberately: the row is what syncs, and localStorage stays the
 * synchronous read path for anything needed before React renders. Writing only
 * the row would mean the theme flashing wrong on every launch.
 */
export async function setSetting(key: SyncedKey, value: string): Promise<void> {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private window, or storage blocked — the row is still authoritative */
  }
  const existing = await db.settings.where('key').equals(key).first()
  if (existing?.id != null) {
    await db.settings.update(existing.id, { value })
  } else {
    // uid IS the key, so two devices converge on one row instead of each
    // creating their own and last-write-wins never getting a chance to run.
    await db.settings.add({ key, value, uid: key })
  }
}

export function readSetting(key: SyncedKey): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/**
 * Bring localStorage in line with the rows, at startup and after a merge.
 *
 * The rows are authoritative because they are what syncs; localStorage is a
 * cache in front of them. Anything that changed is announced so a mounted view
 * re-reads rather than showing a value the database no longer holds.
 */
export async function hydrateSettings(): Promise<string[]> {
  const rows = await db.settings.toArray()
  const changed: string[] = []
  for (const row of rows) {
    if (!isSynced(row.key)) continue
    try {
      if (localStorage.getItem(row.key) !== row.value) {
        localStorage.setItem(row.key, row.value)
        changed.push(row.key)
      }
    } catch {
      /* nothing to cache into */
    }
  }
  if (changed.length) {
    window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: changed }))
  }
  return changed
}

/**
 * One-time lift of whatever is already in localStorage into rows.
 *
 * Without it, a device that has had a store name and an aisle order for months
 * would push nothing and then be overwritten by an empty set from a device that
 * has never been configured — a silent loss of exactly the settings this
 * feature exists to preserve.
 */
export async function migrateSettings(): Promise<number> {
  let moved = 0
  for (const key of SYNCED_KEYS) {
    let local: string | null = null
    try {
      local = localStorage.getItem(key)
    } catch {
      continue
    }
    if (local == null) continue
    const existing = await db.settings.where('key').equals(key).first()
    if (existing) continue
    await db.settings.add({ key, value: local, uid: key, updatedAt: Date.now() })
    moved++
  }
  return moved
}

/** Mint a uid for a settings row created outside setSetting. */
export const settingUid = (key: string) => key || newUid()
