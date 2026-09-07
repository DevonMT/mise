/**
 * Tests for the parts of sync whose failure mode is silent data loss.
 *
 * Two things are being protected here. The first is the v4 migration, which
 * runs once against a database that holds real groceries and real recipes and
 * has no undo. The second is the merge, where the bug that matters is not an
 * exception but a row that quietly disappears or quietly comes back.
 *
 *   node --test --import tsx src/sync.test.ts
 */
import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import Dexie from 'dexie'
import { indexedDB, IDBKeyRange } from 'fake-indexeddb'

Dexie.dependencies.indexedDB = indexedDB
Dexie.dependencies.IDBKeyRange = IDBKeyRange

/** A v3 database, exactly as it existed before sync — no uid, no updatedAt. */
async function makeV3(name: string) {
  const old = new Dexie(name)
  old.version(1).stores({
    items: '++id, canonicalKey, section, checked, backlog',
    recipes: '++id, title',
    staples: '++id, &canonicalKey',
  })
  old.version(2).stores({ catalog: '++id, &canonicalKey, favorite, count' })
  old.version(3).stores({
    lists: '++id, kind',
    items: '++id, listId, canonicalKey, section, checked, backlog',
  })
  await old.open()

  const listId = await old.table('lists').add({
    name: 'Groceries', kind: 'grocery', createdAt: 1_000,
  })
  await old.table('items').bulkAdd([
    { listId, displayName: 'Milk', canonicalKey: 'milk', section: 'dairy',
      checked: false, backlog: false, createdAt: 1_100 },
    { listId, displayName: 'Bread', canonicalKey: 'bread', section: 'bakery',
      checked: true, backlog: false, createdAt: 1_200 },
  ])
  await old.table('recipes').add({
    title: 'Soup', servings: 4, ingredients: [], createdAt: 1_300,
  })
  await old.table('staples').add({ canonicalKey: 'salt', displayName: 'Salt' })
  await old.table('catalog').add({
    canonicalKey: 'milk', displayName: 'Milk', section: 'dairy',
    count: 3, favorite: true, lastAdded: 1_400,
  })
  old.close()
  return listId as number
}

/** The v4 schema, kept byte-identical in shape to db.ts so the test exercises
 *  the real migration rather than a paraphrase of it. */
function openV4(name: string) {
  const db = new Dexie(name)
  db.version(1).stores({
    items: '++id, canonicalKey, section, checked, backlog',
    recipes: '++id, title',
    staples: '++id, &canonicalKey',
  })
  db.version(2).stores({ catalog: '++id, &canonicalKey, favorite, count' })
  db.version(3).stores({
    lists: '++id, kind',
    items: '++id, listId, canonicalKey, section, checked, backlog',
  })
  db.version(4)
    .stores({
      lists: '++id, &uid, kind',
      items: '++id, &uid, listId, canonicalKey, section, checked, backlog',
      recipes: '++id, &uid, title',
      staples: '++id, &uid, &canonicalKey',
      catalog: '++id, &uid, &canonicalKey, favorite, count',
      tombstones: '++id, &[kind+uid]',
    })
    .upgrade(async (tx) => {
      const now = Date.now()
      for (const n of ['lists', 'items', 'recipes', 'staples', 'catalog']) {
        await tx.table(n).toCollection()
          .modify((row: { uid?: string; updatedAt?: number; createdAt?: number }) => {
            if (!row.uid) row.uid = `uid-${Math.random().toString(16).slice(2)}`
            if (row.updatedAt == null) row.updatedAt = row.createdAt ?? now
          })
      }
    })
  return db
}

test('v4 migration keeps every row and every field', async () => {
  const name = `mise-mig-${Date.now()}`
  await makeV3(name)
  const db = openV4(name)
  await db.open()

  const items = await db.table('items').toArray()
  assert.equal(items.length, 2, 'both items survived')
  const milk = items.find((i) => i.canonicalKey === 'milk')
  assert.equal(milk.displayName, 'Milk')
  assert.equal(milk.section, 'dairy')
  assert.equal(milk.checked, false, 'checked state is untouched')
  const bread = items.find((i) => i.canonicalKey === 'bread')
  assert.equal(bread.checked, true, 'a ticked item stays ticked')

  assert.equal((await db.table('lists').toArray()).length, 1)
  assert.equal((await db.table('recipes').toArray()).length, 1)
  assert.equal((await db.table('staples').toArray()).length, 1)
  assert.equal((await db.table('catalog').toArray()).length, 1)
  db.close()
})

test('every migrated row gets a distinct uid', async () => {
  const name = `mise-uid-${Date.now()}`
  await makeV3(name)
  const db = openV4(name)
  await db.open()

  const uids: string[] = []
  for (const n of ['lists', 'items', 'recipes', 'staples', 'catalog']) {
    for (const row of await db.table(n).toArray()) {
      assert.ok(row.uid, `${n} row has a uid`)
      uids.push(row.uid)
    }
  }
  assert.equal(new Set(uids).size, uids.length, 'no two rows share a uid')
  db.close()
})

test('updatedAt falls back to createdAt, not to now', async () => {
  // This is the difference between a first sync that respects what the other
  // device did and one where this device claims to have just edited every row
  // it owns and therefore wins every conflict.
  const name = `mise-clock-${Date.now()}`
  await makeV3(name)
  const db = openV4(name)
  await db.open()

  const items = await db.table('items').toArray()
  const milk = items.find((i) => i.canonicalKey === 'milk')
  assert.equal(milk.updatedAt, 1_100, 'kept the row’s own creation time')
  const list = (await db.table('lists').toArray())[0]
  assert.equal(list.updatedAt, 1_000)

  // A staple has no createdAt at all, so it may fall back to now — but must
  // not be left undefined, which would exclude it from every push.
  const staple = (await db.table('staples').toArray())[0]
  assert.equal(typeof staple.updatedAt, 'number')
  db.close()
})

test('migrating twice is a no-op', async () => {
  const name = `mise-twice-${Date.now()}`
  await makeV3(name)
  const first = openV4(name)
  await first.open()
  const before = (await first.table('items').toArray()).map((i) => i.uid).sort()
  first.close()

  const second = openV4(name)
  await second.open()
  const after = (await second.table('items').toArray()).map((i) => i.uid).sort()
  assert.deepEqual(after, before, 'uids are minted once and then kept')
  second.close()
})

// ---------------------------------------------------------------------------
// The hooks. If these are wrong nothing throws — edits and deletes just never
// travel, which is the failure this whole file exists to catch early.
// ---------------------------------------------------------------------------

const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
})

const { db } = await import('./db')
await import('./sync') // importing is what registers the hooks

test('creating a row stamps a uid and a timestamp', async () => {
  const before = Date.now()
  const id = await db.lists.add({ name: 'Test', kind: 'grocery', createdAt: before })
  const row = await db.lists.get(id)
  assert.ok(row?.uid, 'uid was minted without the caller asking')
  assert.ok((row?.updatedAt ?? 0) >= before)
})

test('updating a row bumps updatedAt but keeps the uid', async () => {
  const id = await db.lists.add({ name: 'Before', kind: 'grocery', createdAt: 1 })
  const first = await db.lists.get(id)
  await new Promise((r) => setTimeout(r, 5))
  await db.lists.update(id, { name: 'After' })
  const second = await db.lists.get(id)

  assert.equal(second?.name, 'After')
  assert.equal(second?.uid, first?.uid, 'identity survives an edit')
  assert.ok((second?.updatedAt ?? 0) > (first?.updatedAt ?? 0), 'the edit is newer')
})

test('deleting a row leaves a tombstone carrying its uid', async () => {
  const id = await db.lists.add({ name: 'Doomed', kind: 'grocery', createdAt: 1 })
  const uid = (await db.lists.get(id))!.uid!
  await db.lists.delete(id)
  // The tombstone is written from the delete's onsuccess, in its own
  // transaction, so it lands a tick later.
  await new Promise((r) => setTimeout(r, 30))

  const tomb = await db.tombstones.filter((t) => t.uid === uid).first()
  assert.ok(tomb, 'the delete was recorded')
  assert.equal(tomb?.kind, 'list')
  assert.ok((tomb?.deletedAt ?? 0) > 0)
})

test('a bulk write stamps every row', async () => {
  // bulkAdd is the path an import and a recipe-to-list both take, and it is
  // the one most likely to slip past a per-call-site scheme.
  const ids = await db.staples.bulkAdd(
    [
      { canonicalKey: `k1-${Date.now()}`, displayName: 'One' },
      { canonicalKey: `k2-${Date.now()}`, displayName: 'Two' },
    ],
    { allKeys: true },
  )
  for (const id of ids) {
    const row = await db.staples.get(id)
    assert.ok(row?.uid, 'every bulk-written row has a uid')
    assert.ok(row?.updatedAt, 'every bulk-written row has a timestamp')
  }
})

// ---------------------------------------------------------------------------
// The client-side merge. This is the code that writes to a database of real
// groceries, so each case below is a way it could quietly lose or duplicate
// something rather than a way it could throw.
// ---------------------------------------------------------------------------

const { applyRemote } = await import('./sync')

/** A fresh list to scope each merge test to, so they cannot interfere. */
async function freshList() {
  const id = await db.lists.add({ name: `L${Math.random()}`, kind: 'grocery', createdAt: 1 })
  const uid = (await db.lists.get(id))!.uid!
  return { id, uid }
}

const itemRec = (uid: string, listUid: string, name: string, updatedAt: number) => ({
  kind: 'item' as const,
  uid,
  updatedAt,
  body: {
    listUid, displayName: name, canonicalKey: name.toLowerCase(),
    section: 'other', checked: false, backlog: false, createdAt: 1,
  },
})

test('an item from another device arrives on the right list', async () => {
  const list = await freshList()
  const uid = `remote-${Math.random()}`
  const r = await applyRemote({
    records: [itemRec(uid, list.uid, 'Remote Apples', 500)],
    tombstones: [],
  })

  assert.equal(r.added, 1)
  const row = await db.items.filter((i) => i.uid === uid).first()
  assert.ok(row, 'the item landed')
  assert.equal(row?.displayName, 'Remote Apples')
  // The local listId is this device's counter; the wire carried the list uid.
  assert.equal(row?.listId, list.id, 'resolved back to the local list id')
  assert.equal((row as Record<string, unknown>).listUid, undefined, 'wire field is not stored')
})

test('applying the same record twice does not duplicate it', async () => {
  const list = await freshList()
  const uid = `dupe-${Math.random()}`
  const state = { records: [itemRec(uid, list.uid, 'Once', 500)], tombstones: [] }
  await applyRemote(state)
  await applyRemote(state)

  const rows = await db.items.filter((i) => i.uid === uid).toArray()
  assert.equal(rows.length, 1, 'uid is the identity, not the local id')
})

test('a newer remote edit overwrites, an older one does not', async () => {
  const list = await freshList()
  const uid = `lww-${Math.random()}`
  await applyRemote({ records: [itemRec(uid, list.uid, 'First', 500)], tombstones: [] })

  await applyRemote({ records: [itemRec(uid, list.uid, 'Second', 900)], tombstones: [] })
  assert.equal((await db.items.filter((i) => i.uid === uid).first())?.displayName, 'Second')

  await applyRemote({ records: [itemRec(uid, list.uid, 'Stale', 100)], tombstones: [] })
  assert.equal(
    (await db.items.filter((i) => i.uid === uid).first())?.displayName,
    'Second',
    'a stale copy from a lagging device does not win',
  )
})

test('a local edit newer than the server copy survives the merge', async () => {
  // The case that matters most: you change something on this device, then a
  // sync brings back the server's older version. Yours must stand.
  const list = await freshList()
  const uid = `local-${Math.random()}`
  await applyRemote({ records: [itemRec(uid, list.uid, 'Server', 500)], tombstones: [] })

  const row = await db.items.filter((i) => i.uid === uid).first()
  await db.items.update(row!.id!, { displayName: 'Mine' }) // hooks stamp it now

  await applyRemote({ records: [itemRec(uid, list.uid, 'Server', 500)], tombstones: [] })
  assert.equal(
    (await db.items.filter((i) => i.uid === uid).first())?.displayName,
    'Mine',
    'the local edit was not clobbered by the older server copy',
  )
})

test('a tombstone removes the row, and absence does not', async () => {
  const list = await freshList()
  const keep = `keep-${Math.random()}`
  const kill = `kill-${Math.random()}`
  await applyRemote({
    records: [itemRec(keep, list.uid, 'Keep', 500), itemRec(kill, list.uid, 'Kill', 500)],
    tombstones: [],
  })

  // A state that mentions neither record, and tombstones only one.
  const r = await applyRemote({
    records: [],
    tombstones: [{ kind: 'item', uid: kill, deletedAt: 900 }],
  })

  assert.equal(r.removed, 1)
  assert.equal(await db.items.filter((i) => i.uid === kill).count(), 0, 'tombstoned row is gone')
  assert.equal(
    await db.items.filter((i) => i.uid === keep).count(),
    1,
    'a row simply absent from the payload is untouched',
  )
})

test('a local edit after a delete elsewhere keeps the row', async () => {
  const list = await freshList()
  const uid = `resurrect-${Math.random()}`
  await applyRemote({ records: [itemRec(uid, list.uid, 'Contested', 500)], tombstones: [] })

  const row = await db.items.filter((i) => i.uid === uid).first()
  await db.items.update(row!.id!, { displayName: 'Edited after the delete' })
  const editedAt = (await db.items.filter((i) => i.uid === uid).first())!.updatedAt!

  await applyRemote({ records: [], tombstones: [{ kind: 'item', uid, deletedAt: editedAt - 1 }] })
  assert.equal(
    await db.items.filter((i) => i.uid === uid).count(),
    1,
    'the newer edit beats the older delete, matching the server rule',
  )
})

test('merging does not restamp rows and start a ping-pong', async () => {
  // If applying a remote row bumped its updatedAt to now, this device would
  // think it held the newest copy of everything it just received and push it
  // straight back — forever.
  const list = await freshList()
  const uid = `stamp-${Math.random()}`
  await applyRemote({ records: [itemRec(uid, list.uid, 'Incoming', 500)], tombstones: [] })

  const row = await db.items.filter((i) => i.uid === uid).first()
  assert.equal(row?.updatedAt, 500, "kept the server's timestamp, not this device's clock")
})

test('an item whose list has not arrived yet is skipped, not misfiled', async () => {
  const uid = `orphan-${Math.random()}`
  const r = await applyRemote({
    records: [itemRec(uid, 'a-list-this-device-has-never-seen', 'Orphan', 500)],
    tombstones: [],
  })
  assert.equal(r.added, 0)
  assert.equal(await db.items.filter((i) => i.uid === uid).count(), 0, 'not dropped into some other list')
})

test('a list and its items arrive together in one merge', async () => {
  const listUid = `newlist-${Math.random()}`
  const itemUid = `newitem-${Math.random()}`
  const r = await applyRemote({
    records: [
      itemRec(itemUid, listUid, 'Arrived', 500),
      { kind: 'list', uid: listUid, updatedAt: 500,
        body: { name: 'From the phone', kind: 'grocery', createdAt: 1 } },
    ],
    tombstones: [],
  })

  assert.equal(r.added, 2, 'both landed despite the item being listed first')
  const list = await db.lists.filter((l) => l.uid === listUid).first()
  const item = await db.items.filter((i) => i.uid === itemUid).first()
  assert.equal(item?.listId, list?.id, 'the item found the list that arrived with it')
})

// ---------------------------------------------------------------------------
// Tier changes. Both bugs here shipped and both were visible to Devon as one
// wrong sentence: a tier-change message on a launch where nothing changed,
// saying features had been REMOVED at the moment they were being granted.
// ---------------------------------------------------------------------------

const ed = await import('./edition')

test('learning the tier for the first time is not a change', () => {
  // The app opens assuming lite, so the first answer always "differs" from the
  // starting value. Announcing that fired a tier-change message on every launch.
  ed.setGrantedVariant('full')
  assert.equal(ed.tierActuallyChanged(), false, 'the first answer is news, not a change')
  assert.equal(ed.grantedEdition(), 'personal', 'but the tier is still adopted')
})

test('a later change to a known tier IS a change', () => {
  ed.setGrantedVariant('full')
  ed.tierActuallyChanged() // consume
  ed.setGrantedVariant('lite')
  assert.equal(ed.tierActuallyChanged(), true)
  assert.equal(ed.grantedEdition(), 'lite')
})

test('re-confirming the same tier is not a change', () => {
  ed.setGrantedVariant('lite')
  ed.tierActuallyChanged()
  ed.setGrantedVariant('lite')
  assert.equal(ed.tierActuallyChanged(), false, 'every poll must not announce something')
})

test('the flag is consumed, so one change is announced once', () => {
  ed.setGrantedVariant('full')
  assert.equal(ed.tierActuallyChanged(), true)
  assert.equal(ed.tierActuallyChanged(), false, 'reading it again reports nothing')
})

test('anything that is not exactly "full" means lite', () => {
  // Fail closed: an unknown tier, a null, a typo, a server that starts
  // answering nonsense — none of them may unlock the billable features.
  for (const v of ['lite', null, undefined, '', 'FULL', 'full ', 'admin', 'personal']) {
    ed.setGrantedVariant(v as string | null | undefined)
    const expected = v === 'full' ? 'personal' : 'lite'
    assert.equal(ed.grantedEdition(), expected, `${JSON.stringify(v)} -> ${expected}`)
  }
})
