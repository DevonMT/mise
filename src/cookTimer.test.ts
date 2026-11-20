import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeDuration, findDurations, formatLeft } from './cookTimer'

const one = (s: string) => findDurations(s)[0]

test('reads a plain time', () => {
  assert.partialDeepStrictEqual(one('Simmer for 10 minutes.'), { ms: 600_000, label: '10 minutes' })
  assert.equal(one('Rest 45 min.')?.ms, 45 * 60_000)
  assert.equal(one('Boil for 1 hour.')?.ms, 3_600_000)
  assert.equal(one('Wait 30 seconds.')?.ms, 30_000)
})

test('starts a range at the low end and keeps what the step said', () => {
  for (const text of ['Chill 3 to 4 hours.', 'Chill 3–4 hours.', 'Chill 3-4 hours.', 'Chill 3 or 4 hours.']) {
    const d = one(text)
    assert.equal(d.ms, 3 * 3_600_000)
    assert.equal(d.label, '3 hours')
    assert.match(d.range ?? '', /^3.*4 hours$/)
  }
  assert.equal(one('Bake 20 to 25 minutes')?.ms, 20 * 60_000)
})

test('reads fractions and compound times', () => {
  assert.equal(one('Roast 1½ hours.')?.ms, 90 * 60_000)
  assert.equal(one('Roast 1 1/2 hours.')?.ms, 90 * 60_000)
  assert.equal(one('Roast ½ hour.')?.ms, 30 * 60_000)
  assert.partialDeepStrictEqual(one('Roast 1 hour 30 minutes.'), { ms: 90 * 60_000, label: '1 hour 30 minutes' })
  assert.equal(one('Roast 1 hour and 15 min.')?.ms, 75 * 60_000)
  assert.equal(one('Let it rest half an hour.')?.ms, 30 * 60_000)
  assert.equal(one('Back in an hour.')?.ms, 60 * 60_000)
  assert.equal(one('Mix a 10-minute batch.')?.ms, 600_000)
})

test('a compound time is one timer, not two', () => {
  assert.equal(findDurations('Chill 1 hour 30 minutes.').length, 1)
  assert.equal(findDurations('Roast 1 hour and 15 min, then rest 10 minutes.').length, 2)
})

test('finds nothing where no length is named', () => {
  assert.deepEqual(findDurations('Chill overnight.'), [])
  assert.deepEqual(findDurations('Cook until golden, a few minutes.'), [])
  assert.deepEqual(findDurations('Bake at 350°F. Use 2 to 3 cups of flour, minimum 3 eggs.'), [])
})

test('ignores a technique measured in seconds', () => {
  assert.deepEqual(findDurations('Dip each ladyfinger in the coffee for 2 seconds.'), [])
})

test('keeps every different time in a step, in reading order', () => {
  const d = findDurations('Simmer 10 minutes, add the rice, then cook 20 minutes more. Rest 10 minutes.')
  assert.deepEqual(d.map((x) => x.ms), [600_000, 1_200_000])
  assert.equal(findDurations('Chill 3 to 4 hours, or overnight.').length, 1)
})

test('formats time left', () => {
  assert.equal(formatLeft(9 * 60_000 + 5_000), '9:05')
  assert.equal(formatLeft(2 * 3_600_000 + 41 * 60_000 + 10_000), '2:41:10')
  assert.equal(formatLeft(-5), '0:00')
  assert.equal(formatLeft(1), '0:01')
})

test('describes a length', () => {
  assert.equal(describeDuration(3_600_000), '1 hour')
  assert.equal(describeDuration(5_400_000), '1 hour 30 minutes')
})
