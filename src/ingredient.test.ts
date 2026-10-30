/**
 * Ingredient matching in use (#702): the tap-an-ingredient sheet's data and
 * actions, and the merge engine every add goes through.
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

const React = await import('react')
// tsx compiles .tsx with the classic JSX runtime, which wants React in scope.
;(globalThis as unknown as { React: unknown }).React = React
const { renderToStaticMarkup } = await import('react-dom/server')
const { db } = await import('./db')
const { addItem } = await import('./list')
const { ensurePantryList, restockFromPurchase } = await import('./lists')
const { getStapleKeys, isStaple } = await import('./parse')
const { addRecipeToList } = await import('./recipes')
const { ingredientStatus, addIngredientToList, addIngredientToPantry, statusLines } = await import('./ingredient')
const { IngredientSheetView } = await import('./IngredientSheet')

let groceries = 0
let pantry = 0

beforeEach(async () => {
  await db.items.clear()
  await db.lists.clear()
  await db.catalog.clear()
  groceries = await db.lists.add({ name: 'Groceries', kind: 'grocery', createdAt: 1 })
  pantry = await ensurePantryList()
})

const cumin = { displayName: 'ground cumin', canonicalKey: 'ground cumin', quantity: 1, unit: 'tsp', section: 'pantry' as const }

test('the same spice from two recipes lands as one line', async () => {
  await addItem({ listId: groceries, ...cumin })
  await addItem({ listId: groceries, displayName: 'cumin powder', canonicalKey: 'cumin powder', quantity: 2, unit: 'tsp', section: 'pantry' })
  await addItem({ listId: groceries, displayName: 'Cumin', quantity: 1, unit: 'teaspoon', section: 'pantry' })
  const rows = await db.items.filter((i) => i.listId === groceries).toArray()
  // 'teaspoon' is a different unit string from 'tsp', so that one stays its own line,
  // the same as before this change.
  assert.equal(rows.length, 2)
  assert.equal(rows.find((r) => r.unit === 'tsp')?.quantity, 3)
  assert.equal(rows.find((r) => r.unit === 'tsp')?.displayName, 'ground cumin', 'the first name is kept')
})

test('look-alikes stay apart on the list', async () => {
  for (const name of ['chili powder', 'chili', 'garlic powder', 'garlic', 'ground beef', 'beef']) {
    await addItem({ listId: groceries, displayName: name, section: 'pantry' })
  }
  assert.equal(await db.items.filter((i) => i.listId === groceries).count(), 6)
})

test('a tasks list keeps exact keys', async () => {
  const tasks = await db.lists.add({ name: 'Tasks', kind: 'tasks', createdAt: 1 })
  await addItem({ listId: tasks, displayName: 'Fresh paint', section: 'other' })
  await addItem({ listId: tasks, displayName: 'paint', section: 'other' })
  assert.equal(await db.items.filter((i) => i.listId === tasks).count(), 2)
})

test('old rows load and are never rewritten by matching', async () => {
  const id = await db.items.add({ listId: groceries, displayName: 'Cumin powder', canonicalKey: 'cumin powder',
    section: 'pantry', checked: false, backlog: false, createdAt: 5, updatedAt: 5 })
  const before = await db.items.get(id)
  await ingredientStatus(cumin)
  await addIngredientToList(cumin, 1, groceries)
  const after = await db.items.get(id)
  assert.equal(after?.canonicalKey, 'cumin powder')
  assert.equal(after?.displayName, 'Cumin powder')
  assert.equal(before?.createdAt, after?.createdAt)
})

test('status finds the pantry row and the list line, whatever they are called', async () => {
  await db.items.add({ listId: pantry, displayName: 'Cumin', canonicalKey: 'cumin', section: 'pantry',
    checked: false, backlog: false, createdAt: 1 })
  await addItem({ listId: groceries, displayName: 'cumin powder', quantity: 2, unit: 'tsp', section: 'pantry' })
  const st = await ingredientStatus(cumin)
  assert.equal(st.pantry.length, 1)
  assert.equal(st.onList.length, 1)
  assert.deepEqual(statusLines(cumin, st), [
    'In your pantry as “Cumin”',
    'On Groceries, 2 tsp as “cumin powder”',
  ])
})

test('status is empty for something that is not there, and ignores look-alikes', async () => {
  await addItem({ listId: groceries, displayName: 'chili powder', section: 'pantry' })
  await db.items.add({ listId: pantry, displayName: 'chili', canonicalKey: 'chili', section: 'pantry',
    checked: false, backlog: false, createdAt: 1 })
  const st = await ingredientStatus(cumin)
  assert.deepEqual([st.pantry, st.onList, st.pantryTarget, st.listTarget], [[], [], undefined, undefined])
})

test('add to shopping list merges into the matching line instead of duplicating', async () => {
  await addItem({ listId: groceries, displayName: 'cumin powder', quantity: 1, unit: 'tsp', section: 'pantry' })
  const r = await addIngredientToList(cumin, 2, groceries)
  assert.equal(r.result, 'merged')
  const rows = await db.items.filter((i) => i.listId === groceries).toArray()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].quantity, 3, 'scaled by the servings factor')
  const again = await addIngredientToList({ ...cumin, displayName: 'salt', canonicalKey: 'salt' }, 1, groceries)
  assert.equal(again.result, 'added')
})

test('add to pantry: new, already there, and back in stock', async () => {
  assert.equal((await addIngredientToPantry(cumin)).result, 'added')
  assert.equal((await addIngredientToPantry({ ...cumin, displayName: 'cumin powder', canonicalKey: 'cumin powder' })).result, 'already')
  assert.equal(await db.items.filter((i) => i.listId === pantry).count(), 1)
  const row = (await db.items.filter((i) => i.listId === pantry).first())!
  assert.equal(row.quantity, undefined, 'the pantry holds "have it", not the recipe amount')
  await db.items.update(row.id!, { checked: true })
  assert.equal((await addIngredientToPantry(cumin)).result, 'restocked')
  assert.equal((await db.items.get(row.id!))?.checked, false)
  assert.equal(await db.items.filter((i) => i.listId === pantry).count(), 1)
})

test('a staple named differently still keeps the ingredient off the list', async () => {
  await db.items.add({ listId: pantry, displayName: 'Salt', canonicalKey: 'salt', section: 'pantry',
    checked: false, backlog: false, alwaysHave: true, createdAt: 1 })
  const staples = await getStapleKeys()
  assert.ok(isStaple(staples, { displayName: 'kosher salt', canonicalKey: 'kosher salt' }))
  assert.ok(!isStaple(staples, { displayName: 'garlic salt', canonicalKey: 'garlic salt' }))
  const n = await addRecipeToList(
    { title: 'T', servings: 2, createdAt: 1, ingredients: [
      { displayName: 'sea salt', canonicalKey: 'sea salt', section: 'pantry' },
      { displayName: 'ground cumin', canonicalKey: 'ground cumin', section: 'pantry' },
    ] }, 1, groceries)
  assert.equal(n, 1)
})

test('buying "cumin powder" restocks a pantry "ground cumin" that ran out', async () => {
  const id = await db.items.add({ listId: pantry, displayName: 'Ground cumin', canonicalKey: 'ground cumin',
    section: 'pantry', checked: true, backlog: false, createdAt: 1 })
  const bought = await db.items.get(await addItem({ listId: groceries, displayName: 'cumin powder', section: 'pantry' }))
  const flipped = await restockFromPurchase([bought!])
  assert.equal(flipped.length, 1)
  assert.equal((await db.items.get(id))?.checked, false)
})

test('the sheet shows where it already is, and says it will merge', async () => {
  await db.items.add({ listId: pantry, displayName: 'Cumin', canonicalKey: 'cumin', section: 'pantry',
    checked: false, backlog: false, createdAt: 1 })
  await addItem({ listId: groceries, displayName: 'cumin powder', quantity: 2, unit: 'tsp', section: 'pantry' })
  const status = await ingredientStatus(cumin, groceries)
  const html = renderToStaticMarkup(
    React.createElement(IngredientSheetView, {
      ing: cumin, qty: '1 tsp', status, listName: 'Groceries', busy: false,
      onList: () => {}, onPantry: () => {}, onClose: () => {},
    }),
  )
  assert.match(html, /ground cumin/)
  assert.match(html, /Add to Shopping List/)
  assert.match(html, /Add to Pantry/)
  assert.match(html, /In your pantry as “Cumin”/)
  assert.match(html, /On Groceries, 2 tsp/)
  assert.match(html, /Merges with the line already on Groceries/)
  assert.match(html, /Already there, nothing changes/)
})

test('the sheet for something new says so and offers both adds', () => {
  const html = renderToStaticMarkup(
    React.createElement(IngredientSheetView, {
      ing: cumin, qty: '1 tsp', status: { pantry: [], onList: [] }, listName: 'Groceries', busy: false,
      onList: () => {}, onPantry: () => {}, onClose: () => {},
    }),
  )
  assert.match(html, /Not in your pantry or on a list yet/)
  assert.match(html, /1 tsp to Groceries/)
  assert.match(html, /Something you keep on hand/)
  assert.doesNotMatch(html, /disabled/)
})

test('the sheet marks a pantry item that is out, and a list with no grocery list', () => {
  const out = { item: { id: 1, listId: 1, displayName: 'Cumin', canonicalKey: 'cumin', section: 'pantry' as const,
    checked: true, backlog: false, createdAt: 1 }, list: { name: 'Pantry', kind: 'pantry' as const, createdAt: 1 } }
  const html = renderToStaticMarkup(
    React.createElement(IngredientSheetView, {
      ing: cumin, qty: '', status: { pantry: [out], onList: [], pantryTarget: out.item }, listName: null, busy: false,
      onList: () => {}, onPantry: () => {}, onClose: () => {},
    }),
  )
  assert.match(html, /In your pantry, marked out/)
  assert.match(html, /Marks it back in stock/)
  assert.match(html, /Make a grocery list first/)
})

test('the sheet only promises a merge the add will make', async () => {
  // Same name, different unit: the add makes a second line, so no "merges" promise.
  await addItem({ listId: groceries, displayName: 'cumin powder', quantity: 2, unit: 'tbsp', section: 'pantry' })
  const st = await ingredientStatus(cumin, groceries)
  assert.equal(st.onList.length, 1, 'it is on the list')
  assert.equal(st.listTarget, undefined, 'but not as the line this add would merge into')
  const html = renderToStaticMarkup(
    React.createElement(IngredientSheetView, {
      ing: cumin, qty: '1 tsp', status: st, listName: 'Groceries', busy: false,
      onList: () => {}, onPantry: () => {}, onClose: () => {},
    }),
  )
  assert.doesNotMatch(html, /Merges with/)
  assert.match(html, /1 tsp to Groceries/)
  assert.equal((await addIngredientToList(cumin, 1, groceries)).result, 'added')
})

test('a pantry row that carries a unit is still the pantry row', async () => {
  const flour = { displayName: 'flour', canonicalKey: 'flour', section: 'baking' as const }
  await db.items.add({ listId: pantry, displayName: 'Flour', canonicalKey: 'flour', unit: 'lb', quantity: 5,
    section: 'baking', checked: false, backlog: false, createdAt: 1 })
  const st = await ingredientStatus(flour, groceries)
  assert.ok(st.pantryTarget, 'status finds it')
  assert.equal((await addIngredientToPantry(flour)).result, 'already')
  assert.equal(await db.items.filter((i) => i.listId === pantry).count(), 1, 'no second flour')
})

test('the pantry label follows the row the action will touch', async () => {
  await db.items.add({ listId: pantry, displayName: 'Cumin', canonicalKey: 'cumin', section: 'pantry',
    checked: true, backlog: false, createdAt: 1 })
  const st = await ingredientStatus(cumin, groceries)
  const html = renderToStaticMarkup(
    React.createElement(IngredientSheetView, {
      ing: cumin, qty: '', status: st, listName: 'Groceries', busy: false,
      onList: () => {}, onPantry: () => {}, onClose: () => {},
    }),
  )
  assert.match(html, /Marks it back in stock/)
})
