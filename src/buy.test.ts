/**
 * The buy layer (#811): a recipe keeps its words, the list gets the package
 * size with the least left over. Cases from the Chicken and Dumplings recipe.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { RecipeIngredient } from './db'

const { buyLine, recipeAmount, planText, soupCanToggle } = await import('./buy')

const line = (l: Partial<RecipeIngredient> & Pick<RecipeIngredient, 'displayName'>): RecipeIngredient => ({
  canonicalKey: l.displayName.toLowerCase(),
  section: 'pantry',
  ...l,
})

const plan = (l: RecipeIngredient, factor = 1) => {
  const p = buyLine(l, factor).plan
  return p ? planText(p) : null
}

test('broth measured in soup cans buys for the top of the range, least left over', () => {
  const broth = line({ displayName: 'chicken broth', quantity: 2, quantityMax: 3, unit: 'soup can' })
  // 3 soup cans = 31.5 fl oz: one 32 oz carton beats 3 broth cans (43.5).
  assert.equal(plan(broth), '32 oz carton')
  // Two soup cans with no range: 21 fl oz, and two 14.5 oz cans (29) beat a carton (32).
  assert.equal(plan(line({ displayName: 'chicken broth', quantity: 2, unit: 'soup cans' })), '2 × 14.5 oz can')
  assert.equal(recipeAmount(broth), '2 to 3 soup cans')
  assert.equal(recipeAmount(broth, 2), '4 to 6 soup cans')
})

test('condensed soup counted in cans stays in cans, and scaling picks the tighter size', () => {
  const soup = line({ displayName: 'cream of chicken soup', quantity: 2, unit: 'can', buyCount: 2, sizeAmount: 10.5, sizeUnit: 'oz', packaging: 'can' })
  assert.equal(plan(soup), '2 × 10.5 oz can')
  // ×1.5 = 31.5 oz: three small cans, exactly, beat two family cans (45.2).
  assert.equal(plan(soup, 1.5), '3 × 10.5 oz can')
  // ×2 = 42 oz: two 22.6 oz family cans (45.2) beat four small ones (42)? No:
  // four small cans are exactly 42, so they win on left over.
  assert.equal(plan(soup, 2), '4 × 10.5 oz can')
})

test('a dry good measured by the cup is bought by the box', () => {
  // 2 cups Bisquick ≈ 8.4 oz: the 20 oz box.
  assert.equal(plan(line({ displayName: 'Original Bisquick mix', quantity: 2, unit: 'cup', section: 'baking' })), '20 oz box')
  // 12 cups ≈ 50.4 oz: one 60 oz box beats a 40 + a 20 (one size per line) or two 40s.
  assert.equal(plan(line({ displayName: 'Bisquick', quantity: 12, unit: 'cups', section: 'baking' })), '60 oz box')
})

test('milk by the cup buys the smallest carton that covers it', () => {
  assert.equal(plan(line({ displayName: 'milk', quantity: 0.67, unit: 'cup', section: 'dairy' })), '32 fl oz carton')
  // 10 cups = 80 fl oz: three quarts (96) leave less than a gallon (128).
  assert.equal(plan(line({ displayName: 'milk', quantity: 10, unit: 'cups', section: 'dairy' })), '3 × 32 fl oz carton')
  // 14 cups = 112: four quarts and one gallon both make 128, so the tie goes to fewer packages.
  assert.equal(plan(line({ displayName: 'milk', quantity: 14, unit: 'cups', section: 'dairy' })), '128 fl oz jug')
})

test('the Soup Can chip rereads a liquid counted in cans, and back', () => {
  const broth = line({ displayName: 'chicken broth', quantity: 2, quantityMax: 3, unit: 'can' })
  // As its own cans: 3 × 14.5 = 43.5 oz, nothing left over.
  assert.equal(plan(broth), '3 × 14.5 oz can')
  const t = soupCanToggle(broth)
  assert.equal(t?.on, false)
  // As soup cans: 31.5 fl oz, so a 32 oz carton.
  assert.equal(plan(t!.line), '32 oz carton')
  const back = soupCanToggle(t!.line)
  assert.equal(back?.on, true)
  assert.equal(plan(back!.line), '3 × 14.5 oz can')
  // Not offered on a solid in cans, or on a liquid by the cup.
  assert.equal(soupCanToggle(line({ displayName: 'black beans', quantity: 2, unit: 'can' })), null)
  assert.equal(soupCanToggle(line({ displayName: 'cream of chicken soup', quantity: 2, unit: 'can' })), null)
  assert.equal(soupCanToggle(line({ displayName: 'milk', quantity: 1, unit: 'cup', section: 'dairy' })), null)
})

test('a product the table does not know is left for Refine; loose meat is left alone', () => {
  assert.equal(buyLine(line({ displayName: 'harissa', quantity: 2, unit: 'tbsp', section: 'condiments' })).open, 'refine')
  const chicken = buyLine(line({ displayName: 'boneless skinless chicken breasts', quantity: 1.5, unit: 'lb', section: 'meat' }))
  assert.equal(chicken.plan, null)
  assert.equal(chicken.open, undefined)
  // A spice with no amount has nothing to size.
  assert.equal(buyLine(line({ displayName: 'harissa', section: 'condiments' })).open, undefined)
})

test("a line's own pack still scales when the table has nothing", () => {
  const harissa = line({ displayName: 'harissa', quantity: 1, unit: 'jar', buyCount: 1, sizeAmount: 10, sizeUnit: 'oz', packaging: 'jar', section: 'condiments' })
  assert.equal(plan(harissa, 2), '2 × 10 oz jar')
  assert.equal(plan(harissa, 0.5), '10 oz jar')
})

test('a chosen size overrides the pick', () => {
  const broth = line({ displayName: 'chicken broth', quantity: 2, quantityMax: 3, unit: 'soup can' })
  const p = buyLine(broth, 1, { size: 14.5, unit: 'oz', packaging: 'can' }).plan
  assert.equal(p && planText(p), '3 × 14.5 oz can')
})

test('review fixes: a stated size beats the table, an upside-down range, a zero factor', () => {
  // "2 (10 oz) cans broth": the recipe said 10 oz, so not the table's 14.5.
  const stated = line({ displayName: 'chicken broth', quantity: 2, unit: 'can', buyCount: 2, sizeAmount: 10, sizeUnit: 'oz', packaging: 'can' })
  assert.equal(plan(stated), '2 × 10 oz can')
  assert.ok(buyLine(stated).sizes.some((s) => s.size === 10))
  // An estimated size (Mise's own) still yields to the least-left-over pick.
  assert.equal(plan({ ...stated, sizeEstimated: true }), '2 × 14.5 oz can')
  // A range that arrived upside down never buys below the recipe's amount.
  assert.equal(plan(line({ displayName: 'milk', quantity: 6, quantityMax: 1, unit: 'cups', section: 'dairy' })), '64 fl oz carton')
  assert.equal(buyLine(line({ displayName: 'milk', quantity: 1, unit: 'cup', section: 'dairy' }), 0).plan, null)
})

test('wet goods by the cup and counted things get a package (recipe pass, #811)', () => {
  assert.equal(plan(line({ displayName: 'shredded cheddar cheese', quantity: 3, unit: 'cup', section: 'dairy' })), '16 oz bag')
  assert.equal(plan(line({ displayName: 'salsa', quantity: 0.5, unit: 'cup', section: 'condiments' })), '16 oz jar')
  assert.equal(plan(line({ displayName: 'sour cream', quantity: 0.5, unit: 'cup', section: 'dairy' })), '8 oz tub')
  assert.equal(plan(line({ displayName: 'eggs', quantity: 2, unit: 'whole', section: 'dairy' })), '12 ct carton')
  assert.equal(plan(line({ displayName: 'flour tortillas', quantity: 10, section: 'bakery' })), '10 ct pack')
  assert.equal(plan(line({ displayName: 'eggs', quantity: 14, section: 'dairy' })), '18 ct carton')
})
