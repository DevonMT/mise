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
const { addRecipeToList, addSkipped, skippedMessage, shopTheWeek } = await import('./recipes')
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
  const { added, skipped } = await addRecipeToList(
    { title: 'T', servings: 2, createdAt: 1, ingredients: [
      { displayName: 'sea salt', canonicalKey: 'sea salt', section: 'pantry' },
      { displayName: 'ground cumin', canonicalKey: 'ground cumin', section: 'pantry' },
    ] }, 1, groceries)
  assert.equal(added, 1)
  assert.deepEqual(skipped, [], 'a Never Add These staple is skipped silently, not reported')
})

// A recipe like the one that started #703: sugar and vanilla are in the pantry.
const tiramisu = {
  title: 'Easy Tiramisu', servings: 4, createdAt: 1,
  ingredients: [
    { displayName: 'sugar', canonicalKey: 'sugar', quantity: 0.5, unit: 'cup', section: 'baking' as const },
    { displayName: 'vanilla', canonicalKey: 'vanilla', quantity: 1, unit: 'tsp', section: 'baking' as const },
    { displayName: 'mascarpone', canonicalKey: 'mascarpone', quantity: 8, unit: 'oz', section: 'dairy' as const },
  ],
}
const stock = (displayName: string, checked = false) =>
  db.items.add({ listId: pantry, displayName, canonicalKey: displayName.toLowerCase(), section: 'baking',
    checked, backlog: false, createdAt: 1 })
const onGroceries = async () =>
  (await db.items.filter((i) => i.listId === groceries).toArray()).map((i) => i.displayName).sort()

test('a recipe skips what the pantry has, and says what it skipped', async () => {
  await stock('Sugar')
  await stock('Vanilla')
  const { added, skipped } = await addRecipeToList(tiramisu, 2, groceries)
  assert.equal(added, 1)
  assert.deepEqual(await onGroceries(), ['mascarpone'])
  assert.deepEqual(skipped.map((s) => s.displayName), ['sugar', 'vanilla'])
  assert.equal(skipped[0].quantity, 1, 'the skipped line is already scaled')
  assert.equal(skippedMessage(skipped), 'Skipped 2 you have: sugar, vanilla')
})

test('an item marked out in the pantry is not skipped', async () => {
  await stock('Sugar', true)
  await stock('Vanilla')
  const { added, skipped } = await addRecipeToList(tiramisu, 1, groceries)
  assert.equal(added, 2)
  assert.deepEqual(await onGroceries(), ['mascarpone', 'sugar'])
  assert.deepEqual(skipped.map((s) => s.displayName), ['vanilla'])
})

test('"granulated sugar" in the pantry skips a recipe\'s "sugar", and the other way round', async () => {
  const id = await stock('Granulated sugar')
  const first = await addRecipeToList(tiramisu, 1, groceries)
  assert.deepEqual(first.skipped.map((s) => s.displayName), ['sugar'])
  await db.items.delete(id)
  await stock('Sugar')
  const flipped = await addRecipeToList(
    { ...tiramisu, ingredients: [{ displayName: 'granulated sugar', canonicalKey: 'granulated sugar', section: 'baking' as const }] },
    1, groceries)
  assert.equal(flipped.added, 0)
  assert.equal(flipped.skipped.length, 1)
})

test('look-alikes in the pantry do not skip: powdered, brown, and a list that is not a pantry', async () => {
  await stock('Powdered sugar')
  await stock('Brown sugar')
  const other = await db.lists.add({ name: 'Other', kind: 'grocery', createdAt: 2 })
  await addItem({ listId: other, displayName: 'vanilla', section: 'baking' })
  const { added, skipped } = await addRecipeToList(tiramisu, 1, groceries)
  assert.equal(added, 3)
  assert.deepEqual(skipped, [])
})

test('Add anyway puts the skipped lines on the list, scaled', async () => {
  await stock('Sugar')
  await stock('Vanilla')
  const { skipped } = await addRecipeToList(tiramisu, 2, groceries)
  assert.deepEqual(await onGroceries(), ['mascarpone'])
  assert.equal(await addSkipped(skipped), 2)
  assert.deepEqual(await onGroceries(), ['mascarpone', 'sugar', 'vanilla'])
  const sugar = await db.items.filter((i) => i.listId === groceries && i.displayName === 'sugar').first()
  assert.equal(sugar?.quantity, 1)
  assert.equal(sugar?.unit, 'cup')
})

test('the message names at most three, once each', () => {
  const line = (displayName: string) => ({ listId: 1, displayName, section: 'baking' as const })
  assert.equal(
    skippedMessage(['sugar', 'Sugar', 'vanilla', 'flour', 'eggs', 'butter'].map(line)),
    'Skipped 6 you have: sugar, vanilla, flour +2 more',
  )
})

test('the meal plan skips pantry stock too and hands back what it skipped', async () => {
  await stock('Sugar')
  const recipeUid = 'r1'
  await db.recipes.clear()
  await db.recipes.add({ ...tiramisu, uid: recipeUid })
  const entry = { id: 1, listId: 1, displayName: 'Easy Tiramisu', section: 'other' as const, checked: false,
    backlog: false, createdAt: 1, recipeUid }
  const r = await shopTheWeek([entry], groceries)
  assert.equal(r.recipes, 1)
  assert.deepEqual(r.skipped.map((s) => s.displayName), ['sugar'])
  assert.deepEqual(await onGroceries(), ['mascarpone', 'vanilla'])
})

test('an equal stored key still has to pass the guards on a list with aisles (#711)', async () => {
  // A counted pepper is the vegetable, not the jar keyed 'pepper'.
  await addItem({ listId: groceries, displayName: 'Pepper', canonicalKey: 'pepper', section: 'pantry' })
  await addItem({ listId: groceries, displayName: 'pepper', canonicalKey: 'pepper', quantity: 2, unit: '', section: 'produce' })
  assert.equal(await db.items.filter((i) => i.listId === groceries).count(), 2)
  // ...and the other way round.
  await db.items.clear()
  await addItem({ listId: groceries, displayName: 'pepper', canonicalKey: 'pepper', quantity: 2, unit: '', section: 'produce' })
  await addItem({ listId: groceries, displayName: 'Pepper', canonicalKey: 'pepper', section: 'pantry' })
  assert.equal(await db.items.filter((i) => i.listId === groceries).count(), 2)
  // A jar is still a jar, and a tsp of pepper still merges into it.
  await db.items.clear()
  await addItem({ listId: groceries, displayName: 'Pepper', canonicalKey: 'pepper', quantity: 1, unit: 'tsp', section: 'pantry' })
  await addItem({ listId: groceries, displayName: 'black pepper', canonicalKey: 'pepper', quantity: 1, unit: 'tsp', section: 'pantry' })
  const rows = await db.items.filter((i) => i.listId === groceries).toArray()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].quantity, 2)
  // A ground coriander row keyed 'coriander' is not the fresh herb.
  await db.items.clear()
  await addItem({ listId: groceries, displayName: 'ground coriander', canonicalKey: 'coriander', quantity: 1, unit: 'tsp', section: 'pantry' })
  await addItem({ listId: groceries, displayName: 'coriander', canonicalKey: 'coriander', quantity: 1, unit: 'tsp', section: 'produce' })
  assert.equal(await db.items.filter((i) => i.listId === groceries).count(), 2)
  // A tasks list is untouched: an equal key is exact there.
  const tasks = await db.lists.add({ name: 'Tasks', kind: 'tasks', createdAt: 1 })
  await addItem({ listId: tasks, displayName: 'Pepper', canonicalKey: 'pepper', section: 'other' })
  await addItem({ listId: tasks, displayName: 'pepper', canonicalKey: 'pepper', quantity: 2, unit: '', section: 'other' })
  assert.equal(await db.items.filter((i) => i.listId === tasks).count(), 1)
})

test('a staple keyed with a raw key does not skip the other thing under it (#711)', async () => {
  await db.items.add({ listId: pantry, displayName: 'Ground coriander', canonicalKey: 'coriander', section: 'pantry',
    checked: false, backlog: false, alwaysHave: true, createdAt: 1 })
  await db.items.add({ listId: pantry, displayName: 'Black pepper', canonicalKey: 'pepper', section: 'pantry',
    checked: false, backlog: false, alwaysHave: true, createdAt: 1 })
  const staples = await getStapleKeys()
  assert.ok(isStaple(staples, { displayName: 'ground coriander', canonicalKey: 'ground coriander' }))
  assert.ok(!isStaple(staples, { displayName: 'coriander', canonicalKey: 'coriander' }), 'fresh coriander is not the jar')
  assert.ok(isStaple(staples, { displayName: 'pepper', canonicalKey: 'pepper' }))
  assert.ok(!isStaple(staples, { displayName: '1 large pepper', canonicalKey: 'pepper' }), 'a counted pepper is a vegetable')
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
