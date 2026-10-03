/**
 * Paste a list with the AI off: parsed by plain code, aisles from the
 * catalogue, merged by addItem, and never a request to /api/parse.
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

// Any network call fails the test, which is the point.
const calls: string[] = []
globalThis.fetch = (async (url: unknown) => {
  calls.push(String(url))
  throw new Error('no network in this test')
}) as typeof fetch

const { db } = await import('./db')
const { addItem } = await import('./list')
const { splitEntries, parseEntry, planPlainPaste } = await import('./plainPaste')

test('slashes, commas and lines all separate entries; bullets are dropped', () => {
  assert.deepEqual(splitEntries('2 lb ground beef / milk / 3 cans black beans'),
    ['2 lb ground beef', 'milk', '3 cans black beans'])
  assert.deepEqual(splitEntries('- eggs\n* 1/2 cup rice\n[ ] bread, butter;'),
    ['eggs', '1/2 cup rice', 'bread', 'butter'])
})

test('an amount and unit come off the front; a bare name stays whole', () => {
  assert.deepEqual(parseEntry('2 lb ground beef'),
    { displayName: 'ground beef', canonicalKey: 'ground beef', quantity: 2, unit: 'lb' })
  assert.deepEqual(parseEntry('3 cans of black beans'),
    { displayName: 'black beans', canonicalKey: 'black bean', quantity: 3, unit: 'can' })
  assert.equal(parseEntry('1 1/2 cups flour')?.quantity, 1.5)
  assert.equal(parseEntry('½ cup milk')?.quantity, 0.5)
  assert.deepEqual(parseEntry('12 eggs'),
    { displayName: 'eggs', canonicalKey: 'egg', quantity: 12, unit: undefined })
  assert.equal(parseEntry('7up')?.displayName, '7up')
  assert.equal(parseEntry('7up')?.quantity, undefined)
  assert.equal(parseEntry('milk')?.quantity, undefined)
})

test('the example list adds three merged items with remembered aisles, offline', async () => {
  await Promise.all([db.lists.clear(), db.items.clear(), db.catalog.clear()])
  const listId = (await db.lists.add({ name: 'My list', kind: 'grocery', createdAt: 1, uid: 'L-g' } as never)) as number
  await db.catalog.add({ canonicalKey: 'ground beef', displayName: 'Ground beef', section: 'meat',
    count: 2, favorite: false, lastAdded: 1, uid: 'C-b' } as never)
  await db.catalog.add({ canonicalKey: 'milk', displayName: 'Milk', unit: 'gal', section: 'dairy',
    count: 5, favorite: true, lastAdded: 1, uid: 'C-m' } as never)
  await db.items.add({ listId, displayName: 'Ground beef', canonicalKey: 'ground beef', section: 'meat',
    unit: 'lb', quantity: 1, checked: false, backlog: false, createdAt: 1 } as never)

  const rows = await planPlainPaste('2 lb ground beef / milk / 3 cans black beans')
  assert.equal(rows.length, 3)
  assert.equal(rows[0]!.section, 'meat', 'aisle remembered')
  assert.equal(rows[1]!.unit, 'gal', 'usual unit when none typed')
  assert.equal(rows[2]!.section, 'other', 'unknown stays other')
  for (const r of rows) {
    await addItem({ listId, displayName: r.displayName, canonicalKey: r.canonicalKey,
      quantity: r.quantity, unit: r.unit, section: r.section })
  }

  const items = await db.items.where('listId').equals(listId).toArray()
  assert.equal(items.length, 3, 'beef merged into the existing line, not a fourth row')
  assert.equal(items.find((i) => i.canonicalKey === 'ground beef')!.quantity, 3)
  assert.equal(items.find((i) => i.canonicalKey === 'milk')!.section, 'dairy')
  assert.deepEqual(calls, [], 'nothing reached /api/parse')
})
