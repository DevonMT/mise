/**
 * Standardize and estimated values end to end (#774 architect review): a line
 * the model has tried is not asked again, a typed list keeps no estimate, an
 * estimated amount never splits a list line, and the text marks it.
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
const { standardizeRecipe, addRecipeToList } = await import('./recipes')
const { standardizeResult } = await import('./parse')
const { canStandardize, openGaps } = await import('./packSizes')
const { recipeText } = await import('./recipeText')
import type { Recipe, RecipeIngredient } from './db'

let calls: Array<{ lines: Array<{ index: number; displayName: string }> }> = []
/** The model answers only za'atar; "oil for frying" it leaves null, as told. */
globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body))
  calls.push(body)
  const lines = body.lines.map((l: { index: number; displayName: string }) =>
    l.displayName === "za'atar"
      ? { index: l.index, quantity: 2, unit: 'tsp', buyCount: null, sizeAmount: null, sizeUnit: null, packaging: null }
      : { index: l.index, quantity: null, unit: null, buyCount: null, sizeAmount: null, sizeUnit: null, packaging: null })
  // The real server says which indexes the model saw (standardizeReply).
  return new Response(JSON.stringify({ lines, asked: body.lines.map((l: { index: number }) => l.index) }), { status: 200 })
}) as typeof fetch

const ing = (displayName: string, rest: Partial<RecipeIngredient> = {}): RecipeIngredient =>
  ({ displayName, canonicalKey: displayName.toLowerCase(), section: 'pantry', ...rest })

test('Standardize asks the model once per line; a line it left alone is not asked again', async () => {
  const id = await db.recipes.add({
    title: 'Fried things', servings: 4, createdAt: 1,
    ingredients: [ing('oil for frying'), ing("za'atar", {}), ing('lime wedges', { optional: true }, )],
  } as Recipe)
  calls = []
  const first = await standardizeRecipe((await db.recipes.get(id))!, true)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].lines.map((l) => l.displayName), ['oil for frying', "za'atar", 'lime wedges'])
  assert.equal(first.filled, 1, "only za'atar gained an amount")
  const after = (await db.recipes.get(id))!
  assert.deepEqual(after.ingredients.map((l) => l.estimateAsked), [true, true, true])
  assert.deepEqual(after.ingredients.map((l) => l.quantity), [undefined, 2, undefined])
  // Nothing left to ask: the button goes away, and a second tap spends nothing.
  assert.deepEqual(openGaps(after.ingredients), [])
  assert.equal(canStandardize(after.ingredients, true), false)
  calls = []
  const second = await standardizeRecipe(after, true)
  assert.equal(calls.length, 0)
  assert.equal(second.filled, 0)
})

test('only lines the model saw are marked: a capped send, a dropped line, a reply with no model call', async () => {
  // 70 gaps: one call sends 60, the other 10 wait for the next tap.
  const many = Array.from({ length: 70 }, (_, i) => ing(`spice ${i}`))
  const id = await db.recipes.add({ title: 'Big', servings: 1, createdAt: 1, ingredients: many } as Recipe)
  calls = []
  await standardizeRecipe((await db.recipes.get(id))!, true)
  assert.equal(calls[0].lines.length, 60)
  let rows = (await db.recipes.get(id))!.ingredients
  assert.equal(rows.filter((l) => l.estimateAsked).length, 60)
  assert.deepEqual(openGaps(rows), Array.from({ length: 10 }, (_, i) => 60 + i))

  // The server kept only some lines (it drops malformed ones): only those are marked.
  const ok = globalThis.fetch
  globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
    const b = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ lines: [], asked: [b.lines[0].index] }), { status: 200 })
  }) as typeof fetch
  const id2 = await db.recipes.add({ title: 'Two', servings: 1, createdAt: 1, ingredients: [ing('a'), ing('b')] } as Recipe)
  await standardizeRecipe((await db.recipes.get(id2))!, true)
  rows = (await db.recipes.get(id2))!.ingredients
  assert.deepEqual(rows.map((l) => l.estimateAsked), [true, undefined])

  // No model call at all ({lines: [], asked: []}): nothing is marked.
  globalThis.fetch = (async () => new Response(JSON.stringify({ lines: [], asked: [] }), { status: 200 })) as typeof fetch
  const id3 = await db.recipes.add({ title: 'None', servings: 1, createdAt: 1, ingredients: [ing('c')] } as Recipe)
  await standardizeRecipe((await db.recipes.get(id3))!, true)
  assert.equal((await db.recipes.get(id3))!.ingredients[0].estimateAsked, undefined)
  globalThis.fetch = ok
})

test('a failed model call marks nothing, so the next tap can try again', async () => {
  const id = await db.recipes.add({ title: 'Retry', servings: 2, createdAt: 1, ingredients: [ing('harissa', { quantity: 1, unit: 'jar' })] } as Recipe)
  const ok = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'Mise couldn’t fill in those sizes just now.' }), { status: 502 })) as typeof fetch
  const r = await standardizeRecipe((await db.recipes.get(id))!, true)
  globalThis.fetch = ok
  assert.match(r.error ?? '', /couldn’t fill/)
  assert.equal((await db.recipes.get(id))!.ingredients[0].estimateAsked, undefined)
})

test('a recipe parsed with estimates is marked tried; a typed list keeps no estimated value', () => {
  const item = (displayName: string, over: Record<string, unknown>) => ({
    displayName, canonicalKey: displayName, quantity: null, unit: null, buyCount: null, sizeAmount: null,
    sizeUnit: null, packaging: null, section: 'pantry' as const, ...over,
  })
  const recipe = standardizeResult({
    sourceType: 'recipe', recipeTitle: 'R', servings: 2, instructions: null, estimates: true,
    items: [item('oil for frying', {})],
  })
  assert.equal(recipe.items[0].estimateAsked, true)
  // A server from before #774 ignores the request and does not say it asked:
  // nothing is marked, so Standardize still offers to fill these.
  const old = standardizeResult({
    sourceType: 'recipe', recipeTitle: 'R', servings: 2, instructions: null,
    items: [item('oil for frying', {})],
  })
  assert.equal(old.items[0].estimateAsked, undefined)

  const list = standardizeResult({
    sourceType: 'list', recipeTitle: null, servings: null, instructions: null,
    items: [
      item('harissa', { quantity: 1, unit: 'jar', buyCount: 1, sizeAmount: 10, sizeUnit: 'oz', packaging: 'jar', sizeEstimated: true }),
      item('cumin', { quantity: 1, unit: 'tsp', amountEstimated: true }),
      item('beans', { quantity: 2, unit: 'can', buyCount: 2, sizeAmount: 15.5, sizeUnit: 'oz', packaging: 'can' }),
    ],
  })
  const [harissa, cumin, beans] = list.items
  assert.deepEqual([harissa.quantity, harissa.unit, harissa.sizeAmount, harissa.packaging, harissa.sizeEstimated], [1, 'jar', null, null, false])
  assert.deepEqual([cumin.quantity, cumin.unit, cumin.amountEstimated], [null, null, false])
  assert.deepEqual([beans.quantity, beans.sizeAmount], [2, 15.5], 'a stated size on a list stays')
})

test('an estimated amount does not split a list line: bare cumin merges with the cumin already there', async () => {
  const listId = await db.lists.add({ name: 'Groceries', kind: 'grocery', icon: 'cart', createdAt: 1, uid: 'g-std', updatedAt: 0 })
  await db.items.add({ listId, displayName: 'cumin', canonicalKey: 'cumin', section: 'baking', checked: false, backlog: false, createdAt: 1 })
  const recipe = {
    title: 'Chili', servings: 4, createdAt: 1,
    ingredients: [
      ing('cumin', { quantity: 1, unit: 'tsp', amountEstimated: true, section: 'baking' }),
      ing('Velveeta', { quantity: 1, unit: 'block', amountEstimated: true, buyCount: 1, sizeAmount: 32, sizeUnit: 'oz', packaging: 'block', sizeEstimated: true, section: 'dairy' }),
    ],
  } as Recipe
  await addRecipeToList(recipe, 2, listId)
  const rows = await db.items.where('listId').equals(listId).toArray()
  assert.equal(rows.filter((r) => r.canonicalKey === 'cumin').length, 1, 'merged, not a second cumin')
  const velveeta = rows.find((r) => r.canonicalKey === 'velveeta')!
  assert.deepEqual([velveeta.quantity, velveeta.unit, velveeta.buyCount, velveeta.sizeAmount], [undefined, undefined, 2, 32], 'the pack still goes, scaled')
})

test('the recipe text marks an estimated amount with ≈, as the screen does', () => {
  const text = recipeText({
    title: 'Queso', servings: 4, createdAt: 1,
    ingredients: [ing('cumin', { quantity: 1, unit: 'tsp', amountEstimated: true }), ing('ground beef', { quantity: 1, unit: 'lb' })],
  } as Recipe)
  assert.match(text, /• ≈ 1 tsp cumin/)
  assert.match(text, /• 1 lb ground beef/)
})

test('a buy-only rule never writes a pack onto a recipe line (#811)', async () => {
  const { fillFromTable } = await import('./packSizes')
  const egg = { displayName: 'egg', canonicalKey: 'egg', quantity: 1, unit: 'whole', section: 'dairy' as const }
  assert.equal(fillFromTable(egg), egg)
})
