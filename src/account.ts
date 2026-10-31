/**
 * Which account this device's lists belong to (#278).
 *
 * IndexedDB belongs to the browser, not to whoever is signed in. Before this,
 * signing in as somebody else on a shared browser meant the next auto-sync
 * pushed the previous person's lists into the new account, and pulled the new
 * account's into the same pile: a merge across two people that nobody asked
 * for and nobody can take apart afterwards.
 *
 * So the device remembers the account it last synced with, and every push says
 * so. The platform answers 409 when that is not who is signed in now, before it
 * merges anything, and sync stops until someone chooses (App's AccountSheet):
 *
 *   keep   the lists here become the signed-in account's (one push merges them)
 *   clear  this device forgets them, and takes the signed-in account's instead
 *
 * Never merged across accounts on its own. Signed out, none of this runs: the
 * lists are this browser's and work exactly as before.
 *
 * In localStorage beside the other mise.sync keys, not in IndexedDB: a new
 * table is a schema bump an older build cannot open, and a row would sync. The
 * cost is that clearing localStorage alone makes the device unbound again, and
 * an unbound device binds to whoever it next syncs as, which is also what every
 * device does once on the first sync after this ships.
 */
import { db } from './db'
import { SYNCED_KEYS } from './prefs'
import { keepingStamps, withoutSync } from './sync'

const ACCOUNT_KEY = 'mise.sync.account'

export function boundAccount(): string | null {
  try {
    return localStorage.getItem(ACCOUNT_KEY)
  } catch {
    return null
  }
}

/** null unbinds. */
export function bindAccount(id: string | null): void {
  if (id == null) localStorage.removeItem(ACCOUNT_KEY)
  else localStorage.setItem(ACCOUNT_KEY, id)
}

/** Per-device keys that describe the lists, not the device: they go with them.
 *  The switch and the device id stay. Every synced key goes, the store and the
 *  area (where the last person lives) included: left here, migrateSettings
 *  turns each into a row in the new account at the next launch. */
const DATA_KEYS = [
  ...SYNCED_KEYS, 'mise.activeList', 'mise.aisleOrder', 'mise.sync.folded', 'mise.sync.last',
  'mise.refineAsked',
]

/**
 * Forget every list, item, recipe and setting on this device, then bind it to
 * `account`. Nothing goes to any server: the rows are cleared without
 * tombstones (keepingStamps), because a tombstone here would delete them from
 * the account they belong to. Bound only after the clear has committed, so a
 * clear that fails part-way never pushes what is left into the new account,
 * and with no sync running (withoutSync), so no merge lands in the middle.
 */
export function clearThisDevice(account: string): Promise<void> {
  return withoutSync(async () => {
    const tables = [db.lists, db.items, db.recipes, db.staples, db.catalog, db.settings, db.tombstones]
    await keepingStamps(tables, async () => {
      for (const t of tables) await t.clear()
    })
    for (const k of DATA_KEYS) {
      try {
        localStorage.removeItem(k)
      } catch {
        /* storage blocked: nothing there to clear */
      }
    }
    bindAccount(account)
  })
}
