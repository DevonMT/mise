/**
 * #278: a device's lists belong to the account they last synced with, not to
 * whoever signs in on the browser next.
 *
 * A small platform with two accounts and the same refusal as devondoes
 * platform/src/mise.ts POST /state: a push naming another account is a 409,
 * before anything is merged.
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

type Rec = { kind: string; uid: string; updatedAt: number; body: Record<string, unknown> }
type Tomb = { kind: string; uid: string; deletedAt: number }
type Account = { records: Map<string, Rec>; tombs: Map<string, Tomb> }
const accounts = new Map<string, Account>()
const acct = (id: string) => {
  if (!accounts.has(id)) accounts.set(id, { records: new Map(), tombs: new Map() })
  return accounts.get(id)!
}
const key = (x: { kind: string; uid: string }) => `${x.kind}|${x.uid}`

/** Who the browser's session cookie says is signed in; null = signed out. */
let signedIn: string | null = 'alice'
/** Whether the platform knows about #278 (names the account, refuses). */
let platformNamesAccount = true

;(globalThis as unknown as { fetch: unknown }).fetch = async (url: string, init?: RequestInit) => {
  const u = String(url)
  if (!signedIn) return new Response('{}', { status: 401 })
  if (u.endsWith('/state')) {
    const body = JSON.parse(String(init!.body)) as { records: Rec[]; tombstones: Tomb[]; account?: string }
    if (platformNamesAccount && body.account != null && body.account !== signedIn) {
      return new Response(JSON.stringify({ error: 'account mismatch', account: signedIn }), { status: 409 })
    }
    // Naming none: refused when it carries another account's list, item or
    // recipe (platform/src/mise.ts; no shares in this world).
    if (platformNamesAccount && body.account == null) {
      const mine = acct(signedIn).records
      const theirs = body.records.some((r) =>
        ['list', 'item', 'recipe'].includes(r.kind) && !r.uid.startsWith('default:') && !mine.has(key(r)) &&
        [...accounts].some(([id, a]) => id !== signedIn && a.records.has(key(r))))
      if (theirs) {
        return new Response(JSON.stringify({ error: 'account mismatch', account: signedIn }), { status: 409 })
      }
    }
    const a = acct(signedIn)
    for (const r of body.records) {
      const cur = a.records.get(key(r))
      if (!cur || r.updatedAt > cur.updatedAt) a.records.set(key(r), structuredClone(r))
    }
    for (const t of body.tombstones) a.tombs.set(key(t), t)
    for (const [k, t] of a.tombs) {
      const r = a.records.get(k)
      if (r && t.deletedAt >= r.updatedAt) a.records.delete(k)
    }
    return new Response(JSON.stringify({
      records: [...a.records.values()], tombstones: [...a.tombs.values()], variant: null,
      ...(platformNamesAccount ? { account: signedIn } : {}),
    }))
  }
  if (u.endsWith('/shares')) return new Response(JSON.stringify({ shares: [] }))
  if (u.endsWith('/health')) return new Response(JSON.stringify({ variant: null }))
  return new Response('{}', { status: 404 })
}

const { db } = await import('./db')
const sync = await import('./sync')
const lists = await import('./lists')
const account = await import('./account')

const names = (id: string) =>
  [...acct(id).records.values()].filter((r) => r.kind === 'item').map((r) => r.body.canonicalKey).sort()
const localNames = async () => (await db.items.toArray()).map((i) => i.canonicalKey).sort()

async function addItem(listId: number, k: string) {
  await db.items.add({ listId, displayName: k, canonicalKey: k, section: 'other',
    checked: false, backlog: false, createdAt: Date.now() })
}

/** A fresh browser, and a platform where Bob already has his own list. */
async function reset() {
  accounts.clear()
  store.clear()
  signedIn = 'alice'
  platformNamesAccount = true
  await sync.keepingStamps([db.lists, db.items, db.tombstones, db.settings], async () => {
    for (const t of [db.lists, db.items, db.tombstones, db.settings]) await t.clear()
  })
  const b = acct('bob')
  const now = Date.now()
  b.records.set('list|default:list', { kind: 'list', uid: 'default:list', updatedAt: now,
    body: { name: 'Bob list', kind: 'grocery', createdAt: now } })
  b.records.set('item|bob-1', { kind: 'item', uid: 'bob-1', updatedAt: now,
    body: { listUid: 'default:list', displayName: 'beer', canonicalKey: 'beer', section: 'other',
            checked: false, backlog: false, createdAt: now } })
  store.set('mise.sync.enabled', '1')
}

/** Alice uses the browser, synced, and signs out; Bob signs in. */
async function aliceThenBob() {
  await reset()
  const id = await lists.ensureSeed()
  await addItem(id, 'milk')
  await addItem(id, 'tampons')
  assert.equal((await sync.sync()).ok, true)
  assert.equal(account.boundAccount(), 'alice', 'bound on the first sync')
  signedIn = null
  assert.equal((await sync.sync()).ok, false)
  signedIn = 'bob'
  return id
}

test("#278: signing in as somebody else never pushes the last person's lists", async () => {
  await aliceThenBob()
  const r = await sync.sync()
  assert.equal(r.ok, false)
  assert.equal(!r.ok && r.reason, 'account')
  assert.equal(!r.ok && r.reason === 'account' && r.account, 'bob')
  assert.deepEqual(names('bob'), ['beer'], "Bob's account holds only Bob's list")
  assert.deepEqual(await localNames(), ['milk', 'tampons'], "and Bob's list is not pulled into Alice's")
  assert.equal(account.boundAccount(), 'alice', 'still Alice’s until someone chooses')
})

test('#278: signed out, the lists keep working and nothing is unbound', async () => {
  const id = await aliceThenBob()
  signedIn = null
  await addItem(id, 'eggs')
  assert.equal((await sync.sync()).ok, false)
  assert.deepEqual(await localNames(), ['eggs', 'milk', 'tampons'])
  assert.equal(account.boundAccount(), 'alice')
  signedIn = 'alice' // and Alice signing back in carries on as before
  assert.equal((await sync.sync()).ok, true)
  assert.deepEqual(names('alice'), ['eggs', 'milk', 'tampons'])
})

test('#278: "keep them" makes the lists the signed-in account’s, merged with its own', async () => {
  await aliceThenBob()
  const r = await sync.keepForAccount('bob')
  assert.equal(r.ok, true)
  assert.equal(account.boundAccount(), 'bob')
  assert.deepEqual(names('bob'), ['beer', 'milk', 'tampons'])
  assert.deepEqual(names('alice'), ['milk', 'tampons'], "Alice's account untouched")
})

test('#278: "clear this device" forgets them without deleting them anywhere, then takes Bob’s', async () => {
  await aliceThenBob()
  store.set('mise.store', 'Alice’s Kroger')
  await account.clearThisDevice('bob')
  assert.deepEqual(await localNames(), [])
  assert.equal(await db.tombstones.count(), 0, 'no tombstones: they are still Alice’s')
  assert.equal(store.get('mise.store'), undefined)
  assert.equal(store.get('mise.sync.last'), undefined, 'so the first sync decides the seeding')
  assert.equal((await sync.sync()).ok, true)
  assert.deepEqual(await localNames(), ['beer'])
  assert.deepEqual(names('alice'), ['milk', 'tampons'], "Alice's account untouched")
  assert.equal(accounts.get('alice')!.tombs.size, 0)
  assert.deepEqual(names('bob'), ['beer'])
})

test('#278: a device that never synced binds to the first account it syncs as', async () => {
  await reset()
  signedIn = 'bob'
  const id = await lists.ensureSeed()
  await addItem(id, 'bread') // made signed out, then Bob signed in: his to keep
  assert.equal(account.boundAccount(), null)
  assert.equal((await sync.sync()).ok, true)
  assert.equal(account.boundAccount(), 'bob')
  assert.ok(names('bob').includes('bread'))
})

test('#278: against a platform that does not name the account, sync works as before, unbound', async () => {
  await reset()
  platformNamesAccount = false
  const id = await lists.ensureSeed()
  await addItem(id, 'milk')
  assert.equal((await sync.sync()).ok, true)
  assert.equal(account.boundAccount(), null)
})

test('#278: a platform that names another account without refusing: nothing is taken back', async () => {
  await aliceThenBob()
  platformNamesAccount = false // no refusal...
  const realFetch = globalThis.fetch
  ;(globalThis as unknown as { fetch: unknown }).fetch = async (url: string, init?: RequestInit) => {
    const res = await realFetch(url, init)
    if (!String(url).endsWith('/state')) return res
    return new Response(JSON.stringify({ ...(await res.json()), account: 'bob' })) // ...but names Bob
  }
  try {
    const r = await sync.sync()
    assert.equal(!r.ok && r.reason, 'account')
    assert.deepEqual(await localNames(), ['milk', 'tampons'], "Bob's beer not pulled in")
  } finally {
    ;(globalThis as unknown as { fetch: unknown }).fetch = realFetch
  }
})

test('#278: clearing waits out a sync in flight, so none of its rows survive the clear', async () => {
  await aliceThenBob()
  signedIn = 'alice' // Alice signs back in in another tab while the sheet is open
  const running = sync.sync() // an ok sync, writing Alice's state row by row
  const clearing = account.clearThisDevice('bob')
  const asked = sync.sync() // and a sync asked for during the clear runs after it
  assert.equal((await running).ok, true)
  await clearing
  assert.equal(account.boundAccount(), 'bob')
  const r = await asked
  assert.equal(!r.ok && r.reason, 'account', 'Alice is signed in, the device is now Bob’s: asked again')
  assert.deepEqual(await localNames(), [], 'nothing of Alice’s left to push')
  assert.deepEqual(names('bob'), ['beer'])
})

test('#278: clearing also drops the old theme pick, so it never becomes a row in the new account', async () => {
  await aliceThenBob()
  store.set('mise.theme', 'dark')
  await account.clearThisDevice('bob')
  assert.equal(store.get('mise.theme'), undefined)
})

test('#278: a device with no binding (synced before #278, or cleared localStorage) holding Alice’s lists is asked too', async () => {
  await reset()
  const listId = (await db.lists.add({ name: 'Costco', kind: 'grocery', createdAt: Date.now() })) as number
  await addItem(listId, 'tampons')
  signedIn = 'alice'
  assert.equal((await sync.sync()).ok, true)
  store.delete('mise.sync.account') // as a build from before #278 left it
  signedIn = 'bob'
  const r = await sync.sync()
  assert.equal(!r.ok && r.reason, 'account', 'refused for carrying Alice’s rows')
  assert.equal(account.boundAccount(), null, 'and not bound to Bob')
  assert.ok(!names('bob').includes('tampons'))
  assert.equal((await sync.keepForAccount('bob')).ok, true, 'a choice still can')
  assert.ok(names('bob').includes('tampons'))
})

test('#278: Keep only binds once its push has gone', async () => {
  await aliceThenBob()
  signedIn = null // signed out before the push
  const r = await sync.keepForAccount('bob')
  assert.equal(r.ok, false)
  assert.equal(account.boundAccount(), 'alice', 'still Alice’s, so the next sync as Bob asks again')
})

test('#278: clearing drops every synced key, the area too', async () => {
  await aliceThenBob()
  for (const k of ['mise.store', 'mise.area', 'mise.aisles', 'mise.refineAsked']) store.set(k, 'alice’s')
  await account.clearThisDevice('bob')
  for (const k of ['mise.store', 'mise.area', 'mise.aisles', 'mise.refineAsked']) assert.equal(store.get(k), undefined, k)
})
