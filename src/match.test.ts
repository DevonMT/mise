/**
 * Ingredient matching (#702): what is one thing, and what must stay two.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchKey, sameIngredient, itemKeys } from './match'

const same = (a: string, b: string) =>
  assert.equal(matchKey(a), matchKey(b), `${a} (${matchKey(a)}) should match ${b} (${matchKey(b)})`)
const apart = (a: string, b: string) =>
  assert.notEqual(matchKey(a), matchKey(b), `${a} (${matchKey(a)}) must not match ${b} (${matchKey(b)})`)

test('cumin is cumin however it is written', () => {
  for (const n of ['ground cumin', 'cumin powder', 'Cumin', 'CUMIN', 'cumin, ground', '1 tsp ground cumin',
    '½ teaspoon cumin powder', 'Ground Cumin (optional)', 'cumin powder, to taste']) {
    assert.equal(matchKey(n), 'cumin', n)
  }
})

test('plurals fold', () => {
  same('tomatoes', 'tomato')
  same('Potatoes', 'potato')
  same('cloves', 'clove')
  same('berries', 'berry')
  same('peaches', 'peach')
  same('bay leaves', 'bay leaf')
  same('cookies', 'cookie')
  same('2 cups chickpeas', 'chickpea')
  same('kiwis', 'kiwi')
  same('cheeses', 'cheese')
  assert.equal(matchKey('hummus'), 'hummus')
  assert.equal(matchKey('molasses'), 'molasses')
  assert.equal(matchKey('asparagus'), 'asparagus')
})

test('filler, prep and amounts are ignored', () => {
  same('fresh chopped basil', 'basil')
  same('2 large yellow onions, diced', 'yellow onion')
  same('1 1/2 cups shredded cheddar', 'cheddar')
  same('a pinch of salt', 'salt')
  same('3 cloves garlic, minced', 'garlic')
  same('garlic clove', 'garlic')
  same('1 (14 oz) can chickpeas', 'chickpeas')
  same('8 fl oz milk', 'milk')
  same('2 tablespoons of butter', 'butter')
})

test('salt versus sea salt: plain salts are one thing, seasoned salts are not', () => {
  for (const n of ['sea salt', 'kosher salt', 'table salt', 'flaky sea salt', 'fine sea salt', 'Salt, to taste',
    'coarse kosher salt']) {
    assert.equal(matchKey(n), 'salt', n)
  }
  apart('garlic salt', 'salt')
  apart('celery salt', 'salt')
  apart('salted butter', 'salt')
  apart('salt pork', 'salt')
})

test('no false merges: a powder or a ground form that is its own product', () => {
  apart('chili powder', 'chili')
  apart('garlic powder', 'garlic')
  apart('onion powder', 'onion')
  apart('baking powder', 'baking soda')
  apart('baking powder', 'baking')
  apart('ground beef', 'beef')
  apart('ground turkey', 'turkey')
  apart('ground pork', 'pork')
  apart('powdered sugar', 'sugar')
  apart('curry powder', 'curry')
  apart('ground ginger', 'ginger')
  apart('milk powder', 'milk')
  apart('whole milk', 'milk')
  apart('2% milk', 'milk')
  apart('bell pepper', 'black pepper')
  apart('red onion', 'onion')
  apart('chicken breast', 'chicken thigh')
  apart('cilantro', 'coriander')
  apart('cumin seed', 'cumin')
  apart('tomato paste', 'tomato')
  apart('1 can diced tomatoes', 'tomato')
  apart('dried basil', 'basil')
})

test('chili spellings agree, and chili is still not chili powder', () => {
  same('chile powder', 'chili powder')
  same('chilli powder', 'chili powder')
  apart('chili powder', 'chili pepper')
})

test('fresh ginger is ginger; ground ginger is its own jar', () => {
  same('fresh ginger', 'ginger')
  same('ginger powder', 'ground ginger')
  apart('ground ginger', 'fresh ginger')
})

test('black pepper in its usual spellings', () => {
  for (const n of ['pepper', 'ground black pepper', 'freshly ground pepper', 'black pepper', 'Freshly Ground Black Pepper']) {
    assert.equal(matchKey(n), 'black pepper', n)
  }
})

test('aliases', () => {
  same('scallions', 'green onions')
  same('spring onion', 'green onion')
  same('garbanzo beans', 'chickpeas')
  same('confectioners’ sugar', 'powdered sugar')
  same('icing sugar', 'powdered sugar')
  same('all-purpose flour', 'flour')
  same('bicarbonate of soda', 'baking soda')
  same('extra-virgin olive oil', 'olive oil')
  same('heavy whipping cream', 'heavy cream')
  same('crushed red pepper', 'red pepper flakes')
  same('ground red pepper', 'cayenne')
  same('dried oregano', 'oregano')
  same('chicken stock', 'chicken broth')
  same('Jalapeño', 'jalapeno')
  same('unsweetened cocoa', 'cocoa powder')
  same('mustard powder', 'dry mustard')
})

test('empty and amount-only names match nothing', () => {
  assert.equal(matchKey(''), '')
  assert.equal(matchKey('  '), '')
  assert.equal(matchKey('2 cups'), '')
  assert.equal(sameIngredient({ displayName: '' }, { displayName: '' }), false)
})

test('a stored row also answers to its parsed canonicalKey', () => {
  // The parser's own key is coarser than the name; either side may meet.
  const stored = { displayName: 'Yellow onions', canonicalKey: 'onion' }
  assert.ok(sameIngredient(stored, { displayName: 'onion' }))
  assert.ok(sameIngredient(stored, { displayName: 'diced onions', canonicalKey: 'onion' }))
  assert.ok(!sameIngredient(stored, { displayName: 'red onion', canonicalKey: 'red onion' }))
  // The raw key is kept, so anything that merged by canonicalKey before still does.
  assert.ok(itemKeys({ displayName: 'x', canonicalKey: 'Whatever Key ' }).has('whatever key'))
})

test('a legacy canonicalize() key still lines up with the match key', () => {
  // canonicalize() was the only normalizer before this; its output must meet
  // the new key for the same name, or old rows would stop merging.
  for (const n of ['onions', 'tomatoes', 'berries', 'carrots', 'the eggs', 'olives']) {
    assert.ok(sameIngredient({ displayName: n }, { displayName: n.toLowerCase(), canonicalKey: legacy(n) }), n)
  }
})

function legacy(name: string): string {
  let k = name.trim().toLowerCase().replace(/^(a|an|the)\s+/, '')
  if (k.endsWith('ies')) k = k.slice(0, -3) + 'y'
  else if (k.endsWith('oes')) k = k.slice(0, -2)
  else if (k.endsWith('ses')) k = k.slice(0, -2)
  else if (k.endsWith('s') && !k.endsWith('ss')) k = k.slice(0, -1)
  return k
}
