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

type Device = { lists: unknown[]; items: unknown[]; tombstones: unknown[]; active?: string }
async function snapshot(): Promise<Device> {
  return structuredClone({
    lists: await db.lists.toArray(), items: await db.items.toArray(),
    tombstones: await db.tombstones.toArray(), active: store.get('mise.activeList'),
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
async function legacyAccount(opts: { oldName?: string; createdAt?: number } = {}) {
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
  assert.deepEqual((await liveLists()).map((l) => l.uid), ['default:list'], 'and hidden')
  assert.equal(serverList(LEGACY)?.body.foldedInto, 'default:list')
  assert.ok(serverItems().every((r) => r.body.listUid === 'default:list'))
  assert.equal(server.tombs.size, 0, 'nothing deleted')

  await become(other) // device B, which still had the pair
  await sync.sync()
  assert.deepEqual(await onList(keep), [...KEYS].sort())
  assert.equal((await db.lists.get(old))?.foldedInto, 'default:list')
  const again = await fold.foldLegacyLists()
  assert.deepEqual(again, { folded: [], moved: 0, dropped: 0 }, 'a second pass has nothing to do')
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

test('3: two syncs at once share one run, so two merges never overlap', async () => {
  await legacyAccount()
  const a = sync.sync()
  const b = sync.sync()
  assert.equal(a, b)
  await a
})

test('3: what the fold drops leaves its own tombstone, written in the same transaction', async () => {
  const { keep, old } = await legacyAccount()
  // default:list already holds a tea identical to the old list's.
  await db.items.add({ listId: keep, displayName: 'tea', canonicalKey: 'tea', section: 'other',
    checked: false, backlog: false, createdAt: AUGUST })
  const teaOld = (await db.items.where('listId').equals(old).filter((i) => i.canonicalKey === 'tea').first())!
  await sync.sync() // folds, dropping the old tea
  const local = await db.tombstones.where('[kind+uid]').equals(['item', teaOld.uid!]).first()
  assert.equal(local?.deletedAt, teaOld.updatedAt! + 1, 'recorded with the drop, not by a hook later')
  await sync.sync() // and pushed
  assert.equal(serverItems().filter((r) => r.body.canonicalKey === 'tea').length, 1)
  assert.equal(server.tombs.get(`item|${teaOld.uid}`)?.deletedAt, teaOld.updatedAt! + 1)
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

test('6: a row that differs in unit, ticked or next-time is kept; only an identical one goes', async () => {
  const { keep, old } = await legacyAccount()
  const base = { section: 'other' as const, createdAt: AUGUST, listId: keep }
  await db.items.bulkAdd([
    { ...base, displayName: 'milk', canonicalKey: 'milk', unit: 'gal', checked: false, backlog: false },
    { ...base, displayName: 'eggs', canonicalKey: 'eggs', checked: true, backlog: false },
    { ...base, displayName: 'rice', canonicalKey: 'rice', checked: false, backlog: true },
    { ...base, displayName: 'Oats', canonicalKey: 'oats', checked: false, backlog: false },
  ])
  const oatsOld = (await db.items.where('listId').equals(old).filter((i) => i.canonicalKey === 'oats').first())!
  await sync.sync()
  await sync.sync()
  const keys = await onList(keep)
  assert.deepEqual(keys, ['eggs', 'eggs', 'milk', 'milk', 'oats', 'rice', 'rice', 'salt', 'tea'])
  assert.equal(server.tombs.get(`item|${oatsOld.uid}`)?.deletedAt, oatsOld.updatedAt! + 1,
    'the identical oats went, with a tombstone that loses to any later edit')
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
  assert.deepEqual(await fold.foldLegacyLists(), { folded: [], moved: 0, dropped: 0 })

  await become(other) // a device still holding the unmerged pair
  await sync.sync()
  assert.equal(await db.lists.get(old), undefined, 'the merge reached it')
  assert.deepEqual((await db.items.toArray()).map((i) => i.uid).sort(), after, 'six rows, not twelve')
  assert.equal(serverItems().length, 6)
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
