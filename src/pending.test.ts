/**
 * Rows the hub added (`pending`), filed by this app with its own add engine.
 *
 * The hub writes a bare name onto a list; what matters here is that filing it
 * does what adding it in Mise would have done — merge with a line already
 * there, take the aisle and name from the catalogue — and that doing it twice
 * (two devices at once) cannot make two rows.
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
const { filePending } = await import('./list')
const { applyRemote } = await import('./sync')

async function fresh() {
  await Promise.all([db.lists.clear(), db.items.clear(), db.catalog.clear(), db.tombstones.clear()])
  const groceryId = await db.lists.add({ name: 'My list', kind: 'grocery', createdAt: 1, uid: 'L-g' } as never)
  const tasksId = await db.lists.add({ name: 'To Do', kind: 'tasks', createdAt: 1, uid: 'L-t' } as never)
  await db.catalog.add({ canonicalKey: 'avocado', displayName: 'Hass avocado', section: 'produce',
    count: 3, favorite: true, lastAdded: 1, uid: 'C-a', buyCount: 1, packaging: 'bag' } as never)
  return { groceryId: groceryId as number, tasksId: tasksId as number }
}

/** A row exactly as the hub writes it, arriving through an ordinary sync. */
const hubRow = (uid: string, listUid: string, displayName: string, quantity?: number) => ({
  kind: 'item' as const, uid, updatedAt: 5_000,
  body: { uid, updatedAt: 5_000, createdAt: 5_000, listUid, displayName, canonicalKey: displayName.toLowerCase(),
          section: 'other', checked: false, backlog: false, pending: true, ...(quantity ? { quantity } : {}) },
})

test('a hub add merges into the line already on the list', async () => {
  const { groceryId } = await fresh()
  await db.items.add({ listId: groceryId, displayName: 'Milk', canonicalKey: 'milk', section: 'dairy',
    checked: true, backlog: false, createdAt: 1, quantity: 1 } as never)
  await applyRemote({ records: [hubRow('H-1', 'L-g', 'milks', 2)], tombstones: [] })

  assert.equal(await filePending(), 1)
  const rows = await db.items.where('listId').equals(groceryId).toArray()
  assert.equal(rows.length, 1, 'one milk, not two')
  assert.equal(rows[0]!.quantity, 3)
  assert.equal(rows[0]!.checked, false, 'a checked line comes back when more is needed')
  assert.ok(await db.tombstones.where({ kind: 'item', uid: 'H-1' }).first(), 'the delete travels to other devices')
})

test('a new hub add takes its aisle, name and pack from the catalogue, keeping its uid', async () => {
  await fresh()
  await applyRemote({ records: [hubRow('H-2', 'L-g', 'avocados', 3)], tombstones: [] })
  await filePending()
  const row = await db.items.where('uid').equals('H-2').first()
  assert.ok(row, 'filed in place, so every device converges on one row')
  assert.equal(row!.pending, undefined)
  assert.equal(row!.section, 'produce')
  assert.equal(row!.displayName, 'Hass avocado')
  assert.equal(row!.canonicalKey, 'avocado')
  assert.equal(row!.packaging, 'bag')
  assert.equal(row!.quantity, 3)
  assert.ok((row!.updatedAt ?? 0) > 5_000, 'the filed row syncs back out')
})

test('an unknown item stays in Other; a task list gets no aisle or pack', async () => {
  const { tasksId } = await fresh()
  await applyRemote({ records: [hubRow('H-3', 'L-g', 'birthday candles'), hubRow('H-4', 'L-t', 'avocado')], tombstones: [] })
  await filePending()
  assert.equal((await db.items.where('uid').equals('H-3').first())!.section, 'other')
  const task = await db.items.where('uid').equals('H-4').first()
  assert.equal(task!.listId, tasksId)
  assert.equal(task!.section, 'other')
  assert.equal(task!.packaging, undefined)
})

test('filing twice changes nothing the second time', async () => {
  await fresh()
  await applyRemote({ records: [hubRow('H-5', 'L-g', 'avocados')], tombstones: [] })
  assert.equal(await filePending(), 1)
  assert.equal(await filePending(), 0)
  assert.equal(await db.items.count(), 1)
})
