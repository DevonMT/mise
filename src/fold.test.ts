/**
 * The legacy-list fold (#680), tested against the ways it could lose data:
 *
 *   1. a stale device folding before it has synced, re-stamping old rows so
 *      they beat newer edits and deletes made elsewhere;
 *   2. an offline or older device adding to the old list after the fold;
 *   3. a fold running while a merge is writing, when the hooks are off.
 *
 * A small in-memory platform (the same merge rules as devondoes
 * platform/src/mise.ts POST /state) and a way to swap the one IndexedDB
 * between "devices" let the tests play several devices against one account.
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
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } })
;(globalThis as unknown as { CustomEvent: unknown }).CustomEvent = class {}

// ---- The platform, one account, no shares joined in ------------------------

type Rec = { kind: string; uid: string; updatedAt: number; body: Record<string, unknown> }
type Tomb = { kind: string; uid: string; deletedAt: number }
const server = { records: new Map<string, Rec>(), tombs: new Map<string, Tomb>() }
const key = (x: { kind: string; uid: string }) => `${x.kind}|${x.uid}`
const DAY = 86_400_000

function postState(body: { records: Rec[]; tombstones: Tomb[] }) {
  for (const r of body.records) {
    const cur = server.records.get(key(r))
    if (!cur || r.updatedAt > cur.updatedAt) server.records.set(key(r), structuredClone(r))
  }
  for (const t of body.tombstones) {
    if (t.uid.startsWith('default:')) continue
    const cur = server.tombs.get(key(t))
    server.tombs.set(key(t), { ...t, deletedAt: Math.max(cur?.deletedAt ?? 0, t.deletedAt) })
  }
  for (const [k, t] of server.tombs) {
    const r = server.records.get(k)
    if (r && t.deletedAt >= r.updatedAt) server.records.delete(k)
  }
  for (const [k, t] of server.tombs) if (t.deletedAt < Date.now() - 90 * DAY) server.tombs.delete(k)
  return structuredClone({
    records: [...server.records.values()], tombstones: [...server.tombs.values()], variant: null,
  })
}

/** What the platform's /shares answers: null = unreachable. */
let shared: string[] | null = []
let sharesAsked = 0
;(globalThis as unknown as { fetch: unknown }).fetch = async (url: string, init?: RequestInit) => {
  const u = String(url)
  if (u.endsWith('/state')) return new Response(JSON.stringify(postState(JSON.parse(String(init!.body)))))
  if (u.endsWith('/shares')) {
    sharesAsked++
    if (shared === null) throw new Error('offline')
    return new Response(JSON.stringify({ shares: shared.map((list_uid) => ({ list_uid, mine: true })) }))
  }
  if (u.endsWith('/health')) return new Response(JSON.stringify({ variant: null }))
  return new Response('{}', { status: 404 })
}

const { db, liveLists } = await import('./db')
const sync = await import('./sync')
const lists = await import('./lists')
const fold = await import('./fold')

const tick = () => new Promise((r) => setTimeout(r, 5))

// ---- Devices -----------------------------------------------------------------

type Device = { lists: unknown[]; items: unknown[]; tombstones: unknown[]; active?: string; folded?: string }
async function snapshot(): Promise<Device> {
  return structuredClone({
    lists: await db.lists.toArray(), items: await db.items.toArray(),
    tombstones: await db.tombstones.toArray(), active: store.get('mise.activeList'),
    folded: store.get('mise.sync.folded'),
  })
}
/** Become another device: its rows exactly as they were, stamps and all. */
async function become(d: Device) {
  await sync.keepingStamps([db.lists, db.items, db.tombstones], async () => {
    await db.lists.clear()
    await db.items.clear()
    await db.tombstones.clear()
    await db.lists.bulkAdd(structuredClone(d.lists) as never[])
    await db.items.bulkAdd(structuredClone(d.items) as never[])
    await db.tombstones.bulkAdd(structuredClone(d.tombstones) as never[])
  })
  if (d.active) store.set('mise.activeList', d.active)
  else store.delete('mise.activeList')
  // Device-local too: which lists this device has held folded (#684).
  if (d.folded) store.set('mise.sync.folded', d.folded)
  else store.delete('mise.sync.folded')
}

async function reset() {
  server.records.clear()
  server.tombs.clear()
  shared = []
  fold.forgetShares()
  await become({ lists: [], items: [], tombstones: [] })
  store.set('mise.sync.enabled', '1')
}

const LEGACY = 'legacy-3fc04e98'
const AUGUST = Date.UTC(2026, 7, 1)
const KEYS = ['milk', 'eggs', 'rice', 'oats', 'salt', 'tea']

/** The account #680 found: an empty default:list beside a pre-09-06 "My list"
 *  holding the groceries. Pushed to the server unfolded (shares unreachable,
 *  so the fold that every sync runs skips it). */
async function legacyAccount(opts: { oldName?: string; createdAt?: number; editedAt?: number } = {}) {
  await reset()
  const keep = await lists.ensureSeed()
  const old = (await db.lists.add({
    name: opts.oldName ?? 'My list', kind: 'grocery', uid: LEGACY, createdAt: opts.createdAt ?? AUGUST,
  })) as number
  for (const k of KEYS) {
    await db.items.add({
      listId: old, displayName: k, canonicalKey: k, section: 'other',
      checked: false, backlog: false, createdAt: AUGUST,
    })
  }
  if (opts.editedAt != null) {
    await sync.keepingStamps([db.items], () =>
      db.items.toCollection().modify({ updatedAt: opts.editedAt }))
  }
  shared = null
  assert.equal((await sync.sync()).ok, true)
  shared = []
  fold.forgetShares()
  return { keep, old }
}

const onList = async (id: number) =>
  (await db.items.where('listId').equals(id).toArray()).map((i) => i.canonicalKey).sort()
const serverItems = () => [...server.records.values()].filter((r) => r.kind === 'item')
const serverList = (uid: string) => server.records.get(`list|${uid}`)

// ---- The basic fold ----------------------------------------------------------

test('after a sync the old list is hidden, its items are on default:list, everywhere', async () => {
  const { keep, old } = await legacyAccount()
  const other = await snapshot()

  assert.equal((await sync.sync()).ok, true) // device A folds
  await sync.sync() // and pushes the fold (the app's hooks schedule this push)
  assert.deepEqual(await onList(keep), [...KEYS].sort())
  assert.deepEqual(await onList(old), [])
  assert.equal((await db.lists.get(old))?.foldedInto, 'default:list', 'kept, as a forwarding address')
  assert.equal((await db.lists.get(old))?.name, 'My list (moved)')
  // The build on devices today deletes an empty duplicate with one of these names.
  const MAIN_APP_MADE_NAMES = ['my list', 'pantry', 'groceries']
  assert.ok(!MAIN_APP_MADE_NAMES.includes(fold.movedName('My list').toLowerCase()),
    "so an older build's repair leaves it be")
  assert.deepEqual((await liveLists()).map((l) => l.uid), ['default:list'], 'and hidden')
  assert.equal(serverList(LEGACY)?.body.foldedInto, 'default:list')
  assert.ok(serverItems().every((r) => r.body.listUid === 'default:list'))
  assert.equal(server.tombs.size, 0, 'nothing deleted')

  await become(other) // device B, which still had the pair
  await sync.sync()
  assert.deepEqual(await onList(keep), [...KEYS].sort())
  assert.equal((await db.lists.get(old))?.foldedInto, 'default:list')
  const again = await fold.foldLegacyLists()
  assert.deepEqual(again, { folded: [], moved: 0 }, 'a second pass has nothing to do')
})

// ---- Blocking 1: a stale device ---------------------------------------------

test('1: a stale device folds only after it has the newer edits, and never undoes them', async () => {
  const { keep } = await legacyAccount()
  const stale = await snapshot() // the laptop, about to sit closed for days

  // The phone ticks milk and clears eggs, and syncs. Shares unreachable on the
  // phone, so the fold is still the laptop's to do.
  shared = null
  await tick()
  const milk = (await db.items.where('canonicalKey').equals('milk').first())!
  await db.items.update(milk.id!, { checked: true })
  const eggs = (await db.items.where('canonicalKey').equals('eggs').first())!
  await db.items.delete(eggs.id!)
  await tick()
  await sync.sync()
  shared = []
  fold.forgetShares()

  await become(stale)
  // At launch, before any sync: nothing the app runs at mount moves an item.
  await lists.ensureDefaultLists()
  await lists.dedupeDefaultLists()
  assert.deepEqual(await onList(keep), [], 'no fold on a stale copy')

  await sync.sync()
  assert.deepEqual(await onList(keep), ['milk', 'oats', 'rice', 'salt', 'tea'], 'eggs stay cleared')
  assert.equal((await db.items.where('canonicalKey').equals('milk').first())?.checked, true, 'milk stays ticked')
  await sync.sync()
  assert.ok(!serverItems().some((r) => r.body.canonicalKey === 'eggs'), 'and the server agrees')
  assert.equal(serverItems().find((r) => r.body.canonicalKey === 'milk')?.body.checked, true)
})

test('1: even a fold run on stale data loses to every newer edit and delete', async () => {
  // Belt and braces: the stamps alone make a stale fold harmless.
  const { keep } = await legacyAccount()
  const stale = await snapshot()
  shared = null
  await tick()
  const milk = (await db.items.where('canonicalKey').equals('milk').first())!
  await db.items.update(milk.id!, { checked: true })
  const eggs = (await db.items.where('canonicalKey').equals('eggs').first())!
  await db.items.delete(eggs.id!)
  await tick()
  await sync.sync()
  shared = []
  fold.forgetShares()

  await become(stale)
  const r = await fold.foldLegacyLists() // on the stale copy, deliberately
  assert.equal(r.moved, 6)
  await sync.sync() // push the stale fold, take the server's answer
  await sync.sync() // and re-fold what came back on the old list
  assert.deepEqual(await onList(keep), ['milk', 'oats', 'rice', 'salt', 'tea'])
  assert.equal((await db.items.where('canonicalKey').equals('milk').first())?.checked, true)
  assert.ok(!serverItems().some((r) => r.body.canonicalKey === 'eggs'))
  assert.ok(serverItems().every((r) => r.body.listUid === 'default:list'))
})

test('1: a moved row is stamped one ms after its own version, not with the clock', async () => {
  const { keep } = await legacyAccount()
  const before = new Map((await db.items.toArray()).map((i) => [i.uid!, i.updatedAt!]))
  await sync.sync()
  for (const i of await db.items.where('listId').equals(keep).toArray()) {
    assert.equal(i.updatedAt, before.get(i.uid!)! + 1)
  }
})

// ---- Blocking 2: late edits on the old list ---------------------------------

test('2: an add or edit that lands on the folded list later is moved on, edit and all', async () => {
  const { keep, old } = await legacyAccount()
  await sync.sync() // folded
  // An older build (or a phone offline since before the fold) pushes rows that
  // still name the old list: a new one, and an edit to rice newer than the fold.
  await tick()
  const now = Date.now()
  const rice = serverItems().find((r) => r.body.canonicalKey === 'rice')!
  postState({
    records: [
      { kind: 'item', uid: 'late-bread', updatedAt: now, body: {
        uid: 'late-bread', listUid: LEGACY, displayName: 'bread', canonicalKey: 'bread',
        section: 'other', checked: false, backlog: false, createdAt: now } },
      { kind: 'item', uid: rice.uid, updatedAt: now, body: { ...rice.body, listUid: LEGACY, quantity: 3 } },
    ],
    tombstones: [],
  })

  await sync.sync() // this device takes them, and moves them on
  assert.deepEqual(await onList(old), [])
  assert.deepEqual(await onList(keep), ['bread', 'eggs', 'milk', 'oats', 'rice', 'salt', 'tea'])
  assert.equal((await db.items.where('canonicalKey').equals('rice').first())?.quantity, 3, 'the edit kept')
  await sync.sync()
  assert.ok(serverItems().every((r) => r.body.listUid === 'default:list'), 'and the server agrees')
})

test('2: a hub add aimed at the folded list is moved, then filed like any add', async () => {
  const { keep } = await legacyAccount()
  await sync.sync()
  postState({
    records: [{ kind: 'item', uid: 'hub-1', updatedAt: Date.now(), body: {
      uid: 'hub-1', listUid: LEGACY, displayName: 'Milk', canonicalKey: 'milk', quantity: 1,
      section: 'other', checked: false, backlog: false, pending: true, createdAt: Date.now() } }],
    tombstones: [],
  })
  await sync.sync()
  const milk = await db.items.where('canonicalKey').equals('milk').toArray()
  assert.equal(milk.length, 1, 'merged into the milk already there')
  assert.equal(milk[0].listId, keep)
  assert.ok(!(await db.items.toArray()).some((i) => i.pending))
})

// ---- Blocking 3: a merge in progress ----------------------------------------

test('3: the fold refuses while a merge is writing', async () => {
  const { old } = await legacyAccount()
  const merging = sync.applyRemote(postState({ records: [], tombstones: [] }))
  const r = await fold.foldLegacyLists()
  await merging
  assert.equal(r.refused, true)
  assert.equal((await db.lists.get(old))?.foldedInto, undefined)
  assert.deepEqual(await onList(old), [...KEYS].sort())
})

test('3: two syncs at once never overlap, and a call made during a run gets a run after it', async () => {
  const { keep } = await legacyAccount()
  shared = null // no fold; this is about the runs
  const a = sync.sync()
  await db.items.add({ listId: keep, displayName: 'jam', canonicalKey: 'jam', section: 'other',
    checked: false, backlog: false, createdAt: Date.now() })
  const b = sync.sync()
  const c = sync.sync()
  assert.notEqual(a, b)
  assert.equal(b, c, 'calls made during one run share the next')
  await Promise.all([a, b])
  assert.ok(serverItems().some((r) => r.body.canonicalKey === 'jam'), 'what changed meanwhile was sent')
})

test('2: an older build deleting the folded list cannot strand a late add', async () => {
  // The build on the phone today deletes an empty app-made duplicate after
  // every sync. The rename keeps it out of that; if a delete arrives anyway
  // (or someone deletes it by hand on an old build), it is refused and the list
  // is put back.
  const { keep, old } = await legacyAccount()
  const offline = await snapshot() // a tablet that misses the fold
  await sync.sync()
  await sync.sync() // folded and pushed
  const folder = await snapshot()
  postState({ records: [], tombstones: [{ kind: 'list', uid: LEGACY, deletedAt: Date.now() }] })
  assert.equal(serverList(LEGACY), undefined, 'the old build deleted it on the server')

  await become(offline) // comes back with a new line on the old list, and pushes it
  await tick()
  await db.items.add({ listId: old, displayName: 'bread', canonicalKey: 'bread', section: 'other',
    checked: false, backlog: false, createdAt: Date.now() })
  await sync.sync()
  const tablet = await snapshot()

  await become(folder) // any device that holds the folded list moves it on
  await sync.sync()
  await sync.sync()
  assert.ok(await db.lists.get(old), 'the list survived the delete')
  assert.deepEqual(await onList(old), [])
  assert.ok((await onList(keep)).includes('bread'), 'bread moved on')
  assert.ok(serverList(LEGACY), 'and the server has the forwarding list again')
  assert.equal(serverItems().find((r) => r.body.canonicalKey === 'bread')?.body.listUid, 'default:list')

  await become(tablet) // and the tablet, which lost the old list, gets its bread back where it went
  await sync.sync()
  assert.equal((await db.items.where('canonicalKey').equals('bread').first())?.listId, keep)
})

test('4: two devices folding at once, with the same line on both lists, lose nothing', async () => {
  const { keep } = await legacyAccount()
  await db.items.add({ listId: keep, displayName: 'tea', canonicalKey: 'tea', section: 'other',
    checked: false, backlog: false, createdAt: AUGUST })
  shared = null
  await sync.sync()
  shared = []
  fold.forgetShares()
  const b = await snapshot()
  // Reverse B's local ids, so any "first one wins" choice would differ.
  const ids = (b.items as Array<{ id: number }>).map((i) => i.id).reverse()
  ;(b.items as Array<{ id: number }>).forEach((i, n) => { i.id = ids[n] + 1000 })

  await fold.foldLegacyLists() // A folds, not yet pushed
  const a = await snapshot()
  await become(b)
  await fold.foldLegacyLists() // B folds, not yet pushed
  await sync.sync()
  await become(a)
  await sync.sync()
  await sync.sync()
  assert.equal(server.tombs.size, 0, 'nothing dropped')
  assert.deepEqual(serverItems().map((r) => r.body.canonicalKey).sort(), [...KEYS, 'tea'].sort(),
    'both teas kept, every key there')
})

test('4: rows last edited months ago fold once and settle', async () => {
  const { keep } = await legacyAccount({ editedAt: Date.now() - 120 * DAY })
  await sync.sync()
  await sync.sync()
  assert.deepEqual(await onList(keep), [...KEYS].sort())
  assert.deepEqual(await fold.foldLegacyLists(), { folded: [], moved: 0 }, 'nothing left to do')
  const r = await sync.sync()
  assert.equal(r.ok && r.updated + r.added + r.removed, 0, 'and no sync loop')
})

// ---- Findings 4-6 and the bounds ---------------------------------------------

test('4: nothing folds when either list is shared, or the shares cannot be fetched', async () => {
  for (const s of [[LEGACY], ['default:list'], null]) {
    const { old } = await legacyAccount()
    shared = s
    await sync.sync()
    assert.equal((await db.lists.get(old))?.foldedInto, undefined, `shared=${JSON.stringify(s)}`)
    assert.deepEqual(await onList(old), [...KEYS].sort())
  }
})

test('4: a skipped candidate does not cost a /shares request on every sync', async () => {
  await legacyAccount()
  shared = [LEGACY]
  sharesAsked = 0
  await sync.sync()
  await sync.sync()
  await sync.sync()
  assert.equal(sharesAsked, 1)
})

test('5: standing on the old list, the app moves to default:list', async () => {
  const { keep, old } = await legacyAccount()
  lists.writeActiveId(old)
  await sync.sync()
  assert.equal(lists.readActiveId(), keep)
  assert.equal(await lists.resolveActiveId(), keep)
})

test('5: a device that only received the fold also lands on default:list', async () => {
  const { keep, old } = await legacyAccount()
  const other = await snapshot()
  await sync.sync()
  await sync.sync()
  await become({ ...other, active: String(old) })
  await sync.applyRemote(postState({ records: [], tombstones: [] })) // the marker, no fold of its own
  assert.equal(await lists.resolveActiveId(), keep)
})

test('6: every row moves, even beside the same line: nothing is merged away', async () => {
  const { keep } = await legacyAccount()
  const base = { section: 'other' as const, createdAt: AUGUST, listId: keep }
  await db.items.bulkAdd([
    { ...base, displayName: 'milk', canonicalKey: 'milk', unit: 'gal', checked: false, backlog: false },
    { ...base, displayName: 'eggs', canonicalKey: 'eggs', checked: true, backlog: false },
    { ...base, displayName: 'Oats', canonicalKey: 'oats', checked: false, backlog: false },
  ])
  await sync.sync()
  await sync.sync()
  assert.deepEqual(await onList(keep), ['eggs', 'eggs', 'milk', 'milk', 'oats', 'oats', 'rice', 'salt', 'tea'])
  assert.equal(server.tombs.size, 0)
})

test('4: a folded list that is (or becomes) shared is not forwarded, nor when shares are unknown', async () => {
  const { keep, old } = await legacyAccount()
  await sync.sync()
  for (const s of [[LEGACY], null]) {
    fold.forgetShares()
    await db.items.add({ listId: old, displayName: 'jam', canonicalKey: 'jam', section: 'other',
      checked: false, backlog: false, createdAt: Date.now() })
    shared = s
    const r = await fold.foldLegacyLists()
    assert.equal(r.moved, 0, `shared=${JSON.stringify(s)}`)
    assert.ok((await onList(old)).includes('jam'))
    assert.ok((await liveLists()).some((l) => l.id === old), 'and the list shows, so jam is visible')
    await db.items.where('canonicalKey').equals('jam').delete()
  }
  assert.ok(!(await onList(keep)).includes('jam'))
})

test('the marker is stamped one past the list, so a later rename elsewhere un-folds it', async () => {
  const { old } = await legacyAccount()
  const v = (await db.lists.get(old))!.updatedAt!
  await sync.sync()
  assert.equal((await db.lists.get(old))?.updatedAt, v + 1)
})

test('a list made after the cutoff, or renamed on either side, never folds', async () => {
  for (const variant of ['late', 'renamed-old', 'renamed-keeper'] as const) {
    const { keep, old } = await legacyAccount({
      createdAt: variant === 'late' ? Date.UTC(2026, 9, 1) : AUGUST,
      oldName: variant === 'renamed-old' ? 'Costco' : 'My list',
    })
    if (variant === 'renamed-keeper') await db.lists.update(keep, { name: 'Home' })
    await sync.sync()
    assert.equal((await db.lists.get(old))?.foldedInto, undefined, variant)
    assert.deepEqual(await onList(old), [...KEYS].sort(), variant)
  }
})

test('after Devon merges the pair by hand, the fold has nothing to do', async () => {
  const { keep, old } = await legacyAccount()
  const other = await snapshot()
  shared = null
  await lists.mergeInto(old, keep) // ManageLists: new rows, old ones deleted
  await tick()
  await sync.sync()
  shared = []
  fold.forgetShares()
  const after = (await db.items.toArray()).map((i) => i.uid).sort()

  await sync.sync()
  assert.deepEqual((await db.items.toArray()).map((i) => i.uid).sort(), after, 'this device')
  assert.deepEqual(await fold.foldLegacyLists(), { folded: [], moved: 0 })

  await become(other) // a device still holding the unmerged pair
  await sync.sync()
  assert.equal(await db.lists.get(old), undefined, 'the merge reached it')
  assert.deepEqual((await db.items.toArray()).map((i) => i.uid).sort(), after, 'six rows, not twelve')
  assert.equal(serverItems().length, 6)
})

test('3: a run that throws does not stick the queue', async () => {
  await legacyAccount()
  // The next merge loses IndexedDB mid-way (iOS does this).
  const proto = Object.getPrototypeOf(db.items) as { toArray: () => Promise<unknown[]> }
  const real = proto.toArray
  let blown = false
  ;(db.items as unknown as { toArray: () => Promise<unknown[]> }).toArray = function (this: unknown) {
    if (sync.isApplyingRemote() && !blown) {
      blown = true
      return Promise.reject(new Error('Connection to Indexed Database server lost'))
    }
    return real.call(this)
  }
  const a = sync.sync()
  const b = sync.sync()
  await assert.rejects(a)
  assert.equal((await b).ok, true, 'the call made during it got a run of its own')
  delete (db.items as unknown as { toArray?: unknown }).toArray
  assert.equal((await sync.sync()).ok, true)
})

test('keepingStamps keeps the stamp it is given; a write outside it is stamped as usual', async () => {
  await reset()
  const id = await sync.keepingStamps([db.items], async () =>
    db.items.add({ listId: 1, displayName: 'x', canonicalKey: 'x', section: 'other',
      checked: false, backlog: false, createdAt: 1, uid: 'x', updatedAt: 42 }))
  assert.equal((await db.items.get(id))?.updatedAt, 42)
  await db.items.update(id, { checked: true })
  assert.ok((await db.items.get(id))!.updatedAt! > 1_000_000)
})

// ---- #685: the coordinator's follow-ups --------------------------------------

test('#685: a delete of the folded list beside a newer record of it takes the record, not a restore', async () => {
  // An older build deletes the folded list, and later a device renames it (its
  // stale copy, so the rename un-folds it). The server keeps both: the record
  // won. Putting this device's folded copy back with today's stamp would beat
  // that rename and undo it everywhere.
  const { old } = await legacyAccount()
  await sync.sync()
  await sync.sync() // folded and pushed
  await tick()
  const deletedAt = Date.now()
  await tick()
  const renamedAt = Date.now()
  await tick()
  const body = { ...serverList(LEGACY)!.body, name: 'Costco' }
  delete body.foldedInto
  postState({
    records: [{ kind: 'list', uid: LEGACY, updatedAt: renamedAt, body }],
    tombstones: [{ kind: 'list', uid: LEGACY, deletedAt }],
  })
  assert.equal(serverList(LEGACY)?.body.name, 'Costco', 'the rename is the agreed row')

  await sync.sync()
  await sync.sync()
  assert.equal((await db.lists.get(old))?.name, 'Costco', 'this device takes the rename')
  assert.equal((await db.lists.get(old))?.foldedInto, undefined)
  assert.equal(serverList(LEGACY)?.body.name, 'Costco', 'and does not push its folded copy over it')
})

test('#685: a newer record beside a tombstone keeps the local row, it is not deleted and re-added', async () => {
  const { old } = await legacyAccount()
  shared = null
  const now = Date.now()
  const body = { ...serverList(LEGACY)!.body, name: 'Weekly' }
  await sync.applyRemote({
    records: [{ kind: 'list', uid: LEGACY, updatedAt: now, body }],
    tombstones: [{ kind: 'list', uid: LEGACY, deletedAt: now - 1 }],
  })
  assert.equal((await db.lists.get(old))?.name, 'Weekly', 'same local id, so its items still point at it')
  assert.deepEqual(await onList(old), [...KEYS].sort())
})

test('#685: a legacy Pantry folds into default:pantry the same way', async () => {
  await reset()
  await lists.ensureSeed()
  const keep = await lists.ensurePantryList()
  const old = (await db.lists.add({
    name: 'Pantry', kind: 'pantry', uid: 'legacy-pantry', createdAt: AUGUST,
  })) as number
  for (const k of ['flour', 'sugar']) {
    await db.items.add({ listId: old, displayName: k, canonicalKey: k, section: 'other',
      checked: false, backlog: false, createdAt: AUGUST })
  }
  await sync.sync()
  await sync.sync()
  assert.equal((await db.lists.get(keep))?.uid, 'default:pantry')
  assert.deepEqual(await onList(keep), ['flour', 'sugar'])
  assert.equal((await db.lists.get(old))?.foldedInto, 'default:pantry')
  assert.equal((await db.lists.get(old))?.name, 'Pantry (moved)')
  assert.ok(!(await liveLists()).some((l) => l.id === old))
  assert.equal(server.tombs.size, 0)
})

test('#685: a stale device merging the pair by hand after the fold ends with one of each', async () => {
  const { keep, old } = await legacyAccount()
  const stale = await snapshot() // still holds the unfolded pair
  await sync.sync()
  await sync.sync() // folded and pushed
  const folder = await snapshot()

  await become(stale)
  shared = null // so this device does not fold first; it merges by hand
  await tick()
  await lists.mergeInto(old, keep) // new rows on default:list, the old ones deleted
  await tick()
  await sync.sync()
  shared = []
  fold.forgetShares()
  await sync.sync()
  assert.deepEqual(await onList(keep), [...KEYS].sort(), 'this device: six, not twelve')
  assert.deepEqual(serverItems().map((r) => r.body.canonicalKey).sort(), [...KEYS].sort())
  assert.ok(serverItems().every((r) => r.body.listUid === 'default:list'))

  await become(folder)
  await sync.sync()
  await sync.sync()
  assert.deepEqual(await onList(keep), [...KEYS].sort(), 'the folding device agrees')
  assert.equal((await db.lists.get(old))?.foldedInto, 'default:list', 'and refused the hand delete')
  assert.ok(serverList(LEGACY), 'so the server has the forwarding list again')
})

test('#685: a rename made on a stale copy after the fold un-folds it, and loses nothing', async () => {
  const { keep, old } = await legacyAccount()
  const stale = await snapshot()
  await sync.sync()
  await sync.sync() // folded and pushed
  await become(stale)
  shared = null
  await tick()
  await lists.renameList(old, 'Costco') // newer than the fold's marker: a decision
  await sync.sync()
  shared = []
  fold.forgetShares()
  await sync.sync()
  await sync.sync()
  const l = await db.lists.get(old)
  assert.equal(l?.name, 'Costco')
  assert.equal(l?.foldedInto, undefined, 'un-folded')
  assert.ok((await liveLists()).some((x) => x.id === old), 'and showing again')
  assert.deepEqual(await onList(keep), [...KEYS].sort(), 'the items stay where the fold moved them')
  assert.equal(server.tombs.size, 0)
  assert.equal(serverList(LEGACY)?.body.name, 'Costco')
})

test("#685: neither build's dedupeDefaultLists deletes a folded list", async () => {
  const { keep, old } = await legacyAccount()
  await sync.sync()
  await sync.sync() // folded and pushed
  // The build on the phone today: after every sync, delete an empty
  // non-default list with an app-made name, with no notion of foldedInto.
  const MAIN_APP_MADE_NAMES = new Set(['my list', 'pantry', 'groceries'])
  for (const l of await db.lists.toArray()) {
    if (l.uid?.startsWith('default:') || !MAIN_APP_MADE_NAMES.has(l.name.trim().toLowerCase())) continue
    if (await db.items.where('listId').equals(l.id!).count()) continue
    await db.lists.delete(l.id!)
  }
  // This build, which runs it at mount when sync is off.
  store.set('mise.sync.enabled', '0')
  const r = await lists.dedupeDefaultLists()
  store.set('mise.sync.enabled', '1')
  assert.deepEqual(r.removed, [])
  assert.ok(await db.lists.get(old), 'still there, as a forwarding address')
  assert.equal((await db.tombstones.toArray()).length, 0)
  assert.deepEqual(await onList(keep), [...KEYS].sort())
})

// ---- #684: a device refuses a delete for any list it has held folded ---------

test('#684: un-folded by a rename to another app-made name, deleted as a duplicate: refused, and a late add lands', async () => {
  const { keep, old } = await legacyAccount()
  const stale = await snapshot() // a laptop that misses the fold
  const offline = await snapshot() // a phone, offline for the week
  await sync.sync()
  await sync.sync() // folded and pushed
  const folder = await snapshot()

  // The laptop, on an older build, renames its stale copy to "Groceries": newer
  // than the marker, so it un-folds the list everywhere.
  await become(stale)
  shared = null
  await tick()
  await lists.renameList(old, 'Groceries')
  await sync.sync()
  shared = []
  fold.forgetShares()
  await become(folder)
  await sync.sync()
  assert.equal((await db.lists.get(old))?.foldedInto, undefined, 'un-folded here too')

  // That older build's repair then deletes it: empty, app-made name, not default.
  await tick()
  postState({ records: [], tombstones: [{ kind: 'list', uid: LEGACY, deletedAt: Date.now() }] })
  await sync.sync()
  await sync.sync()
  const l = await db.lists.get(old)
  assert.ok(l, 'the delete is refused: this device folded that list')
  assert.equal(l?.foldedInto, 'default:list', 'and it is a forwarding address again')
  assert.equal(l?.name, 'Groceries (moved)', "out of the older build's repair")
  assert.equal(serverList(LEGACY)?.body.foldedInto, 'default:list')
  const after = await snapshot()

  // The phone comes back with a line on the old list.
  await become(offline)
  await tick()
  await db.items.add({ listId: old, displayName: 'bread', canonicalKey: 'bread', section: 'other',
    checked: false, backlog: false, createdAt: Date.now() })
  await sync.sync()

  await become(after)
  await sync.sync()
  await sync.sync()
  assert.ok((await onList(keep)).includes('bread'), 'not stranded: moved on to default:list')
  assert.equal(serverItems().find((r) => r.body.canonicalKey === 'bread')?.body.listUid, 'default:list')
})

test('#684: a device that only received the fold remembers it too', async () => {
  const { old } = await legacyAccount()
  const other = await snapshot()
  await sync.sync()
  await sync.sync()
  await become(other)
  await sync.sync() // takes the marker
  assert.match(store.get('mise.sync.folded') ?? '', /legacy-3fc04e98/)
  // Un-folded by a newer rename, then deleted: refused here as well.
  await tick()
  const body = { ...serverList(LEGACY)!.body, name: 'Groceries' }
  delete body.foldedInto
  await sync.applyRemote({ records: [{ kind: 'list', uid: LEGACY, updatedAt: Date.now(), body }], tombstones: [] })
  await tick()
  await sync.applyRemote({ records: [], tombstones: [{ kind: 'list', uid: LEGACY, deletedAt: Date.now() }] })
  assert.equal((await db.lists.get(old))?.foldedInto, 'default:list')
})

test('#684: a list this device never held folded is still deleted as usual', async () => {
  await reset()
  await lists.ensureSeed()
  const id = (await db.lists.add({ name: 'Costco', kind: 'grocery', createdAt: Date.now() })) as number
  const uid = (await db.lists.get(id))!.uid!
  await tick()
  await sync.applyRemote({ records: [], tombstones: [{ kind: 'list', uid, deletedAt: Date.now() }] })
  assert.equal(await db.lists.get(id), undefined)
})
