/**
 * Moving items between lists and to "Next time" (#808).
 *
 * The things that matter: a move keeps the row's identity (sync must see a
 * move, not a delete and an add), a move onto a list that already has the
 * ingredient merges instead of making a second row, and Undo puts everything
 * back exactly, merges included.
 */
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
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

const { db, listTree, subListParent } = await import('./db')
// The stamping hooks live in sync.ts; loading it is what mints uids here.
await import('./sync')
const { addItem } = await import('./list')
const { moveItems, createSubList, subListRoot, dropIfEmpty } = await import('./move')

let main = 0
beforeEach(async () => {
  await db.items.clear()
  await db.lists.clear()
  await db.tombstones.clear()
  main = await db.lists.add({ name: 'My list', kind: 'grocery', createdAt: 1, uid: 'default:list', updatedAt: 0 })
})

const add = (listId: number, displayName: string, extra: Record<string, unknown> = {}) =>
  addItem({ listId, displayName, section: 'produce', ...extra })

test('moving to Next time keeps the row, its uid, and unticks it', async () => {
  const id = await add(main, 'onion', { quantity: 2 })
  await db.items.update(id, { checked: true })
  const before = (await db.items.get(id))!
  await new Promise((r) => setTimeout(r, 2))

  const r = await moveItems([id], { listId: main, backlog: true })
  assert.equal(r.moved, 1)
  assert.equal(r.merged, 0)
  const after = (await db.items.get(id))!
  assert.equal(after.uid, before.uid, 'same identity, so sync carries a move')
  assert.equal(after.backlog, true)
  assert.equal(after.checked, false)
  assert.ok(after.updatedAt! > before.updatedAt!, 'a move is a real edit and gets a fresh stamp')
  assert.equal(await db.tombstones.count(), 0, 'nothing deleted')
})

test('moving to a new sub-list hangs it under the list, and back again', async () => {
  const keep = await add(main, 'carrot')
  const a = await add(main, 'milk', { section: 'dairy' })
  const b = await add(main, 'eggs', { section: 'dairy' })
  const parent = (await db.lists.get(main))!
  const sub = await createSubList(parent, 'Saved for later')
  const subRow = (await db.lists.get(sub))!
  assert.equal(subRow.parentUid, 'default:list')
  assert.equal(subRow.kind, 'grocery')
  assert.ok(subRow.uid && !subRow.uid.startsWith('default:'), 'a sub-list is never a default: list')

  await moveItems([a, b], { listId: sub, backlog: false })
  assert.deepEqual((await db.items.where('listId').equals(sub).toArray()).map((i) => i.displayName).sort(), ['eggs', 'milk'])
  assert.equal((await db.items.get(keep))!.listId, main)

  const lists = await db.lists.toArray()
  assert.equal(subListParent(subRow, lists)?.id, main)
  assert.deepEqual(listTree(lists).map((x) => [x.list.name, x.sub]), [['My list', false], ['Saved for later', true]])

  const back = await moveItems([a, b], { listId: main, backlog: false })
  assert.equal(back.moved, 2)
  assert.equal(await db.items.where('listId').equals(sub).count(), 0)
})

test('moving onto a list that has the same ingredient merges, and Undo un-merges', async () => {
  const sub = await createSubList((await db.lists.get(main))!, 'Saved for later')
  const parked = await add(sub, 'onion', { quantity: 2 })
  const parkedRow = (await db.items.get(parked))!
  // Devon added a recipe meanwhile, which put onions on the main list again.
  const fresh = await add(main, 'yellow onion', { quantity: 1, canonicalKey: 'onion' })
  await db.items.update(fresh, { checked: true })

  const r = await moveItems([parked], { listId: main, backlog: false })
  assert.equal(r.merged, 1)
  assert.equal(r.moved, 0)
  const rows = await db.items.where('listId').equals(main).toArray()
  assert.equal(rows.length, 1, 'no duplicate row')
  assert.equal(rows[0].quantity, 3)
  assert.equal(rows[0].checked, false)
  assert.equal(await db.items.get(parked), undefined)

  await r.undo()
  const restored = (await db.items.get(parked))!
  assert.equal(restored.uid, parkedRow.uid, 'undo puts the same row back')
  assert.equal(restored.listId, sub)
  assert.equal(restored.quantity, 2)
  const target = (await db.items.get(fresh))!
  assert.equal(target.quantity, 1)
  assert.equal(target.checked, true)
})

test('a merge keeps the packs right (mergedPacks), the same as an add', async () => {
  const sub = await createSubList((await db.lists.get(main))!, 'Later')
  const pack = { quantity: 1, unit: 'can', buyCount: 1, sizeAmount: 15, sizeUnit: 'oz', packaging: 'can', section: 'pantry' }
  const parked = await add(sub, 'black beans', pack)
  await add(main, 'black beans', pack)
  await moveItems([parked], { listId: main, backlog: false })
  const [row] = await db.items.where('listId').equals(main).toArray()
  assert.equal(row.quantity, 2)
  assert.equal(row.buyCount, 2)
})

test('Undo puts plain moves back where each came from', async () => {
  const a = await add(main, 'milk', { section: 'dairy' })
  const b = await add(main, 'bread', { section: 'bakery' })
  await moveItems([b], { listId: main, backlog: true })
  await db.items.update(a, { checked: true })
  const r = await moveItems([a, b], { listId: main, backlog: true })
  assert.equal(r.moved, 1, 'a row already there is skipped')
  await r.undo()
  const ra = (await db.items.get(a))!
  assert.equal(ra.backlog, false)
  assert.equal(ra.checked, true)
  assert.equal((await db.items.get(b))!.backlog, true)
})

test('two parked rows for the same thing both land on one line', async () => {
  const sub = await createSubList((await db.lists.get(main))!, 'Later')
  const one = await add(sub, 'garlic', { quantity: 2, unit: 'clove' })
  const two = await add(sub, 'garlic', { quantity: 3, unit: 'clove', backlog: true })
  await moveItems([one, two], { listId: main, backlog: false })
  const rows = await db.items.where('listId').equals(main).toArray()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].quantity, 5)
})

test('never moves into another kind of list', async () => {
  const tasks = await db.lists.add({ name: 'Chores', kind: 'tasks', createdAt: 2 })
  const id = await add(main, 'milk')
  const r = await moveItems([id], { listId: tasks, backlog: false })
  assert.equal(r.moved + r.merged, 0)
  assert.equal((await db.items.get(id))!.listId, main)
})

test('a sub-list of a sub-list hangs under the top list, and an orphan stands alone', async () => {
  const parent = (await db.lists.get(main))!
  const sub = (await db.lists.get(await createSubList(parent, 'A')))!
  const lists = await db.lists.toArray()
  assert.equal(subListRoot(sub, lists).id, main)
  assert.equal(subListRoot(parent, lists).id, main)

  const orphan = (await db.lists.get(await db.lists.add({ name: 'B', kind: 'grocery', createdAt: 3, parentUid: 'gone' })))!
  assert.equal(subListParent(orphan, await db.lists.toArray()), undefined)
  // A pantry is never a grocery list's parent.
  const pantry = await db.lists.add({ name: 'Pantry', kind: 'pantry', createdAt: 4, uid: 'default:pantry' })
  const odd = (await db.lists.get(await db.lists.add({ name: 'C', kind: 'grocery', createdAt: 5, parentUid: 'default:pantry' })))!
  assert.ok(pantry)
  assert.equal(subListParent(odd, await db.lists.toArray()), undefined)
})

test('an undone sub-list that is empty goes; one with rows stays', async () => {
  const parent = (await db.lists.get(main))!
  const empty = await createSubList(parent, 'Empty')
  await dropIfEmpty(empty)
  assert.equal(await db.lists.get(empty), undefined)
  const full = await createSubList(parent, 'Full')
  await add(full, 'salt', { section: 'baking' })
  await dropIfEmpty(full)
  assert.ok(await db.lists.get(full))
})

test('a sub-list whose parent was folded follows it to the shared list', async () => {
  const legacy = await db.lists.add({ name: 'My list', kind: 'grocery', createdAt: 0, uid: 'old-random' })
  const sub = (await db.lists.get(await createSubList((await db.lists.get(legacy))!, 'Later')))!
  await db.lists.update(legacy, { foldedInto: 'default:list', name: 'My list (moved)' })
  const lists = await db.lists.toArray()
  assert.equal(subListParent(sub, lists)?.id, main)
  assert.deepEqual(listTree(lists).map((x) => [x.list.name, x.sub]).filter(([n]) => n !== 'My list (moved)'),
    [['My list', false], ['Later', true]])
})
