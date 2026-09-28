/**
 * Editing, searching and cooking a recipe: the three pure rules underneath.
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

const { splitSteps } = await import('./CookMode')
const { matchesRecipe } = await import('./RecipesView')
const { fromRow, toRow } = await import('./RecipeEditor')

test('numbered lines become steps without their numbers', () => {
  assert.deepEqual(splitSteps('1. Heat oven to 400°F.\n2. Cook chicken.\n\n3. Bake.'),
    ['Heat oven to 400°F.', 'Cook chicken.', 'Bake.'])
})

test('one paragraph with inline numbers still splits', () => {
  assert.deepEqual(splitSteps('1. Brown the beef. 2. Add beans and simmer 5 minutes. 3. Serve.'),
    ['Brown the beef.', 'Add beans and simmer 5 minutes.', 'Serve.'])
})

test('a temperature or a quantity is not mistaken for a step number', () => {
  assert.deepEqual(splitSteps('Bake at 350 for 20 minutes, then rest 5 minutes.'),
    ['Bake at 350 for 20 minutes, then rest 5 minutes.'])
})

test('no instructions, no steps', () => {
  assert.deepEqual(splitSteps(undefined), [])
  assert.deepEqual(splitSteps('   '), [])
})

const enchiladas = {
  title: 'Creamy Green Chile Chicken Enchiladas',
  ingredients: [{ displayName: 'shredded Monterey Jack cheese' }, { displayName: 'flour tortillas' }],
} as never

test('search finds a recipe by an ingredient, any case, every word', () => {
  assert.equal(matchesRecipe(enchiladas, 'jack'), true)
  assert.equal(matchesRecipe(enchiladas, 'CHICKEN tortillas'), true)
  assert.equal(matchesRecipe(enchiladas, 'chicken beef'), false, 'every word must match')
  assert.equal(matchesRecipe(enchiladas, ''), true, 'empty search shows everything')
})

test('search ignores accents both ways', () => {
  const r = { title: 'Jalapeño poppers', ingredients: [] } as never
  assert.equal(matchesRecipe(r, 'jalapeno'), true)
  assert.equal(matchesRecipe({ title: 'Jalapeno dip', ingredients: [] } as never, 'jalapeño'), true)
})

const chicken = { displayName: 'boneless skinless chicken breasts', canonicalKey: 'chicken breast',
                  quantity: 1, unit: 'lb', section: 'meat' as const }

test('an untouched ingredient keeps its broader merge key', () => {
  const out = fromRow(toRow(chicken))
  assert.equal(out?.canonicalKey, 'chicken breast', 'so it still merges with other recipes\' chicken')
})

test('a renamed ingredient gets a new merge key', () => {
  const row = { ...toRow({ ...chicken, displayName: 'shredded 3 pepper blend cheese', canonicalKey: 'shredded cheese' }),
                displayName: 'Monterey Jack cheese' }
  assert.notEqual(fromRow(row)?.canonicalKey, 'shredded cheese')
})

test('amount text is parsed, blank or junk means none, and an empty row is dropped', () => {
  assert.equal(fromRow({ ...toRow(chicken), qtyText: '1,5' })?.quantity, 1.5)
  assert.equal(fromRow({ ...toRow(chicken), qtyText: '' })?.quantity, undefined)
  assert.equal(fromRow({ ...toRow(chicken), qtyText: 'some' })?.quantity, undefined)
  assert.equal(fromRow({ ...toRow(chicken), displayName: '   ' }), null)
})

test('the pack to buy survives an edit', () => {
  const beans = { displayName: 'black beans', canonicalKey: 'black beans', quantity: 1, unit: 'can',
                  section: 'pantry' as const, buyCount: 1, sizeAmount: 15, sizeUnit: 'oz', packaging: 'can' }
  const out = fromRow({ ...toRow(beans), qtyText: '2' })
  assert.deepEqual([out?.buyCount, out?.sizeAmount, out?.packaging], [1, 15, 'can'])
})
