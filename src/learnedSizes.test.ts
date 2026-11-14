/**
 * Learned pack sizes (#814): a size the model estimated for a product the
 * table doesn't know is saved once and reused, so the model is not asked
 * about that product again. A stated size still wins, the table's gates
 * still hold, and the person can confirm, edit or delete a learned size.
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

const { db } = await import('./db')
const { standardizeRecipe, saveRecipeFromParse } = await import('./recipes')
const { standardizeResult } = await import('./parse')
const { fillFromTable, lookupPack, soldSizes, sizeToLearn, setLearnedSizes } = await import('./packSizes')
const { buyLine } = await import('./buy')
const L = await import('./learnedSizes')
import type { Recipe, RecipeIngredient } from './db'
import type { ParseResult } from './parse'

/** The model knows harissa comes in a 10 oz jar and a 4.5 oz tube. */
let calls: Array<{ lines: Array<{ index: number; displayName: string; unit: string | null }> }> = []
globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body))
  calls.push(body)
  const lines = body.lines.map((l: { index: number; displayName: string; unit: string | null }) =>
    /harissa/.test(l.displayName)
      ? { index: l.index, quantity: null, unit: null, buyCount: null, sizeAmount: l.unit === 'tube' ? 4.5 : 10, sizeUnit: 'oz', packaging: l.unit === 'tube' ? 'tube' : 'jar' }
      : { index: l.index, quantity: null, unit: null, buyCount: null, sizeAmount: null, sizeUnit: null, packaging: null })
  return new Response(JSON.stringify({ lines, asked: body.lines.map((l: { index: number }) => l.index) }), { status: 200 })
}) as typeof fetch

const ing = (displayName: string, rest: Partial<RecipeIngredient> = {}): RecipeIngredient =>
  ({ displayName, canonicalKey: displayName.toLowerCase(), section: 'condiments', ...rest })

const recipe = async (title: string, ingredients: RecipeIngredient[]) =>
  (await db.recipes.get(await db.recipes.add({ title, servings: 4, createdAt: 1, ingredients } as Recipe)))!

const learnedRow = () => db.catalog.where('canonicalKey').equals('harissa').first()

beforeEach(async () => {
  await db.catalog.clear()
  await db.recipes.clear()
  setLearnedSizes([])
  calls = []
})

test('a size is learned once: the next recipe that names it is filled without a model call', async () => {
  const first = await recipe('Shakshuka', [ing('harissa', { quantity: 1, unit: 'jar' })])
  await standardizeRecipe(first, true)
  assert.equal(calls.length, 1, 'the first time, the model is asked')
  const row = await learnedRow()
  assert.deepEqual(row?.learnedSizes?.map(({ size, unit, packaging, estimated }) => ({ size, unit, packaging, estimated })), [
    { size: 10, unit: 'oz', packaging: 'jar', estimated: true },
  ])
  assert.equal(row?.count, 0, 'a catalog row made only to hold the size is not an add')

  calls = []
  const second = await recipe('Harissa chicken', [ing('Harissa', { canonicalKey: 'harissa', quantity: 2, unit: 'jars' })])
  await standardizeRecipe(second, true)
  assert.equal(calls.length, 0, 'a product the catalog knows never calls the model again')
  const line = (await db.recipes.get(second.id!))!.ingredients[0]
  assert.equal(line.sizeAmount, 10)
  assert.equal(line.packaging, 'jar')
  assert.equal(line.buyCount, 2)
  assert.equal(line.sizeEstimated, true)
  // The buy math sees it too.
  assert.deepEqual(buyLine(line).plan, { buyCount: 2, sizeAmount: 10, sizeUnit: 'oz', packaging: 'jar' })
})

test('learned from a parse: saving the recipe keeps the size, and the next parse uses it over a new guess', async () => {
  const parsed: ParseResult = {
    sourceType: 'recipe', recipeTitle: 'Couscous', servings: 2, instructions: null, estimates: true,
    items: [{ displayName: 'harissa', canonicalKey: 'harissa', quantity: 1, unit: 'jar', sizeAmount: 10, sizeUnit: 'oz', packaging: 'jar', buyCount: 1, sizeEstimated: true, section: 'condiments' }],
  }
  await saveRecipeFromParse(standardizeResult(parsed))
  assert.equal((await learnedRow())?.learnedSizes?.[0].size, 10)
  // A later parse where the model guesses differently: the learned size wins.
  const again = standardizeResult({ ...parsed, recipeTitle: 'Stew', items: [{ ...parsed.items[0], sizeAmount: 7 }] })
  assert.equal(again.items[0].sizeAmount, 10)
})

test('a stated size always wins over a learned one, and is never learned', async () => {
  await L.learnSizes([ing('harissa', { quantity: 1, unit: 'jar', sizeAmount: 10, sizeUnit: 'oz', packaging: 'jar', sizeEstimated: true })])
  const stated = ing('harissa', { quantity: 1, unit: 'jar', buyCount: 1, sizeAmount: 12, sizeUnit: 'oz', packaging: 'jar' })
  assert.equal(fillFromTable(stated), stated, 'nothing filled over a stated size')
  assert.deepEqual(buyLine(stated).plan, { buyCount: 1, sizeAmount: 12, sizeUnit: 'oz', packaging: 'jar' })
  assert.equal(sizeToLearn(stated), null)
  // Nor does a stated size elsewhere replace what was learned.
  await L.learnSizes([{ ...stated, displayName: 'harissa' }])
  assert.equal((await learnedRow())?.learnedSizes?.length, 1)
  assert.equal((await learnedRow())?.learnedSizes?.[0].size, 10)
})

test('learned sizes pass the table gates: whole words, a container for produce and meat, the container named', async () => {
  await L.learnSizes([ing('harissa', { quantity: 1, unit: 'jar', sizeAmount: 10, sizeUnit: 'oz', packaging: 'jar', sizeEstimated: true })])
  // A bare count or a jar: the jar.
  assert.deepEqual(lookupPack(ing('harissa')), { size: 10, unit: 'oz', packaging: 'jar' })
  // Another product that only contains the word.
  assert.equal(lookupPack(ing('harissa chicken thighs', { section: 'meat', quantity: 1, unit: 'package' })), null)
  assert.equal(lookupPack(ing('harissa roasted carrots')), null)
  // Filed with produce or meat and counted loose: no pack, as with the table.
  assert.equal(lookupPack(ing('harissa', { section: 'produce' })), null)
  assert.equal(soldSizes(ing('harissa', { section: 'meat' })), null)
  // With a container named, a container it learned.
  assert.notEqual(lookupPack(ing('harissa', { section: 'produce', quantity: 1, unit: 'jar' })), null)
  // A container it never learned is asked about, then learned beside the jar.
  assert.equal(lookupPack(ing('harissa', { quantity: 1, unit: 'tube' })), null)
  const r = await recipe('Wings', [ing('harissa', { quantity: 1, unit: 'tube' })])
  await standardizeRecipe(r, true)
  assert.equal(calls.length, 1)
  assert.deepEqual((await learnedRow())?.learnedSizes?.map((s) => s.packaging), ['jar', 'tube'])
  assert.deepEqual(soldSizes(ing('harissa'))?.sizes.map((s) => s.size), [10, 4.5])
})

test('the table still answers first, and nothing it claims or sells loose is learned', async () => {
  // A learned row for a product the table knows (from an older table, say) is never used.
  await db.catalog.add({ canonicalKey: 'tomato paste', displayName: 'tomato paste', section: 'pantry', count: 0, favorite: false, lastAdded: 1,
    learnedSizes: [{ size: 4.5, unit: 'oz', packaging: 'can', estimated: true, at: 1 }] })
  await L.refreshLearnedSizes()
  assert.deepEqual(lookupPack(ing('tomato paste', { quantity: 1, unit: 'can' })), { size: 6, unit: 'oz', packaging: 'can' })
  // A buy-only table product ("1 egg") is not learned either.
  assert.equal(sizeToLearn(ing('egg', { quantity: 1, unit: 'carton', sizeAmount: 12, sizeUnit: 'ct', packaging: 'carton', sizeEstimated: true })), null)
  // Loose produce, and a unit the buy math can't read.
  assert.equal(sizeToLearn(ing('shallot', { section: 'produce', quantity: 1, sizeAmount: 2, sizeUnit: 'oz', packaging: 'each', sizeEstimated: true })), null)
  assert.equal(sizeToLearn(ing('ras el hanout', { quantity: 1, unit: 'jar', sizeAmount: 2, sizeUnit: 'scoops', packaging: 'jar', sizeEstimated: true })), null)
})

test('Standardize without AI uses learned sizes and asks nothing', async () => {
  await L.learnSizes([ing('harissa', { quantity: 1, unit: 'jar', sizeAmount: 10, sizeUnit: 'oz', packaging: 'jar', sizeEstimated: true })])
  setLearnedSizes([]) // a stale lookup: Standardize reloads it first
  const r = await recipe('Eggs', [ing('harissa', { quantity: 1, unit: 'jar' }), ing('preserved lemon', { quantity: 1, unit: 'jar' })])
  const out = await standardizeRecipe(r, false)
  assert.equal(calls.length, 0)
  assert.equal(out.error, undefined)
  assert.equal((await db.recipes.get(r.id!))!.ingredients[0].sizeAmount, 10)
})

test('confirm, edit and delete', async () => {
  await L.learnSizes([ing('harissa', { quantity: 1, unit: 'jar', sizeAmount: 10, sizeUnit: 'oz', packaging: 'jar', sizeEstimated: true })])
  const id = (await learnedRow())!.id!
  assert.equal(await L.confirmLearnedSize(id, 'jar'), null)
  assert.equal((await learnedRow())?.learnedSizes?.[0].estimated, undefined, 'confirmed: no longer an estimate')

  assert.equal(await L.editLearnedSize(id, 'jar', { size: 0, unit: 'oz', packaging: 'jar' }), 'Enter a size between 0 and 1000.')
  assert.equal(await L.editLearnedSize(id, 'jar', { size: 9.8, unit: 'oz', packaging: 'jar' }), null)
  const edited = (await learnedRow())?.learnedSizes?.[0]
  assert.equal(edited?.size, 9.8)
  assert.equal(edited?.estimated, undefined, 'an edit is the person’s own number')
  assert.equal(lookupPack(ing('harissa'))?.size, 9.8, 'the lookup follows the edit at once')
  // A re-learn never overwrites the edit.
  await L.learnSizes([ing('harissa', { quantity: 1, unit: 'jar', sizeAmount: 10, sizeUnit: 'oz', packaging: 'jar', sizeEstimated: true })])
  assert.equal((await learnedRow())?.learnedSizes?.[0].size, 9.8)

  assert.equal(await L.deleteLearnedSize(id, 'jar'), null)
  assert.equal((await learnedRow())?.learnedSizes, undefined)
  assert.equal(lookupPack(ing('harissa')), null)
  // Forgotten: the next recipe asks again.
  const r = await recipe('Again', [ing('harissa', { quantity: 1, unit: 'jar' })])
  await standardizeRecipe(r, true)
  assert.equal(calls.length, 1)
  assert.equal(await L.deleteLearnedSize(id, 'tube'), 'That size is gone. It may have been deleted on another device.')
})
