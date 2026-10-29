/**
 * Share links carry the Buy layer: a recipe that says "1 (15 oz) can" should
 * still say it after a trip through a text message.
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
  value: { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} },
})
;(globalThis as unknown as { CustomEvent: unknown }).CustomEvent = class {}

const { decodeShare, sharedPack, sharedToItem, shareRecipePayload } = await import('./share')
const { recipeText } = await import('./recipeText')
import type { Recipe } from './db'

const queso: Recipe = {
  title: 'Queso',
  servings: 8,
  createdAt: 0,
  ingredients: [
    { displayName: 'Wolf Brand Chili', canonicalKey: 'wolf brand chili', quantity: 1, unit: 'can',
      buyCount: 1, sizeAmount: 15, sizeUnit: 'oz', packaging: 'can', section: 'pantry' },
    { displayName: 'Ground cumin', canonicalKey: 'ground cumin', quantity: 1, unit: 'tsp', section: 'baking' },
  ],
}

/** What a phone does with the link: JSON over the wire, then the app's own decoder. */
async function overTheWire(payload: unknown) {
  const body = 'r.' + Buffer.from(JSON.stringify(payload)).toString('base64url')
  return decodeShare('#i=' + body)
}

test('a recipe keeps its pack through a share link', async () => {
  const back = await overTheWire(shareRecipePayload(queso))
  assert.equal(back?.t, 'recipe')
  if (back?.t !== 'recipe') return
  assert.deepEqual(sharedPack(back.ingredients[0]),
    { buyCount: 1, sizeAmount: 15, sizeUnit: 'oz', packaging: 'can' })
  // No pack set → nothing invented.
  assert.deepEqual(sharedPack(back.ingredients[1]),
    { buyCount: undefined, sizeAmount: undefined, sizeUnit: undefined, packaging: undefined })
})

test('a list item keeps its pack and refined brand', () => {
  const it = sharedToItem({ n: 'Salsa', k: 'salsa', s: 'condiments', b: 2, a: 16, z: 'oz', p: 'jar',
    t: 'Pace Chunky Medium, 16 oz jar' })
  assert.equal(it.detail, 'Pace Chunky Medium, 16 oz jar')
  assert.equal(it.buyCount, 2)
  assert.equal(it.packaging, 'jar')
})

test('an old link without pack keys still imports', async () => {
  const back = await overTheWire({ t: 'recipe', v: 1, title: 'Old', servings: 2,
    ingredients: [{ n: 'Rice', k: 'rice', q: 1, u: 'cup', s: 'pantry' }] })
  assert.equal(back?.t, 'recipe')
  if (back?.t !== 'recipe') return
  assert.equal(sharedToItem(back.ingredients[0]).buyCount, undefined)
})

test('the texted recipe names the pack and scales its count', () => {
  const text = recipeText(queso, 2)
  assert.match(text, /• 2 can Wolf Brand Chili \(2 × 15 oz can\)/)
  assert.match(text, /• 2 tsp Ground cumin$/m)
})
