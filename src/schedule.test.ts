/**
 * The scheduling rules. "Every other day" is the case worth testing: it has no
 * weekday of its own, walks through the week, and is anchored — so an off-by-one
 * in the anchor puts every session on the wrong day and looks like the app
 * simply lost the setting.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeSchedule, fallsOn, startOfDay } from './list'
import type { Schedule } from './db'

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 9, 0, 0).getTime()

test('a weekly schedule lands on its days and no others', () => {
  const s: Schedule = { every: 'week', days: [1, 4] } // Mon, Thu
  assert.equal(fallsOn(s, day(2026, 9, 7)), true, 'Monday')
  assert.equal(fallsOn(s, day(2026, 9, 10)), true, 'Thursday')
  assert.equal(fallsOn(s, day(2026, 9, 8)), false, 'Tuesday')
  assert.equal(fallsOn(s, day(2026, 9, 13)), false, 'Sunday')
})

test('a weekly schedule does not drift across weeks', () => {
  const s: Schedule = { every: 'week', days: [1] }
  assert.equal(fallsOn(s, day(2026, 9, 7)), true)
  assert.equal(fallsOn(s, day(2026, 9, 14)), true, 'the Monday after')
  assert.equal(fallsOn(s, day(2026, 9, 21)), true, 'and the one after that')
})

test('every other day alternates from its anchor', () => {
  const from = startOfDay(day(2026, 9, 7))
  const s: Schedule = { every: 'days', interval: 2, from }
  assert.equal(fallsOn(s, day(2026, 9, 7)), true, 'the anchor day itself counts')
  assert.equal(fallsOn(s, day(2026, 9, 8)), false)
  assert.equal(fallsOn(s, day(2026, 9, 9)), true)
  assert.equal(fallsOn(s, day(2026, 9, 10)), false)
  assert.equal(fallsOn(s, day(2026, 9, 11)), true)
})

test('a cadence walks across weekdays instead of pinning to one', () => {
  // The whole reason cadence cannot be stored as weekdays: over two weeks an
  // every-other-day routine hits every day of the week.
  const from = startOfDay(day(2026, 9, 7))
  const s: Schedule = { every: 'days', interval: 2, from }
  const weekdaysHit = new Set<number>()
  for (let i = 0; i < 14; i++) {
    const d = day(2026, 9, 7) + i * 86_400_000
    if (fallsOn(s, d)) weekdaysHit.add(new Date(d).getDay())
  }
  assert.equal(weekdaysHit.size, 7, 'lands on every weekday over a fortnight')
})

test('a cadence never fires before its anchor', () => {
  const from = startOfDay(day(2026, 9, 7))
  const s: Schedule = { every: 'days', interval: 2, from }
  assert.equal(fallsOn(s, day(2026, 9, 5)), false, 'two days earlier is not "every other"')
  assert.equal(fallsOn(s, day(2026, 9, 6)), false)
})

test('time of day never matters', () => {
  const s: Schedule = { every: 'days', interval: 3, from: startOfDay(day(2026, 9, 7)) }
  const morning = new Date(2026, 8, 10, 6, 30).getTime()
  const night = new Date(2026, 8, 10, 23, 45).getTime()
  assert.equal(fallsOn(s, morning), fallsOn(s, night), 'same day, same answer')
})

test('schedules describe themselves in words a person would use', () => {
  assert.equal(describeSchedule(undefined), 'Not scheduled')
  assert.equal(describeSchedule({ every: 'week', days: [] }), 'Not scheduled')
  assert.equal(describeSchedule({ every: 'week', days: [1, 4] }), 'Mon, Thu')
  assert.equal(describeSchedule({ every: 'week', days: [4, 1] }), 'Mon, Thu', 'sorted')
  assert.equal(describeSchedule({ every: 'week', days: [0, 1, 2, 3, 4, 5, 6] }), 'Every day')
  assert.equal(describeSchedule({ every: 'days', interval: 1, from: 0 }), 'Every day')
  assert.equal(describeSchedule({ every: 'days', interval: 2, from: 0 }), 'Every other day')
  assert.equal(describeSchedule({ every: 'days', interval: 3, from: 0 }), 'Every 3 days')
})
