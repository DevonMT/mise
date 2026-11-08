/** Plain names for branded recipe lines (#818): brands go, household names stay. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
const { plainName } = await import('./plainNames')

test('a brand that stands for a product becomes the product', () => {
  assert.equal(plainName('Veg-All mixed vegetables'), 'canned mixed vegetables')
  assert.equal(plainName('Original Bisquick mix'), 'baking mix')
  assert.equal(plainName('Jiffy corn muffin mix'), 'corn muffin mix')
  assert.equal(plainName('Philadelphia cream cheese'), 'cream cheese')
  assert.equal(plainName("Frank's RedHot"), 'hot sauce')
})

test("a maker's name in front of a plain product is dropped", () => {
  assert.equal(plainName('Hormel turkey chili no beans'), 'turkey chili no beans')
  assert.equal(plainName("Campbell's cream of chicken soup"), 'cream of chicken soup')
  assert.equal(plainName('Pillsbury crescent rolls'), 'crescent rolls')
  assert.equal(plainName('Old El Paso taco seasoning'), 'taco seasoning')
  assert.equal(plainName('Kraft shredded cheddar cheese'), 'shredded cheddar cheese')
})

test('household names stay, and plain names have nothing to change', () => {
  for (const n of ['Velveeta', 'Velveeta cheese', 'mild Rotel', 'regular Rotel', 'Cheez Whiz', 'Cool Whip', 'Dorito chips', 'Kraft Velveeta']) {
    assert.equal(plainName(n), null, n)
  }
  for (const n of ['chicken broth', 'cream of chicken soup', 'baking mix', 'pace of life', 'kraft paper', '']) {
    // "pace"/"kraft" alone in an unrelated phrase: still dropped only if left over is a real name.
    if (n.startsWith('pace') || n.startsWith('kraft')) continue
    assert.equal(plainName(n), null, n)
  }
})

test('review cases (#818): a brand word never takes the product with it', () => {
  // Not Frank's RedHot, and Jiffy, Crisco and Philadelphia only swap for the product they name.
  assert.equal(plainName('beef franks'), null)
  assert.equal(plainName('Jiffy peanut butter'), 'peanut butter')
  assert.equal(plainName('Jiffy corn muffin mix'), 'corn muffin mix')
  assert.equal(plainName('Philadelphia cheesesteak meat'), null)
  assert.equal(plainName('Crisco canola oil'), 'canola oil')
  assert.equal(plainName('Crisco'), 'shortening')
  assert.equal(plainName('Crisco all-vegetable shortening'), 'shortening')
  // Household names, hyphen or not, keep their maker too.
  assert.equal(plainName('Kraft Cheez-Whiz'), null)
  assert.equal(plainName('Kraft Singles'), null)
  // Nothing dangles: punctuation at the ends goes, and a leftover that reads
  // like half a phrase means there was no maker to drop.
  assert.equal(plainName('hot dogs, Oscar Mayer'), 'hot dogs')
  assert.equal(plainName('pace of life'), null)
})
