/**
 * Refine size fit (#704): how each size compares to the amount a line asks for.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitOptions, type NeedLine, type SizeOption } from './fit'

const sz = (sizeAmount: number | null, sizeUnit: string | null, packaging: string | null = null): SizeOption => ({
  sizeAmount, sizeUnit, packaging,
})
const texts = (need: NeedLine, opts: SizeOption[]) => fitOptions(need, opts).map((f) => f?.text ?? null)
const bestOf = (need: NeedLine, opts: SizeOption[]) => fitOptions(need, opts).findIndex((f) => f?.best)

test('volume: cups against fl oz, pint and quart', () => {
  const need = { quantity: 0.5, unit: 'cup' }
  assert.deepEqual(texts(need, [sz(8, 'fl oz'), sz(4, 'fl oz'), sz(3, 'fl oz'), sz(1, 'pint'), sz(1, 'quart')]), [
    '+0.5 cup over',
    'exact',
    '0.13 cup short',
    '+1.5 cups over',
    '+3.5 cups over',
  ])
  assert.equal(bestOf(need, [sz(1, 'quart'), sz(1, 'pint'), sz(8, 'fl oz'), sz(4, 'fl oz')]), 3)
  assert.equal(bestOf({ quantity: 2, unit: 'cups' }, [sz(1, 'quart'), sz(1, 'pint')]), 1)
})

test('volume: metric against US, tbsp against cup', () => {
  assert.deepEqual(texts({ quantity: 1, unit: 'cup' }, [sz(250, 'ml'), sz(1, 'L'), sz(16, 'tbsp')]), [
    '+0.06 cup over',
    '+3.23 cups over',
    'exact',
  ])
})

test('weight: oz, lb and grams', () => {
  const need = { quantity: 1, unit: 'lb' }
  assert.deepEqual(texts(need, [sz(16, 'oz'), sz(12, 'oz'), sz(24, 'oz'), sz(454, 'g'), sz(1, 'kg')]), [
    'exact',
    '0.25 lb short',
    '+0.5 lb over',
    'exact',
    '+1.2 lb over',
  ])
  assert.deepEqual(texts({ quantity: 8, unit: 'oz' }, [sz(1, 'lb', 'bag'), sz(5, 'oz')]), ['+8 oz over', '3 oz short'])
})

test('count: bare numbers, ct, dozen', () => {
  const need = { quantity: 3, unit: undefined }
  assert.deepEqual(texts(need, [sz(12, 'ct'), sz(6, 'ct'), sz(3, 'ct'), sz(2, 'count')]), [
    '+9 over',
    '+3 over',
    'exact',
    '1 short',
  ])
  assert.equal(bestOf(need, [sz(12, 'ct'), sz(6, 'ct'), sz(3, 'ct')]), 2)
  // A self-describing dozen and "whole" onions count the same way.
  assert.deepEqual(texts({ quantity: 10, unit: 'whole' }, [sz(null, null, 'dozen'), sz(null, null, 'each')]), [
    '+2 over',
    '9 short',
  ])
  assert.deepEqual(texts({ quantity: 2, unit: 'lb' }, [sz(null, null, 'lb')]), ['1 lb short'])
})

test('best fit is the tightest size that covers', () => {
  const need = { quantity: 20, unit: 'oz' }
  const opts = [sz(16, 'oz'), sz(32, 'oz'), sz(24, 'oz'), sz(48, 'oz')]
  assert.equal(bestOf(need, opts), 2)
  const fits = fitOptions(need, opts)
  assert.equal(fits.filter((f) => f?.best).length, 1)
  assert.equal(fits[2]?.packs, undefined)
})

test('when nothing covers, mark the closest and say how many', () => {
  const need = { quantity: 40, unit: 'oz' }
  const fits = fitOptions(need, [sz(12, 'oz'), sz(16, 'oz'), sz(15, 'oz')])
  assert.equal(fits.findIndex((f) => f?.best), 1)
  assert.equal(fits[1]?.packsText, '3 × covers it')
  assert.equal(fits[0]?.packsText, undefined)
  assert.equal(fits[1]?.covers, false)
})

test('incomparable units show nothing', () => {
  // volume vs weight is never guessed, and "oz" alone is weight, not fluid
  assert.deepEqual(texts({ quantity: 1, unit: 'cup' }, [sz(16, 'oz'), sz(500, 'g'), sz(16, 'fl oz')]), [
    null,
    null,
    '+1 cup over',
  ])
  assert.deepEqual(texts({ quantity: 8, unit: 'fl oz' }, [sz(8, 'oz')]), [null])
  // count vs measure, unknown units, packaging with no size
  assert.deepEqual(texts({ quantity: 2, unit: 'cup' }, [sz(12, 'ct'), sz(2, 'bunch'), sz(null, null, 'jar')]), [
    null,
    null,
    null,
  ])
  assert.deepEqual(texts({ quantity: 3, unit: 'clove' }, [sz(1, 'oz')]), [null])
  assert.equal(bestOf({ quantity: 1, unit: 'cup' }, [sz(16, 'oz')]), -1)
  // a size with an amount but no unit, or the reverse, is not compared
  assert.deepEqual(texts({ quantity: 1, unit: 'lb' }, [sz(16, null), sz(null, 'oz')]), [null, null])
})

test('no requested amount shows nothing', () => {
  const opts = [sz(16, 'oz'), sz(32, 'oz')]
  assert.deepEqual(texts({}, opts), [null, null])
  assert.deepEqual(texts({ quantity: undefined, unit: 'oz' }, opts), [null, null])
  assert.deepEqual(texts({ quantity: 0, unit: 'oz' }, opts), [null, null])
  assert.deepEqual(texts({ quantity: null, unit: null }, opts), [null, null])
  assert.deepEqual(fitOptions({ quantity: 1, unit: 'oz' }, []), [])
})

test('incomparable options do not take the best mark from comparable ones', () => {
  const fits = fitOptions({ quantity: 1, unit: 'lb' }, [sz(1, 'cup'), sz(24, 'oz'), sz(16, 'oz')])
  assert.equal(fits[0], null)
  assert.equal(fits[1]?.best, false)
  assert.equal(fits[2]?.best, true)
})

const opt = (
  sizeAmount: number,
  sizeUnit: string,
  packaging: string,
  label: string,
  section: string,
): SizeOption => ({ sizeAmount, sizeUnit, packaging, label, section })

test('a bare oz on liquid packaging reads as fluid, marked as an estimate', () => {
  const cream = { quantity: 1.5, unit: 'cup', displayName: 'heavy cream' }
  const big = opt(16, 'oz', 'carton', 'Heavy cream, 16 oz carton', 'dairy')
  const small = opt(8, 'oz', 'carton', 'Heavy cream, 8 oz carton', 'dairy')
  const fits = fitOptions(cream, [big, small])
  assert.equal(fits[0]?.text, '≈ +0.5 cup over')
  assert.equal(fits[0]?.best, true)
  assert.equal(fits[0]?.estimate, true)
  assert.equal(fits[1]?.text, '≈ 0.5 cup short')
  // Nothing covers: the closest says how many it would take.
  const only = fitOptions(cream, [small, opt(4, 'oz', 'carton', 'Heavy cream, 4 oz carton', 'dairy')])
  assert.equal(only[0]?.best, true)
  assert.equal(only[0]?.packsText, '2 × covers it')
  // A real "fl oz" is not an estimate.
  const real = fitOptions(cream, [opt(16, 'fl oz', 'carton', 'Heavy cream', 'dairy')])
  assert.equal(real[0]?.text, '+0.5 cup over')
  assert.equal(real[0]?.estimate, undefined)
})

test('a dairy or beverage name that says liquid reads a bare oz as fluid', () => {
  const need = { quantity: 1, unit: 'cup', displayName: 'milk' }
  assert.equal(fitOptions(need, [opt(16, 'oz', 'tub', 'Whole milk, 16 oz', 'dairy')])[0], null)
  assert.equal(fitOptions(need, [opt(16, 'oz', '', 'Whole milk, 16 oz', 'dairy')])[0]?.text, '≈ +1 cup over')
  assert.equal(fitOptions(need, [opt(16, 'oz', 'pouch', 'Oat milk, 16 oz', 'pantry')])[0], null)
  assert.equal(fitOptions({ quantity: 1, unit: 'cup', displayName: 'beef stock' }, [opt(32, 'oz', '', 'Beef stock, 32 oz', 'beverages')])[0]?.text, '≈ +3 cups over')
})

test('a bare oz stays weight on solids, cans and cream that is not liquid', () => {
  const cheese = { quantity: 2, unit: 'cup', displayName: 'shredded cheese' }
  assert.equal(fitOptions(cheese, [opt(8, 'oz', 'bag', 'Shredded cheddar, 8 oz bag', 'dairy')])[0], null)
  const salsa = { quantity: 1, unit: 'cup', displayName: 'salsa' }
  assert.equal(fitOptions(salsa, [opt(16, 'oz', 'jar', 'Salsa, 16 oz jar', 'condiments')])[0], null)
  const broth = { quantity: 1, unit: 'cup', displayName: 'chicken broth' }
  assert.equal(fitOptions(broth, [opt(14, 'oz', 'can', 'Chicken broth, 14 oz can', 'dairy')])[0], null)
  const sour = { quantity: 1, unit: 'cup', displayName: 'sour cream' }
  assert.equal(fitOptions(sour, [opt(16, 'oz', '', 'Sour cream, 16 oz', 'dairy')])[0], null)
  assert.equal(fitOptions({ quantity: 8, unit: 'cup', displayName: 'cream cheese' }, [opt(8, 'oz', '', 'Cream cheese, 8 oz', 'dairy')])[0], null)
  // A weight need against a bare oz is untouched by the fluid reading.
  const w = fitOptions({ quantity: 8, unit: 'oz', displayName: 'cream' }, [opt(16, 'oz', 'carton', 'Cream', 'dairy')])
  assert.equal(w[0]?.text, '+8 oz over')
})

test('a gap that would print as zero says exact', () => {
  assert.equal(fitOptions({ quantity: 0.5, unit: 'cup' }, [sz(4.02, 'fl oz')])[0]?.text, 'exact')
  assert.equal(fitOptions({ quantity: 0.5, unit: 'cup' }, [sz(3.98, 'fl oz')])[0]?.text, 'exact')
})
