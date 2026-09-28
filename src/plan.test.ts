/**
 * Shop the week, and the pack count a merge used to drop.
 *
 * Both are arithmetic about groceries you are about to buy, and both were
 * quietly wrong: a meal planned twice was bought once, and two recipes each
 * calling for 2 cans made a row that said 2 cans.
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
const { addItem, mergedPacks } = await import('./list')
const { shopTheWeek, timesThisWeek } = await import('./recipes')

const can15 = { buyCount: 2, sizeAmount: 15, sizeUnit: 'oz', packaging: 'can' }

// ── the merge ──────────────────────────────────────────────────────────────

test('the same pack on both sides adds up', () => {
  assert.deepEqual(mergedPacks({ quantity: 2, ...can15 }, { quantity: 2, ...can15 }, 4), { buyCount: 4 })
})

test('a line with no pack scales the chosen one, rounding up', () => {
  const creamCheese = { quantity: 8, buyCount: 1, sizeAmount: 8, sizeUnit: 'oz', packaging: 'pack' }
  assert.deepEqual(mergedPacks(creamCheese, { quantity: 8 }, 16), { buyCount: 2 })
  assert.deepEqual(mergedPacks(creamCheese, { quantity: 2 }, 10), { buyCount: 2 }, '10 oz is two 8 oz packs')
})

test('a different size keeps the chosen pack and scales it', () => {
  const big = { buyCount: 1, sizeAmount: 29, sizeUnit: 'oz', packaging: 'can' }
  assert.deepEqual(mergedPacks({ quantity: 1, ...big }, { quantity: 1, ...can15, buyCount: 1 }, 2), { buyCount: 2 })
})

test('no pack on the existing line leaves the Buy layer alone', () => {
  assert.deepEqual(mergedPacks({ quantity: 1 }, { quantity: 1, ...can15 }, 2), {})
})

test('addItem carries the pack count through a real merge', async () => {
  await db.items.clear()
  const listId = 1
  const line = { listId, displayName: 'black beans', canonicalKey: 'black beans', quantity: 2,
                 unit: 'can', section: 'pantry' as const, ...can15 }
  await addItem(line)
  const id = await addItem(line)
  const row = await db.items.get(id)
  assert.equal(row?.quantity, 4)
  assert.equal(row?.buyCount, 4, 'was 2 — the bug')
})

// ── counting the week ──────────────────────────────────────────────────────

const MON = new Date(2026, 8, 28, 9).getTime() // Monday 28 Sep 2026

test('a weekly meal counts once per day it lands on', () => {
  assert.equal(timesThisWeek({ every: 'week', days: [1, 4] }, MON), 2)
  assert.equal(timesThisWeek({ every: 'week', days: [0] }, MON), 1, 'Sunday is inside the 7 days')
})

test('a cadence meal counts its landings in the window', () => {
  const from = new Date(2026, 8, 28).getTime()
  assert.equal(timesThisWeek({ every: 'days', interval: 2, from }, MON), 4) // Mon, Wed, Fri, Sun
  const later = new Date(2026, 9, 10).getTime()
  assert.equal(timesThisWeek({ every: 'days', interval: 2, from: later }, MON), 0, 'not started yet')
})

test('no schedule is "unplaced", not "never"', () => {
  assert.equal(timesThisWeek(undefined, MON), null)
  assert.equal(timesThisWeek({ every: 'week', days: [] }, MON), null)
})

// ── shop the week ──────────────────────────────────────────────────────────

test('shop the week scales by how often, skips what is not this week, and undoes exactly', async () => {
  await db.items.clear()
  await db.recipes.clear()
  const grocery = 50
  const plan = 51
  const ing = (displayName: string, canonicalKey: string, quantity: number, unit: string, extra = {}) =>
    ({ displayName, canonicalKey, quantity, unit, section: 'pantry' as const, ...extra })

  await db.recipes.bulkAdd([
    { uid: 'chili', title: 'Chili', servings: 4, createdAt: 1,
      ingredients: [ing('black beans', 'black beans', 1, 'can', { buyCount: 1, sizeAmount: 15, sizeUnit: 'oz', packaging: 'can' }),
                    ing('ground beef', 'ground beef', 1, 'lb')] },
    { uid: 'tacos', title: 'Tacos', servings: 4, createdAt: 1,
      ingredients: [ing('ground beef', 'ground beef', 1, 'lb')] },
    { uid: 'soup', title: 'Soup', servings: 4, createdAt: 1,
      ingredients: [ing('broth', 'broth', 1, 'carton')] },
  ])
  // Already on the list before shopping: one pound of beef.
  const beefId = await addItem({ listId: grocery, displayName: 'ground beef', canonicalKey: 'ground beef',
                                 quantity: 1, unit: 'lb', section: 'meat' })
  const before = await db.items.filter((i) => i.listId === grocery).toArray()

  const entry = (recipeUid: string, schedule?: import('./db').Schedule) =>
    ({ listId: plan, displayName: recipeUid, canonicalKey: recipeUid, section: 'other' as const,
       checked: false, backlog: false, createdAt: 1, recipeUid, schedule })
  const r = await shopTheWeek([
    entry('chili', { every: 'week', days: [1, 4] }),             // twice
    entry('tacos'),                                              // unplaced: once
    entry('soup', { every: 'days', interval: 2, from: new Date(2026, 9, 10).getTime() }), // not this week
    entry('gone', { every: 'week', days: [2] }),                 // recipe deleted
  ], grocery, MON)

  assert.deepEqual({ recipes: r.recipes, meals: r.meals, notThisWeek: r.notThisWeek, missing: r.missing },
                   { recipes: 2, meals: 3, notThisWeek: 1, missing: 1 })
  const rows = await db.items.filter((i) => i.listId === grocery).toArray()
  const beans = rows.find((i) => i.canonicalKey === 'black beans')
  const beef = rows.find((i) => i.canonicalKey === 'ground beef')
  assert.equal(beans?.quantity, 2, 'chili twice')
  assert.equal(beans?.buyCount, 2, 'two cans')
  assert.equal(beef?.quantity, 4, '1 already there + chili twice + tacos once')
  assert.ok(!rows.some((i) => i.canonicalKey === 'broth'), 'soup is not this week')

  await r.undo()
  const after = await db.items.filter((i) => i.listId === grocery).toArray()
  assert.equal(after.length, before.length, 'the added lines are gone')
  assert.equal((await db.items.get(beefId))?.quantity, 1, 'the merged line is back to what it was')
})
