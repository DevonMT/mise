import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCallCap } from './guard.js'

function clock(start = '2026-11-04') {
  const c = { day: start, now: () => c.day }
  return c
}

test('the cap is per person: one caller at the limit does not block another', () => {
  const cap = createCallCap(2, clock().now)
  assert.equal(cap.take('friend@example.com'), true)
  assert.equal(cap.take('friend@example.com'), true)
  assert.equal(cap.take('friend@example.com'), false)
  // the owner still has the whole day
  assert.equal(cap.take('devon@example.com'), true)
  assert.equal(cap.remaining('devon@example.com'), 1)
})

test('one address in two spellings shares one allowance', () => {
  const cap = createCallCap(1, clock().now)
  assert.equal(cap.take('Friend@Example.com'), true)
  assert.equal(cap.take(' friend@example.com '), false)
})

test('the count resets when the day rolls over', () => {
  const c = clock()
  const cap = createCallCap(1, c.now)
  assert.equal(cap.take('a@x.com'), true)
  assert.equal(cap.take('a@x.com'), false)
  c.day = '2026-11-05'
  assert.equal(cap.take('a@x.com'), true)
})

test('remaining() reads without spending', () => {
  const cap = createCallCap(3, clock().now)
  cap.take('a@x.com')
  assert.equal(cap.remaining('a@x.com'), 2)
  assert.equal(cap.remaining('a@x.com'), 2)
  assert.equal(cap.remaining('nobody@x.com'), 3)
})
