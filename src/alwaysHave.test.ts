/**
 * "Always on hand": the flag that replaced the Never Add These list.
 *
 * Two skips look alike and are not. A flagged pantry item is skipped silently,
 * whether or not it is marked out. An ordinary in-stock pantry item is skipped
 * too, but REPORTED, and a marked-out one is not skipped at all. These pin the
 * three apart so the toggle can move around the UI without moving the rules.
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
const { ensurePantryList, setAlwaysHave } = await import('./lists')
const { getStapleKeys } = await import('./parse')
const { addRecipeToList } = await import('./recipes')

async function pantryRow(name: string, over: Record<string, unknown> = {}) {
  const listId = await ensurePantryList()
  const id = await db.items.add({
    listId, displayName: name, canonicalKey: name.toLowerCase(), section: 'pantry',
    checked: false, backlog: false, createdAt: 1, ...over,
  })
  return { id, listId }
}

async function groceryList() {
  return db.lists.add({ name: 'Groceries', kind: 'grocery', icon: 'cart', createdAt: 1, uid: 'g', updatedAt: 0 })
}

const recipe = (names: string[]) =>
  ({
    title: 'T', servings: 2, createdAt: 1,
    ingredients: names.map((n) => ({ displayName: n, canonicalKey: n.toLowerCase(), section: 'pantry' })),
  }) as never

test('the toggle sets and clears the flag and touches nothing else', async () => {
  const { id } = await pantryRow('Salt', { quantity: 2, unit: 'lb' })
  await setAlwaysHave(id, true)
  let row = await db.items.get(id)
  assert.equal(row?.alwaysHave, true)
  assert.equal(row?.quantity, 2)
  assert.equal(row?.checked, false)
  await setAlwaysHave(id, false)
  row = await db.items.get(id)
  assert.equal(row?.alwaysHave, false)
  assert.equal(row?.displayName, 'Salt')
})

test('a flagged item is a staple even when it is marked out', async () => {
  await db.items.clear()
  await pantryRow('Salt', { alwaysHave: true, checked: true })
  await pantryRow('Flour')
  const keys = await getStapleKeys()
  assert.ok(keys.has('salt'))
  assert.ok(!keys.has('flour'), 'in the pantry is not the same as always on hand')
})

test('recipe adds: flagged skipped silently, in-stock skipped and reported, marked out added', async () => {
  await db.items.clear()
  const grocery = await groceryList()
  await pantryRow('Salt', { alwaysHave: true })
  await pantryRow('Sugar')
  await pantryRow('Butter', { checked: true })

  const { added, skipped } = await addRecipeToList(recipe(['Salt', 'Sugar', 'Butter', 'Eggs']), 1, grocery)

  const onList = (await db.items.where('listId').equals(grocery).toArray()).map((i) => i.displayName).sort()
  assert.deepEqual(onList, ['Butter', 'Eggs'])
  assert.equal(added, 2)
  assert.deepEqual(skipped.map((s) => s.displayName), ['Sugar'], 'only the in-stock skip is reported')
})
