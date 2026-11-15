/**
 * One product under two uids (#876). Two devices that each price, star or
 * learn a size for the same new product before they sync each mint a catalog
 * row for it, and the catalog is unique on canonicalKey. applyRemote used to
 * `add` the second one, throw a ConstraintError mid-loop, and leave every
 * record after it unapplied, on every sync, for good.
 *
 * A small in-memory platform (the merge rules of devondoes platform/src/mise.ts
 * POST /state) and a way to swap the one IndexedDB between "devices", as in
 * fold.test.ts.
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
// Expected noise: the one record test 4 cannot write.
console.warn = () => {}

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

;(globalThis as unknown as { fetch: unknown }).fetch = async (url: string, init?: RequestInit) => {
  const u = String(url)
  if (u.endsWith('/state')) return new Response(JSON.stringify(postState(JSON.parse(String(init!.body)))))
  if (u.endsWith('/shares')) return new Response(JSON.stringify({ shares: [] }))
  if (u.endsWith('/health')) return new Response(JSON.stringify({ variant: null }))
  return new Response('{}', { status: 404 })
}

const { db } = await import('./db')
const sync = await import('./sync')
const { mergeDuplicates, mergeLearned } = await import('./catalogMerge')
import type { CatalogEntry, LearnedSize } from './db'

const TABLES = () => [db.lists, db.items, db.recipes, db.catalog, db.settings, db.tombstones]
type Device = Record<string, unknown[]>
async function snapshot(): Promise<Device> {
  const out: Device = {}
  for (const t of TABLES()) out[t.name] = await t.toArray()
  return structuredClone(out)
}
/** Become another device: its rows exactly as they were, stamps and all. */
async function become(d: Device) {
  await sync.keepingStamps(TABLES() as never, async () => {
    for (const t of TABLES()) {
      await t.clear()
      await t.bulkAdd(structuredClone(d[t.name] ?? []) as never[])
    }
  })
}
async function reset() {
  server.records.clear()
  server.tombs.clear()
  store.clear()
  store.set('mise.sync.enabled', '1')
  await become({})
}

/** What a device holds for the catalog, without its local ids. */
const catalog = async () =>
  (await db.catalog.toArray()).map(({ id: _id, ...r }) => r).sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey))
const serverCatalog = () =>
  [...server.records.values()].filter((r) => r.kind === 'catalog').map((r) => ({ ...r.body, uid: r.uid, updatedAt: r.updatedAt }))

const entry = (uid: string, rest: Partial<CatalogEntry> = {}): CatalogEntry => ({
  uid, canonicalKey: 'harissa', displayName: 'Harissa', section: 'condiments',
  count: 0, favorite: false, lastAdded: 1, ...rest,
})
const jar: LearnedSize = { size: 10, unit: 'oz', packaging: 'jar', estimated: true, at: 1_000 }

// ---- The merge itself ----------------------------------------------------------

test('both devices pick the same winner and write the same row, whichever copy is local', () => {
  const phone = { ...entry('b-phone', { price: 3.99, count: 2 }), updatedAt: 500 }
  const laptop = { ...entry('a-laptop', { learnedSizes: [jar], favorite: true }), updatedAt: 700 }
  const one = mergeDuplicates([phone, laptop])
  const two = mergeDuplicates([laptop, phone])
  assert.deepEqual(one, two)
  assert.equal(one.winner.uid, 'a-laptop', 'the smallest uid keeps the product')
  assert.deepEqual(one.losers.map((l) => l.uid), ['b-phone'])
  assert.equal(one.winner.price, 3.99, "the phone's price is folded in")
  assert.deepEqual(one.winner.learnedSizes, [jar], "and the laptop's learned size kept")
  assert.equal(one.winner.favorite, true)
  assert.equal(one.winner.count, 2)
  assert.equal(one.winner.updatedAt, 701, 'one past the newest copy, so it beats both on the server')
})

test('folding a retired copy in again changes nothing, so it cannot ping-pong', () => {
  const phone = { ...entry('b-phone', { price: 3.99, count: 2 }), updatedAt: 500 }
  const laptop = { ...entry('a-laptop', { learnedSizes: [jar] }), updatedAt: 700 }
  const { winner } = mergeDuplicates([phone, laptop])
  const again = mergeDuplicates([winner, phone])
  assert.deepEqual(again.winner, winner, 'same row, same stamp')
})

test('learned sizes from both copies: one per packaging, the newest wins', () => {
  const tube = { ...jar, packaging: 'tube', size: 4.5 }
  const newerJar = { ...jar, size: 12, at: 2_000 }
  assert.deepEqual(mergeLearned([{ learnedSizes: [jar] }, { learnedSizes: [tube, newerJar] }]),
    { learnedSizes: [newerJar, tube], learnedGone: undefined })
})

// ---- #870: learned sizes merge entry by entry, deletes included -------------------

test('a delete marker beats an older size and loses to a newer one; a tie goes to the delete', () => {
  const tube = { ...jar, packaging: 'tube', size: 4.5, at: 3_000 }
  const gone = (packaging: string, at: number) => ({ packaging, at })
  assert.deepEqual(mergeLearned([{ learnedGone: [gone('jar', 1_500)] }, { learnedSizes: [jar, tube] }]),
    { learnedSizes: [tube], learnedGone: [gone('jar', 1_500)] }, 'deleted after it was learned')
  assert.deepEqual(mergeLearned([{ learnedGone: [gone('tube', 2_000)] }, { learnedSizes: [jar, tube] }]),
    { learnedSizes: [jar, tube], learnedGone: undefined }, 'learned again after the delete')
  assert.deepEqual(mergeLearned([{ learnedGone: [gone('jar', 1_000)] }, { learnedSizes: [jar] }]),
    { learnedSizes: undefined, learnedGone: [gone('jar', 1_000)] })
})

const L = await import('./learnedSizes')

/** One product both devices already hold under one uid, with a jar and a tube size. */
async function shared() {
  await reset()
  await db.catalog.add(entry('a-harissa', { learnedSizes: [jar, { ...jar, packaging: 'tube', size: 4.5 }] }))
  await sync.sync()
  return snapshot()
}
const harissaRow = async () => (await db.catalog.where('canonicalKey').equals('harissa').first())!
const sizes = async () => (await harissaRow()).learnedSizes?.map((s) => `${s.size} ${s.packaging}`) ?? []

test('a size deleted offline stays deleted when the other device edited the row later', async () => {
  const laptop = await shared()
  // The phone, offline, deletes the jar size.
  assert.equal(await L.deleteLearnedSize((await harissaRow()).id!, 'jar'), null)
  const phone = await snapshot()

  // Later, the laptop edits the tube size and syncs first: its row is newer.
  await become(laptop)
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(await L.editLearnedSize((await harissaRow()).id!, 'tube', { size: 5, unit: 'oz', packaging: 'tube' }), null)
  await sync.sync()
  const laptopAfter = await snapshot()

  await become(phone)
  await sync.sync()
  await sync.sync() // pushes what the merge added
  assert.deepEqual(await sizes(), ['5 tube'], "the laptop's edit, without the jar the phone deleted")

  await become(laptopAfter)
  await sync.sync()
  assert.deepEqual(await sizes(), ['5 tube'], 'and the laptop agrees')

  // Settled: more syncs on either device change nothing.
  const stamp = server.records.get('catalog|a-harissa')!.updatedAt
  const laptopSettled = await snapshot()
  await sync.sync()
  await become(phone)
  await sync.sync()
  await sync.sync()
  await become(laptopSettled)
  await sync.sync()
  assert.equal(server.records.get('catalog|a-harissa')!.updatedAt, stamp, 'no ping-pong')
})

test('a size edited offline survives a newer edit to another field of the row', async () => {
  const laptop = await shared()
  assert.equal(await L.editLearnedSize((await harissaRow()).id!, 'jar', { size: 12, unit: 'oz', packaging: 'jar' }), null)
  const phone = await snapshot()

  await become(laptop)
  await new Promise((r) => setTimeout(r, 5))
  await db.catalog.update((await harissaRow()).id!, { price: 3.49 })
  await sync.sync()
  const laptopAfter = await snapshot()

  await become(phone)
  await sync.sync()
  await sync.sync()
  assert.deepEqual(await sizes(), ['12 jar', '4.5 tube'])
  assert.equal((await harissaRow()).price, 3.49, 'the newer row still wins its other fields')

  await become(laptopAfter)
  await sync.sync()
  assert.deepEqual(await sizes(), ['12 jar', '4.5 tube'])
})

test('a size learned again after a delete comes back on every device', async () => {
  const laptop = await shared()
  await L.deleteLearnedSize((await harissaRow()).id!, 'jar')
  await sync.sync()
  await new Promise((r) => setTimeout(r, 5))
  await L.learnSizes([{ displayName: 'harissa', canonicalKey: 'harissa', section: 'condiments', quantity: 1, unit: 'jar',
                        sizeAmount: 9, sizeUnit: 'oz', packaging: 'jar', buyCount: 1, sizeEstimated: true }])
  assert.equal((await harissaRow()).learnedGone, undefined, 'the marker goes when the size is back')
  await sync.sync()
  await become(laptop)
  await sync.sync()
  assert.deepEqual(await sizes(), ['4.5 tube', '9 jar'])
})

// ---- Two devices, one account --------------------------------------------------

test('two devices that each made the same product converge on one row everywhere', async () => {
  await reset()
  // The phone prices harissa and syncs.
  await db.catalog.add(entry('b-phone', { price: 3.99, count: 1 }))
  assert.equal((await sync.sync()).ok, true)
  const phone = await snapshot()

  // The laptop, offline meanwhile, learned a jar size for harissa, and starred
  // another product, then syncs. This is the pull that used to throw.
  await become({})
  await db.catalog.add(entry('a-laptop', { learnedSizes: [jar] }))
  await db.catalog.add(entry('c-cumin', { canonicalKey: 'cumin', displayName: 'Cumin', favorite: true }))
  const first = await sync.sync()
  assert.equal(first.ok, true)
  assert.equal(first.ok && first.failed, 0)
  await sync.sync() // and pushes the merge (the hooks schedule this push in the app)
  const laptop = await catalog()
  assert.deepEqual(laptop.map((r) => r.uid), ['c-cumin', 'a-laptop'], 'cumin, and one harissa')
  const harissa = laptop.find((r) => r.canonicalKey === 'harissa')!
  assert.equal(harissa.uid, 'a-laptop')
  assert.equal(harissa.price, 3.99, "the phone's price")
  assert.deepEqual(harissa.learnedSizes, [jar], "the laptop's learned size")

  // The server dropped the retired copy.
  assert.deepEqual(serverCatalog().map((r) => r.uid).sort(), ['a-laptop', 'c-cumin'])
  assert.ok(server.tombs.has('catalog|b-phone'), 'retired by a tombstone')

  // The phone syncs and ends up holding exactly what the laptop does.
  await become(phone)
  assert.equal((await sync.sync()).ok, true)
  assert.deepEqual(await catalog(), laptop, 'same uid, same fields, same stamp on both devices')
  assert.deepEqual(
    serverCatalog().sort((a, b) => String(a.canonicalKey).localeCompare(String(b.canonicalKey))),
    laptop, 'and on the server')
})

test('an edit to the retired copy made offline is folded in when it arrives', async () => {
  await reset()
  await db.catalog.add(entry('b-phone', { price: 3.99 }))
  assert.equal((await sync.sync()).ok, true)
  const phone = await snapshot()

  await become({})
  await db.catalog.add(entry('a-laptop', { learnedSizes: [jar] }))
  await sync.sync()
  await sync.sync()
  const laptop = await snapshot()

  // The phone, still offline, changes the price on its copy, then syncs.
  await become(phone)
  const row = (await db.catalog.where('canonicalKey').equals('harissa').first())!
  await db.catalog.update(row.id!, { price: 4.49 })
  await sync.sync()
  await sync.sync()
  const after = await catalog()
  assert.deepEqual(after.map((r) => r.uid), ['a-laptop'])
  assert.equal(after[0].price, 4.49, 'the later edit stands, on the surviving row')
  assert.deepEqual(after[0].learnedSizes, [jar])

  await become(laptop)
  await sync.sync()
  assert.deepEqual(await catalog(), after, 'and the laptop agrees')
})

// ---- One pull, one bad record ----------------------------------------------------

test('a pull carrying a duplicate still applies every other record in it', async () => {
  await reset()
  await db.catalog.add(entry('b-mine', { price: 2 }))
  const listUid = 'list-from-phone'
  const r = await sync.applyRemote({
    records: [
      { kind: 'catalog', uid: 'a-theirs', updatedAt: 900, body: { ...entry('a-theirs', { learnedSizes: [jar] }) } },
      { kind: 'catalog', uid: 'd-dill', updatedAt: 900, body: { ...entry('d-dill', { canonicalKey: 'dill', displayName: 'Dill' }) } },
      { kind: 'list', uid: listUid, updatedAt: 900, body: { name: 'Phone', kind: 'grocery', createdAt: 1 } },
      { kind: 'item', uid: 'item-1', updatedAt: 900, body: { listUid, displayName: 'Milk', canonicalKey: 'milk', section: 'dairy', checked: false, backlog: false, createdAt: 1 } },
      { kind: 'recipe', uid: 'recipe-1', updatedAt: 900, body: { title: 'Toast', servings: 1, ingredients: [], createdAt: 1 } },
      { kind: 'setting', uid: 'mise.area', updatedAt: 900, body: { key: 'mise.area', value: 'Austin, TX' } },
    ],
    tombstones: [],
  })
  assert.equal(r.failed, 0)
  assert.deepEqual((await catalog()).map((c) => c.uid).sort(), ['a-theirs', 'd-dill'])
  assert.equal((await db.catalog.where('canonicalKey').equals('harissa').first())?.price, 2, 'merged, not dropped')
  assert.ok(await db.lists.where('uid').equals(listUid).first())
  assert.ok(await db.items.where('uid').equals('item-1').first())
  assert.ok(await db.recipes.where('uid').equals('recipe-1').first())
  assert.equal((await db.settings.where('key').equals('mise.area').first())?.value, 'Austin, TX')
})

test('a record that will not write is skipped and the rest of the pull lands', async () => {
  await reset()
  // A setting under its own key as uid, and an incoming one claiming the same
  // key under another uid: settings are unique on key too, so this cannot be written.
  await db.settings.add({ uid: 'mise.store', key: 'mise.store', value: 'Kroger' })
  const r = await sync.applyRemote({
    records: [
      { kind: 'setting', uid: 'stray-uid', updatedAt: 900, body: { key: 'mise.store', value: 'HEB' } },
      { kind: 'setting', uid: 'mise.area', updatedAt: 900, body: { key: 'mise.area', value: 'Austin, TX' } },
    ],
    tombstones: [],
  })
  assert.equal(r.failed, 1)
  assert.equal(r.added, 1)
  assert.equal((await db.settings.where('key').equals('mise.area').first())?.value, 'Austin, TX', 'the record after it landed')
  assert.equal((await db.settings.where('key').equals('mise.store').first())?.value, 'Kroger')
})

// ---- Hardening (#876 architect review) ----------------------------------------------

const { mergeSameRow, sameRow } = await import('./catalogMerge')

test('rows compare equal whatever order their keys come back in (Postgres jsonb reorders them)', () => {
  const a = { uid: 'x', learnedSizes: [{ size: 10, unit: 'oz', packaging: 'jar', at: 1 }], price: 2 }
  const b = { price: 2, learnedSizes: [{ at: 1, packaging: 'jar', unit: 'oz', size: 10 }], uid: 'x' }
  assert.equal(sameRow(a, b), true)
  assert.equal(sameRow(a, { ...b, learnedSizes: [{ ...b.learnedSizes[0], size: 12 }] }), false)
})

test('same uid: identical copies change nothing, and a tie on the stamp goes to the server copy', () => {
  const mine = { ...entry('a-x', { price: 3 }), updatedAt: 500 }
  assert.equal(mergeSameRow(mine, { ...mine, id: undefined }), null, 'identical')
  assert.equal(mergeSameRow({ ...mine, id: 7 }, { ...mine, updatedAt: 900 }), null, 'identical but for the stamp')
  const theirs = { ...entry('a-x', { price: 4 }), updatedAt: 500 }
  assert.equal(mergeSameRow(mine, theirs), theirs, "the server's fields win the tie, and nothing is restamped")
  // A newer local copy that the union adds nothing to keeps its own stamp.
  const newer = { ...mine, updatedAt: 600, learnedSizes: [jar] }
  assert.equal(mergeSameRow(newer, { ...theirs, learnedSizes: [jar] }), null)
})

test('same uid, same stamp, different price and sizes on two devices: all three copies end equal', async () => {
  await reset()
  const T = Date.now() - 60_000
  const tube = { ...jar, packaging: 'tube', size: 4.5 }
  const row = (rest: Partial<CatalogEntry>) => ({ ...entry('a-harissa', rest), updatedAt: T })
  await sync.keepingStamps([db.catalog], () => db.catalog.add(row({ price: 3, learnedSizes: [jar] })))
  const phone = await snapshot()
  await become({})
  await sync.keepingStamps([db.catalog], () => db.catalog.add(row({ price: 4, learnedSizes: [tube] })))
  const laptop = await snapshot()

  await become(phone)
  await sync.sync()
  const phone1 = await snapshot()
  await become(laptop)
  await sync.sync() // the server kept the phone's copy (the incumbent); the laptop adds its tube
  await sync.sync()
  const onLaptop = await catalog()
  await become(phone1)
  await sync.sync()
  const onPhone = await catalog()

  assert.deepEqual(onPhone, onLaptop)
  assert.deepEqual(serverCatalog(), onLaptop)
  assert.equal(onLaptop[0].price, 3, "the server's copy won the tie")
  assert.deepEqual(onLaptop[0].learnedSizes?.map((s) => s.packaging), ['jar', 'tube'], 'both sizes kept')
})

test('malformed learned sizes off the wire are skipped, never thrown on, and the pull goes on', async () => {
  await reset()
  await db.catalog.add(entry('a-x', { learnedSizes: [jar] }))
  const local = (await db.catalog.where('uid').equals('a-x').first())!
  const r = await sync.applyRemote({
    records: [
      { kind: 'catalog', uid: 'a-x', updatedAt: local.updatedAt! + 10,
        body: { ...entry('a-x'), learnedSizes: [null, 5, 'jar', { size: 1 }, { ...jar, packaging: 'tub' }], learnedGone: 'gone' } },
      { kind: 'catalog', uid: 'b-y', updatedAt: 900, body: { ...entry('b-y', { canonicalKey: 'dill', displayName: 'Dill' }), learnedSizes: 'nonsense' } },
      { kind: 'setting', uid: 'mise.area', updatedAt: 900, body: { key: 'mise.area', value: 'Austin, TX' } },
    ],
    tombstones: [],
  })
  assert.equal(r.failed, 0)
  const x = (await db.catalog.where('uid').equals('a-x').first())!
  assert.deepEqual(x.learnedSizes?.map((s) => s.packaging), ['tub', 'jar'], 'the well-formed entries, merged')
  assert.ok(await db.catalog.where('uid').equals('b-y').first())
  assert.equal((await db.settings.where('key').equals('mise.area').first())?.value, 'Austin, TX')
})
