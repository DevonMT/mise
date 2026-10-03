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

test('the repair NEVER removes a non-pantry list with anything in it', async () => {
  await db.lists.clear()
  await db.items.clear()
  await addList('Groceries', 'grocery', 'default:list')
  const dup = await addList('Groceries', 'grocery', 'other')
  await db.items.add({
    listId: dup as number, displayName: 'Salt', canonicalKey: 'salt',
    section: 'pantry', checked: false, backlog: false, createdAt: 1,
  })
  const { removed, leftAlone, merged } = await lists.dedupeDefaultLists()
  assert.deepEqual(removed, [], 'nothing deleted')
  assert.deepEqual(leftAlone, ['Groceries'], 'and it says so')
  assert.equal(merged, 0)
  assert.equal((await db.lists.toArray()).length, 2)
})

test('a leftover Pantry with items is folded into default:pantry', async () => {
  await db.lists.clear()
  await db.items.clear()
  const keep = (await addList('Pantry', 'pantry', 'default:pantry')) as number
  const dup = (await addList('Pantry', 'pantry', 'random-uid')) as number
  const base = { section: 'pantry', checked: false, backlog: false, createdAt: 1 } as never
  await db.items.add({ ...base, listId: dup, displayName: 'Salt', canonicalKey: 'salt', alwaysHave: true })
  await db.items.add({ ...base, listId: dup, displayName: 'Pepper', canonicalKey: 'pepper', alwaysHave: true })
  await db.items.add({ ...base, listId: keep, displayName: 'Pepper', canonicalKey: 'pepper' })
  const { removed, merged } = await lists.dedupeDefaultLists()
  assert.deepEqual(removed, ['Pantry'])
  assert.equal(merged, 2)
  const left = await db.lists.toArray()
  assert.deepEqual(left.map((l) => l.uid), ['default:pantry'], 'the shared one survives')
  const items = await db.items.toArray()
  assert.deepEqual(items.map((i) => i.canonicalKey).sort(), ['pepper', 'salt'], 'no duplicate pepper')
  assert.ok(items.every((i) => i.listId === keep))
  assert.ok(items.find((i) => i.canonicalKey === 'pepper')?.alwaysHave, 'flag carried over')
  assert.equal((await lists.dedupeDefaultLists()).merged, 0, 'second run is a no-op')
})

test('a leftover Pantry with items and no shared Pantry is left alone', async () => {
  await db.lists.clear()
  await db.items.clear()
  await addList('Pantry', 'pantry', 'older-random')
  const dup = await addList('Pantry', 'pantry', 'newer-random')
  await db.items.add({
    listId: dup as number, displayName: 'Salt', canonicalKey: 'salt',
    section: 'pantry', checked: false, backlog: false, createdAt: 1,
  })
  const { removed, leftAlone, merged } = await lists.dedupeDefaultLists()
  assert.deepEqual(removed, [])
  assert.deepEqual(leftAlone, ['Pantry'])
  assert.equal(merged, 0)
})

test('ensurePantryList prefers the shared Pantry over a lower-id leftover', async () => {
  await db.lists.clear()
  await addList('Pantry', 'pantry', 'random-uid')
  const shared = (await addList('Pantry', 'pantry', 'default:pantry')) as number
  assert.equal(await lists.ensurePantryList(), shared)
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
  store.set('mise.sync.enabled', '0')
  await lists.ensureDefaultLists()
  const all = await db.lists.toArray()
  assert.ok(all.some((l) => l.kind === 'grocery'))
  assert.ok(all.some((l) => l.kind === 'pantry'))
  store.delete('mise.sync.enabled')
})

const withHealth = async (status: number, fn: () => Promise<void>) => {
  const real = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ variant: null }), { status })) as typeof fetch
  try {
    await fn()
  } finally {
    globalThis.fetch = real
  }
}

test('a never-chosen device that is signed in turns sync on and waits to seed', async () => {
  // The website copy opened empty while the phone held everything: sync was
  // off by default, and nothing ever said to turn it on.
  await db.lists.clear()
  store.delete('mise.sync.enabled')
  store.delete('mise.sync.last')
  await withHealth(200, () => lists.ensureDefaultLists())
  assert.equal(store.get('mise.sync.enabled'), '1')
  assert.equal((await db.lists.toArray()).length, 0, 'waited for the first sync')
  store.delete('mise.sync.enabled')
})

test('a never-chosen device that is signed out stays undecided and seeds', async () => {
  await db.lists.clear()
  store.delete('mise.sync.enabled')
  await withHealth(401, () => lists.ensureDefaultLists())
  assert.equal(store.get('mise.sync.enabled'), undefined, 'no "off" recorded that nobody chose')
  assert.ok((await db.lists.toArray()).length > 0)
})

test('an explicit off is never overridden', async () => {
  store.set('mise.sync.enabled', '0')
  await withHealth(200, () => lists.ensureDefaultLists())
  assert.equal(store.get('mise.sync.enabled'), '0')
  store.delete('mise.sync.enabled')
})

test('a seeded default loses to any real copy of itself', async () => {
  await db.lists.clear()
  const id = await lists.ensureSeed()
  assert.equal((await db.lists.get(id))?.updatedAt, 0)
})

test('the repair never deletes the shared singleton, even when it is newer', async () => {
  // 2026-09-28: a browser's own older random-uid "My list" was kept and
  // default:list was tombstoned — which deletes the phone's main list.
  await db.lists.clear()
  await db.items.clear()
  await addList('My list', 'grocery', 'random-older')
  await addList('My list', 'grocery', 'default:list')
  const { removed } = await lists.dedupeDefaultLists()
  assert.deepEqual(removed, ['My list'])
  const left = await db.lists.toArray()
  assert.deepEqual(left.map((l) => l.uid), ['default:list'])
})
