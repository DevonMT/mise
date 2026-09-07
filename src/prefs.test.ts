/**
 * Which preferences sync, and — more importantly — which must not.
 *
 * "Sync everything" applied literally to the sync switch or the device id makes
 * sync impossible to turn off and impossible to attribute, so the exclusions
 * are the half worth pinning down.
 */
import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
})
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} },
})
class FakeEvent {
  constructor(public type: string, public init?: unknown) {}
}
;(globalThis as unknown as { CustomEvent: unknown }).CustomEvent = FakeEvent

const prefs = await import('./prefs')
const { db } = await import('./db')

test('the settings that follow you are the ones you set once', () => {
  assert.deepEqual([...prefs.SYNCED_KEYS].sort(), [
    'mise.aisles', 'mise.store', 'mise.swipeHint', 'mise.theme',
  ])
})

test('the sync switch itself never syncs', () => {
  // Otherwise turning sync off on one device switches it off everywhere, and a
  // device that never opted in starts syncing because another one did.
  assert.ok(!prefs.SYNCED_KEYS.includes('mise.sync.enabled' as never))
})

test('the device identity never syncs', () => {
  // Every device would share one id, and the server could no longer tell who
  // pushed a change — the rule that stops a device being woken by its own edit.
  assert.ok(!prefs.SYNCED_KEYS.includes('mise.sync.device' as never))
})

test('which list you are looking at never syncs', () => {
  // The phone is on the shopping list in a shop while the laptop is on the meal
  // plan. Syncing this would yank each of them between the two.
  assert.ok(!prefs.SYNCED_KEYS.includes('mise.activeList' as never))
})

test('a setting is stored under a uid equal to its key', async () => {
  // Not a random uid: two devices must recognise each other's "mise.store" as
  // one record, or each keeps its own and last-write-wins never runs.
  await prefs.setSetting('mise.store', 'Harps')
  const row = await db.settings.where('key').equals('mise.store').first()
  assert.equal(row?.value, 'Harps')
  assert.equal(row?.uid, 'mise.store')
})

test('writing twice updates the row rather than adding another', async () => {
  await prefs.setSetting('mise.store', 'Aldi')
  await prefs.setSetting('mise.store', 'Walmart')
  const rows = await db.settings.where('key').equals('mise.store').toArray()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].value, 'Walmart')
})

test('hydrate brings the cache in line with the rows', async () => {
  // Rows are authoritative — they are what syncs. A merge writes rows, and the
  // synchronous read path in front of them has to be told.
  await prefs.setSetting('mise.theme', 'dark')
  store.set('mise.theme', 'light') // as if a merge had changed the row underneath
  const row = await db.settings.where('key').equals('mise.theme').first()
  await db.settings.update(row!.id!, { value: 'dark' })
  const changed = await prefs.hydrateSettings()
  assert.ok(changed.includes('mise.theme'))
  assert.equal(prefs.readSetting('mise.theme'), 'dark')
})

test('migration lifts existing local values, and never overwrites a row', async () => {
  await db.settings.clear()
  store.set('mise.store', 'Corner shop')
  store.set('mise.sync.enabled', '1') // must be ignored
  const moved = await prefs.migrateSettings()
  assert.ok(moved >= 1)
  const rows = await db.settings.toArray()
  assert.ok(rows.some((r) => r.key === 'mise.store' && r.value === 'Corner shop'))
  assert.ok(!rows.some((r) => r.key === 'mise.sync.enabled'), 'the switch was not lifted')

  // Running again must not clobber a row that has since been synced.
  await prefs.setSetting('mise.store', 'From the laptop')
  store.set('mise.store', 'stale local value')
  await prefs.migrateSettings()
  const after = await db.settings.where('key').equals('mise.store').first()
  assert.equal(after?.value, 'From the laptop', 'the row won, not the stale cache')
})
