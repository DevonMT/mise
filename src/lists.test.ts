/**
 * Duplicate lists: stopping new ones, and cleaning up the old.
 *
 * The repair runs at startup and DELETES, so the tests that matter are the ones
 * proving what it refuses to touch.
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
  value: { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {},
           matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) },
})
;(globalThis as unknown as { CustomEvent: unknown }).CustomEvent = class {}

const { db } = await import('./db')
const lists = await import('./lists')

const addList = (name: string, kind: string, uid?: string) =>
  db.lists.add({ name, kind: kind as never, createdAt: Date.now(), ...(uid ? { uid } : {}) })

test('a seeded default gets a deterministic id, not a random one', async () => {
  await db.lists.clear()
  const id = await lists.ensureSeed()
  const row = await db.lists.get(id)
  assert.equal(row?.uid, lists.DEFAULT_LIST_UID)

  const pid = await lists.ensurePantryList()
  assert.equal((await db.lists.get(pid))?.uid, lists.DEFAULT_PANTRY_UID)
})

test('two devices seeding produce the SAME identity, so a merge collapses them', async () => {
  // The actual bug: random ids meant the phone's Pantry and the laptop's Pantry
  // were different records and sync kept both.
  await db.lists.clear()
  const a = await lists.ensurePantryList()
  await db.lists.clear()
  const b = await lists.ensurePantryList()
  const uidA = lists.DEFAULT_PANTRY_UID
  assert.equal((await db.lists.get(b))?.uid, uidA)
  assert.notEqual(a, b, 'different local ids')
})

test('the repair removes an empty duplicate the app made', async () => {
  await db.lists.clear()
  await db.items.clear()
  const keep = await addList('Pantry', 'pantry', 'default:pantry')
  await addList('Pantry', 'pantry', 'random-uid-from-the-other-device')
  const { removed } = await lists.dedupeDefaultLists()
  assert.deepEqual(removed, ['Pantry'])
  const left = await db.lists.toArray()
  assert.equal(left.length, 1)
  assert.equal(left[0].id, keep, 'the oldest survived')
})

test('the repair NEVER removes a list with anything in it', async () => {
  await db.lists.clear()
  await db.items.clear()
  await addList('Pantry', 'pantry', 'default:pantry')
  const dup = await addList('Pantry', 'pantry', 'other')
  await db.items.add({
    listId: dup as number, displayName: 'Salt', canonicalKey: 'salt',
    section: 'pantry', checked: false, backlog: false, createdAt: 1,
  })
  const { removed, leftAlone } = await lists.dedupeDefaultLists()
  assert.deepEqual(removed, [], 'nothing deleted')
  assert.deepEqual(leftAlone, ['Pantry'], 'and it says so')
  assert.equal((await db.lists.toArray()).length, 2)
})

test('the repair never touches a list you named yourself', async () => {
  await db.lists.clear()
  await db.items.clear()
  await addList('Pantry', 'pantry', 'default:pantry')
  await addList('Freezer', 'pantry', 'mine')
  const { removed } = await lists.dedupeDefaultLists()
  assert.deepEqual(removed, [], 'a second pantry called Freezer is deliberate')
  assert.equal((await db.lists.toArray()).length, 2)
})

test('the repair leaves a single list of a kind alone', async () => {
  await db.lists.clear()
  await db.items.clear()
  await addList('My list', 'grocery', 'default:list')
  const { removed } = await lists.dedupeDefaultLists()
  assert.deepEqual(removed, [])
  assert.equal((await db.lists.toArray()).length, 1)
})

test('a fresh device that will sync does not seed before its first sync', async () => {
  // This is what put "My list" beside an account that already had "Groceries".
  await db.lists.clear()
  store.set('mise.sync.enabled', '1')
  store.delete('mise.sync.last')
  await lists.ensureDefaultLists()
  assert.equal((await db.lists.toArray()).length, 0, 'waited')

  store.set('mise.sync.last', String(Date.now()))
  await lists.ensureDefaultLists()
  assert.ok((await db.lists.toArray()).length > 0, 'seeded once the sync had run')
  store.delete('mise.sync.enabled')
  store.delete('mise.sync.last')
})

test('a device with sync off seeds immediately', async () => {
  await db.lists.clear()
  store.delete('mise.sync.enabled')
  await lists.ensureDefaultLists()
  const all = await db.lists.toArray()
  assert.ok(all.some((l) => l.kind === 'grocery'))
  assert.ok(all.some((l) => l.kind === 'pantry'))
})
