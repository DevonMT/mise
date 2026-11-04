/**
 * Standard pack sizes and amounts (#774): the table, and the fill-gaps-only merge.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { RecipeIngredient, Section } from './db'
import {
  canStandardize,
  fillFromTable,
  lookupAmount,
  lookupPack,
  mergeEstimate,
  openGaps,
  standardizeParsed,
} from './packSizes'

const line = (
  displayName: string,
  rest: Partial<RecipeIngredient> = {},
  section: Section = 'pantry',
): RecipeIngredient => ({ displayName, canonicalKey: displayName.toLowerCase(), section, ...rest })
const pack = (l: RecipeIngredient) => [l.buyCount, l.sizeAmount, l.sizeUnit, l.packaging]

test('the table knows the standard US sizes', () => {
  const size = (name: string, unit = 'can') => {
    const p = lookupPack(line(name, { quantity: 1, unit }))
    return p && `${p.size} ${p.unit} ${p.packaging}`
  }
  assert.equal(size('Rotel tomatoes'), '10 oz can')
  assert.equal(size('Ro-Tel® Original'), '10 oz can')
  assert.equal(size('diced tomatoes and green chiles'), '10 oz can')
  assert.equal(size('Velveeta', 'block'), '32 oz block')
  assert.equal(size('black beans'), '15 oz can')
  assert.equal(size('pinto beans'), '15 oz can')
  assert.equal(size('refried beans'), '16 oz can')
  assert.equal(size('cream of mushroom soup'), '10.5 oz can')
  assert.equal(size('condensed cream of chicken soup'), '10.5 oz can')
  assert.equal(size('tomato paste'), '6 oz can')
  assert.equal(size('diced tomatoes'), '14.5 oz can')
  assert.equal(size('crushed tomatoes'), '28 oz can')
  assert.equal(size('sweetened condensed milk'), '14 oz can')
  assert.equal(size('cream cheese', 'package'), '8 oz package')
  assert.equal(size('diced green chiles'), '4 oz can')
  // The container the line names picks the size: a can of broth is not a carton.
  assert.equal(size('chicken broth'), '14.5 oz can')
  assert.equal(size('chicken broth', 'carton'), '32 oz carton')
  assert.equal(size('chicken broth', ''), '32 oz carton')
  // Things the table does not claim.
  assert.equal(size('onion', 'whole'), null)
  assert.equal(size('pumpkin pie spice', ''), null)
  assert.equal(size('tuna steaks', ''), null)
})

test('a spice or herb with no amount gets a modest estimate', () => {
  const amt = (name: string, section: Section = 'baking') => {
    const a = lookupAmount(line(name, {}, section))
    return a && `${a.quantity} ${a.unit}`
  }
  assert.equal(amt('ground cumin'), '1 tsp')
  assert.equal(amt('chili powder'), '1 tbsp')
  assert.equal(amt('cayenne pepper'), '0.25 tsp')
  assert.equal(amt('salt'), '0.5 tsp')
  assert.equal(amt('black pepper'), '0.25 tsp')
  assert.equal(amt('red pepper flakes'), '0.5 tsp')
  assert.equal(amt('crushed red pepper'), '0.5 tsp')
  assert.equal(amt('dried oregano'), '1 tsp')
  assert.equal(amt('fresh cilantro', 'produce'), '2 tbsp')
  // Not spices, whatever they share a word with.
  assert.equal(amt('jalapeño pepper', 'produce'), null)
  assert.equal(amt('red bell pepper', 'produce'), null)
  assert.equal(amt('green pepper', 'produce'), null)
  assert.equal(amt('garlic cloves', 'produce'), null)
  assert.equal(amt('pepper jack cheese', 'dairy'), null)
})

test("Devon's queso: bare Velveeta, bare cans and spices land with sizes and amounts, all flagged", () => {
  const queso = [
    line('Velveeta', {}, 'dairy'),
    line('Rotel tomatoes', { quantity: 1, unit: 'can' }),
    line('chili beans', { quantity: 2, unit: 'cans' }),
    line('ground beef', { quantity: 1, unit: 'lb' }, 'meat'),
    line('cumin', {}, 'baking'),
    line('chili powder', {}, 'baking'),
  ].map(fillFromTable)

  const [velveeta, rotel, beans, beef, cumin, chili] = queso
  assert.deepEqual(pack(velveeta), [1, 32, 'oz', 'block'])
  assert.deepEqual([velveeta.quantity, velveeta.unit, velveeta.sizeEstimated, velveeta.amountEstimated], [1, 'block', true, true])
  assert.deepEqual(pack(rotel), [1, 10, 'oz', 'can'])
  assert.equal(rotel.sizeEstimated, true)
  assert.equal(rotel.amountEstimated, undefined, 'the source said 1 can')
  assert.deepEqual(pack(beans), [2, 15, 'oz', 'can'])
  // A cooking measure is an amount, not a pack: untouched.
  assert.deepEqual(pack(beef), [undefined, undefined, undefined, undefined])
  assert.equal(beef.sizeEstimated, undefined)
  assert.deepEqual([cumin.quantity, cumin.unit, cumin.amountEstimated], [1, 'tsp', true])
  assert.deepEqual([chili.quantity, chili.unit, chili.amountEstimated], [1, 'tbsp', true])
})

test('the merge fills gaps only: a stated size or amount is never touched', () => {
  const stated = line('cream of mushroom soup', { quantity: 2, unit: 'can', buyCount: 2, sizeAmount: 22.6, sizeUnit: 'oz', packaging: 'can' })
  assert.equal(fillFromTable(stated), stated, 'same object back: nothing to fill')
  const measured = line('Velveeta', { quantity: 8, unit: 'oz' }, 'dairy')
  assert.equal(fillFromTable(measured), measured, '8 oz is an amount, not a pack')
  const cumin = line('cumin', { quantity: 2, unit: 'tsp' }, 'baking')
  assert.equal(fillFromTable(cumin), cumin)
  // Run twice, nothing moves the second time (Standardize tapped again).
  const once = fillFromTable(line('black beans', { quantity: 1, unit: 'can' }))
  assert.equal(fillFromTable(once), once)
  // The model's estimate cannot overwrite a stated value either.
  assert.equal(mergeEstimate(stated, { quantity: 9, unit: 'cup', sizeAmount: 99, sizeUnit: 'oz', buyCount: 9 }), stated)
})

test("a model's estimate fills what the table could not, and nonsense is dropped", () => {
  const harissa = line('harissa', { quantity: 1, unit: 'jar' }, 'condiments')
  assert.equal(fillFromTable(harissa), harissa, 'not in the table')
  const filled = mergeEstimate(harissa, { sizeAmount: 10, sizeUnit: 'oz', packaging: 'jar', buyCount: 1 })
  assert.deepEqual(pack(filled), [1, 10, 'oz', 'jar'])
  assert.equal(filled.sizeEstimated, true)

  const zaatar = line("za'atar", {}, 'baking')
  const amt = mergeEstimate(zaatar, { quantity: 2, unit: 'tsp' })
  assert.deepEqual([amt.quantity, amt.unit, amt.amountEstimated], [2, 'tsp', true])

  for (const bad of [
    { quantity: -1, unit: 'tsp' },
    { quantity: Number.NaN, unit: 'tsp' },
    { quantity: 1e9, unit: 'tsp' },
    { quantity: 1, unit: '<script>' },
    { sizeAmount: 10 }, // a size with no unit means nothing
    { sizeAmount: 0, sizeUnit: 'oz' },
  ]) {
    const out = mergeEstimate(line('mystery', { quantity: undefined, unit: 'jar' }), bad)
    assert.equal(out.sizeAmount, undefined, JSON.stringify(bad))
    if (bad.quantity !== undefined) assert.equal(out.quantity, undefined, JSON.stringify(bad))
  }
})

test("at parse time the table beats the model's estimated size, but never a stated one", () => {
  const guessed = line('Velveeta', { quantity: 1, unit: 'block', buyCount: 1, sizeAmount: 16, sizeUnit: 'oz', packaging: 'block', sizeEstimated: true }, 'dairy')
  assert.deepEqual(pack(standardizeParsed(guessed)), [1, 32, 'oz', 'block'])
  const stated = line('Velveeta', { quantity: 1, unit: 'block', buyCount: 1, sizeAmount: 16, sizeUnit: 'oz', packaging: 'block' }, 'dairy')
  assert.equal(standardizeParsed(stated), stated)
  // A model estimate the table has no answer for is kept.
  const harissa = line('harissa', { quantity: 1, unit: 'jar', buyCount: 1, sizeAmount: 10, sizeUnit: 'oz', packaging: 'jar', sizeEstimated: true })
  assert.deepEqual(pack(standardizeParsed(harissa)), [1, 10, 'oz', 'jar'])
})

test('openGaps names the lines left for the model', () => {
  const lines = [
    line('Velveeta', { quantity: 1, unit: 'block', buyCount: 1, sizeAmount: 32, sizeUnit: 'oz', packaging: 'block' }),
    line('harissa', { quantity: 1, unit: 'jar' }),
    line('flour', { quantity: 2, unit: 'cup' }, 'baking'),
    line("za'atar", {}, 'baking'),
    line('yellow onion', { quantity: 2, unit: 'whole' }, 'produce'),
  ]
  assert.deepEqual(openGaps(lines), [1, 3], 'onions are loose produce, not asked about')
  assert.equal(canStandardize(lines, true), true)
  assert.equal(canStandardize(lines, false), false, 'without AI only the table counts, and it has nothing here')
  assert.equal(canStandardize([line('black beans', { quantity: 1, unit: 'can' })], false), true)
})
