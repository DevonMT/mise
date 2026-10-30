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

// The repair asks the platform which lists have people attached; tests answer
// and record the URL they were asked at.
let sharedUids: string[] | null = []
let sharedOut = false
const fetched: string[] = []
;(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  fetched.push(String(url))
  if (sharedUids === null) throw new Error('offline')
  return { ok: true, json: async () => ({ shares: sharedUids!.map((u) => ({ list_uid: u, mine: sharedOut })) }) }
}

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

test('the repair NEVER removes a list with items when it cannot fold it', async () => {
  // No shared list of this kind to receive the items: nothing moves, and it says so.
  await db.lists.clear()
  await db.items.clear()
  await addList('Groceries', 'grocery', 'older-random')
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

const base = { section: 'pantry', checked: false, backlog: false, createdAt: 1 } as never
const addItem = (listId: number, key: string, extra: object = {}) =>
  db.items.add({ ...base, listId, displayName: key, canonicalKey: key, ...extra })

/** The state #680 found: an empty default:list beside a pre-09-06 random-uid "My list" with items. */
async function seedPair(dupName = 'My list') {
  await db.lists.clear()
  await db.items.clear()
  const keep = (await addList('My list', 'grocery', 'default:list')) as number
  const dup = (await addList(dupName, 'grocery', '3fc04e98-random')) as number
  for (const k of ['milk', 'eggs', 'rice', 'oats', 'salt', 'tea']) await addItem(dup, k)
  return { keep, dup }
}

test('#680: a random-uid "My list" with items folds into default:list', async () => {
  const { keep } = await seedPair()
  const { removed, leftAlone, merged } = await lists.dedupeDefaultLists()
  assert.deepEqual(removed, ['My list'])
  assert.deepEqual(leftAlone, [])
  assert.equal(merged, 6)
  assert.deepEqual((await db.lists.toArray()).map((l) => l.uid), ['default:list'])
  const items = await db.items.toArray()
  assert.equal(items.length, 6)
  assert.ok(items.every((i) => i.listId === keep), 'every item moved to the shared list')
})

test('#680: the removal is a tombstone, so the other devices drop the duplicate too', async () => {
  const { dup } = await seedPair()
  const uid = (await db.lists.get(dup))!.uid!
  await db.tombstones.clear()
  await lists.dedupeDefaultLists()
  assert.equal(await db.lists.get(dup), undefined)
  const tombs = await db.tombstones.toArray()
  assert.ok(tombs.some((t) => t.kind === 'list' && t.uid === uid), 'a tombstone for the duplicate list')
  assert.ok(!tombs.some((t) => t.uid === 'default:list'), 'and never one for the shared list')
})

test('#680: a renamed list is never folded', async () => {
  const { dup } = await seedPair('Costco run')
  const { removed, merged } = await lists.dedupeDefaultLists()
  assert.deepEqual(removed, [])
  assert.equal(merged, 0)
  assert.equal((await db.lists.toArray()).length, 2)
  assert.equal((await db.items.toArray()).filter((i) => i.listId === dup).length, 6)
})

test('#680: a list shared with you (or by you) is never folded', async () => {
  const { dup } = await seedPair()
  for (const out of [false, true]) {
    sharedUids = ['3fc04e98-random']
    sharedOut = out
    const { removed, merged } = await lists.dedupeDefaultLists()
    assert.deepEqual(removed, [])
    assert.equal(merged, 0)
    assert.equal((await db.items.toArray()).filter((i) => i.listId === dup).length, 6)
  }
  sharedUids = []
  sharedOut = false
})

test('#680: folding is idempotent, and two devices converge on the same result', async () => {
  // Device A runs it, then device B (which held the same pair) does. Both end
  // with one list holding the same six keys, and a second run changes nothing.
  const keysAfter = async () => (await db.items.toArray()).map((i) => i.canonicalKey).sort()
  await seedPair()
  await lists.dedupeDefaultLists()
  const a = await keysAfter()
  await seedPair()
  await lists.dedupeDefaultLists()
  assert.deepEqual(await keysAfter(), a)
  const again = await lists.dedupeDefaultLists()
  assert.deepEqual(again, { removed: [], leftAlone: [], merged: 0 })
  assert.deepEqual(await keysAfter(), a)
})

test('#680: when the shares cannot be fetched a pair with items is not folded', async () => {
  const { dup } = await seedPair()
  sharedUids = null
  const { removed, merged } = await lists.dedupeDefaultLists()
  sharedUids = []
  assert.deepEqual(removed, [])
  assert.equal(merged, 0)
  assert.equal((await db.items.toArray()).filter((i) => i.listId === dup).length, 6)
})

test('#680: a renamed default:list keeper is left alone, not folded into', async () => {
  const { keep, dup } = await seedPair()
  await db.lists.update(keep, { name: 'Home' })
  const { removed, leftAlone, merged } = await lists.dedupeDefaultLists()
  assert.deepEqual(removed, [])
  assert.deepEqual(leftAlone, ['My list'])
  assert.equal(merged, 0)
  assert.equal((await db.items.toArray()).filter((i) => i.listId === dup).length, 6)
})

test('#680: a kind with no default: uid never folds', async () => {
  await db.lists.clear()
  await db.items.clear()
  await addList('My list', 'shopping-other', 'default:other')
  const dup = (await addList('My list', 'shopping-other', 'random')) as number
  await addItem(dup, 'milk')
  const { merged } = await lists.dedupeDefaultLists()
  assert.equal(merged, 0)
  assert.equal((await db.lists.toArray()).length, 2)
})

test('#680: device B, already synced part-way, converges on the same items as device A', async () => {
  // A folded and pushed; B pulled the moved items (now on default:list) but still has the
  // random list with the same keys. Its fold must not double them.
  const { keep, dup } = await seedPair()
  for (const k of ['milk', 'eggs', 'rice']) {
    const row = (await db.items.filter((i) => i.listId === dup && i.canonicalKey === k).first())!
    await db.items.update(row.id!, { listId: keep })
    await addItem(dup, k)
  }
  await lists.dedupeDefaultLists()
  const items = await db.items.toArray()
  assert.deepEqual(items.map((i) => i.canonicalKey).sort(), ['eggs', 'milk', 'oats', 'rice', 'salt', 'tea'])
  assert.ok(items.every((i) => i.listId === keep))
  assert.deepEqual((await db.lists.toArray()).map((l) => l.uid), ['default:list'])
})

test('#680: a key already on the shared list is not doubled', async () => {
  const { keep } = await seedPair()
  await addItem(keep, 'milk', { alwaysHave: false })
  await lists.dedupeDefaultLists()
  const keys = (await db.items.toArray()).map((i) => i.canonicalKey)
  assert.equal(keys.filter((k) => k === 'milk').length, 1)
  assert.equal(keys.length, 6)
})

test('#680: after Devon merges the pair by hand there is nothing left to do', async () => {
  const { keep, dup } = await seedPair()
  await lists.mergeInto(dup, keep)
  const items = await db.items.toArray()
  const out = await lists.dedupeDefaultLists()
  assert.deepEqual(out, { removed: [], leftAlone: [], merged: 0 })
  assert.deepEqual((await db.items.toArray()).map((i) => i.id).sort(), items.map((i) => i.id).sort())
  assert.deepEqual((await db.lists.toArray()).map((l) => l.uid), ['default:list'])
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

test('a Pantry somebody shared with you is never folded or deleted', async () => {
  await db.lists.clear()
  await db.items.clear()
  const keep = (await addList('Pantry', 'pantry', 'default:pantry')) as number
  const theirs = (await addList('Pantry', 'pantry', 'owners-random-uid')) as number
  await db.items.add({
    listId: theirs, displayName: 'Salt', canonicalKey: 'salt',
    section: 'pantry', checked: false, backlog: false, createdAt: 1,
  })
  sharedUids = ['owners-random-uid']
  const { removed, merged } = await lists.dedupeDefaultLists()
  assert.deepEqual(removed, [])
  assert.equal(merged, 0)
  assert.equal((await db.lists.toArray()).length, 2, 'the shared list stays')
  assert.equal((await db.items.toArray())[0].listId, theirs, 'and its items stay put')
  assert.ok(keep)
  sharedUids = []
})

test('when the shares cannot be fetched the repair touches nothing', async () => {
  await db.lists.clear()
  await db.items.clear()
  await addList('Pantry', 'pantry', 'default:pantry')
  await addList('Pantry', 'pantry', 'random-uid')
  sharedUids = null
  const { removed, merged } = await lists.dedupeDefaultLists()
  assert.deepEqual(removed, [])
  assert.equal(merged, 0)
  assert.equal((await db.lists.toArray()).length, 2)
  sharedUids = []
})

test('items fold only into default:pantry, never another default: uid', async () => {
  await db.lists.clear()
  await db.items.clear()
  await addList('Pantry', 'pantry', 'default:other')
  const dup = (await addList('Pantry', 'pantry', 'random-uid')) as number
  await db.items.add({
    listId: dup, displayName: 'Salt', canonicalKey: 'salt',
    section: 'pantry', checked: false, backlog: false, createdAt: 1,
  })
  const { merged, leftAlone } = await lists.dedupeDefaultLists()
  assert.equal(merged, 0)
  assert.deepEqual(leftAlone, ['Pantry'])
})

test('the shares are asked of the platform directly, never a same-origin path', async () => {
  await db.lists.clear()
  await db.items.clear()
  await addList('Pantry', 'pantry', 'default:pantry')
  await addList('Pantry', 'pantry', 'random-uid')
  fetched.length = 0
  await lists.dedupeDefaultLists()
  assert.deepEqual(fetched, ['https://id.devondoes.dev/api/mise/shares'])
})

test('a Pantry you own and shared OUT is never folded or deleted', async () => {
  await db.lists.clear()
  await db.items.clear()
  await addList('Pantry', 'pantry', 'default:pantry')
  const mine = (await addList('Pantry', 'pantry', 'my-shared-out')) as number
  await db.items.add({
    listId: mine, displayName: 'Salt', canonicalKey: 'salt',
    section: 'pantry', checked: false, backlog: false, createdAt: 1,
  })
  sharedUids = ['my-shared-out']
  sharedOut = true
  const { removed, merged } = await lists.dedupeDefaultLists()
  sharedUids = []
  sharedOut = false
  assert.deepEqual(removed, [])
  assert.equal(merged, 0)
  assert.equal((await db.lists.toArray()).length, 2)
  assert.equal((await db.items.toArray())[0].listId, mine)
})

test('an unshared random-uid Pantry with items folds into default:pantry', async () => {
  await db.lists.clear()
  await db.items.clear()
  const keep = (await addList('Pantry', 'pantry', 'default:pantry')) as number
  const dup = (await addList('Pantry', 'pantry', 'random-uid')) as number
  for (const k of ['salt', 'rice']) {
    await db.items.add({
      listId: dup, displayName: k, canonicalKey: k, alwaysHave: true,
      section: 'pantry', checked: false, backlog: false, createdAt: 1,
    })
  }
  const { removed, merged } = await lists.dedupeDefaultLists()
  assert.equal(merged, 2)
  assert.deepEqual(removed, ['Pantry'])
  assert.deepEqual((await db.lists.toArray()).map((l) => l.uid), ['default:pantry'])
  assert.ok((await db.items.toArray()).every((i) => i.listId === keep))
})

test('people.ts holds no non-ASCII garbage bytes (valid UTF-8)', async () => {
  const { readFileSync } = await import('node:fs')
  const buf = readFileSync(new URL('./people.ts', import.meta.url))
  assert.doesNotThrow(() => new TextDecoder('utf-8', { fatal: true }).decode(buf))
})
