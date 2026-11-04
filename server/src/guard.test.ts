import assert from 'node:assert/strict'
import { test } from 'node:test'
import { authorize, brokerFailure, createCallCap, isAdmin, isStatus, unexpectedFailure } from './guard.js'

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


const asOwner = { variant: 'full', groups: 'admin,family' }
const asFriend = { variant: 'full', groups: 'family' }
const noAi = { variant: '', groups: 'family' }

test('/api/status is admin-only, even for someone who holds the AI', () => {
  assert.equal(authorize('/api/status', true, asOwner), null)
  assert.equal(authorize('/api/status', true, asFriend)?.status, 403)
  assert.equal(authorize('/api/status', true, noAi)?.status, 403)
})

test('/api/status needs the gateway: a forged groups header through Access is nothing', () => {
  assert.equal(authorize('/api/status', false, asOwner)?.status, 403)
})

test('an admin without the AI still reads status but not the model routes', () => {
  const adminNoAi = { variant: '', groups: 'admin' }
  assert.equal(authorize('/api/status', true, adminNoAi), null)
  assert.equal(authorize('/api/parse', true, adminNoAi)?.status, 403)
})

test('the trailing-slash spelling of status gets the same gate', () => {
  assert.equal(isStatus('/api/status/'), true)
  assert.equal(authorize('/api/status/', true, asFriend)?.status, 403)
  assert.equal(authorize('/api/status//', true, asOwner), null)
})

test('model routes need the full variant through the gateway', () => {
  for (const path of ['/api/parse', '/api/prices', '/api/refine']) {
    assert.equal(authorize(path, true, asFriend), null)
    assert.equal(authorize(path, true, noAi)?.status, 403)
    assert.equal(authorize(path, false, asFriend)?.status, 403)
  }
})

test('isAdmin matches the whole slug, not a substring', () => {
  assert.equal(isAdmin('admin'), true)
  assert.equal(isAdmin('family, admin'), true)
  assert.equal(isAdmin('administrators,not-admin'), false)
  assert.equal(isAdmin(undefined), false)
  assert.equal(isAdmin(''), false)
})

test('broker failures become plain sentences with none of the broker detail', () => {
  const detail = 'could not reach the parser: connect ECONNREFUSED 172.30.0.1:8610'
  const f = brokerFailure({ status: 504, code: '' }, 'parse that', 'parse')
  const g = brokerFailure({ status: 500, code: 'upstream' }, 'parse that', 'parse')
  for (const x of [f, g]) {
    assert.ok(!x.error.includes('ECONNREFUSED') && !x.error.includes('172.30') && !x.error.includes(detail))
    assert.ok(!x.error.startsWith('Parse failed'))
    assert.match(x.error, /^[A-Z].*\.$/)
  }
  assert.equal(f.status, 504)
  assert.equal(g.status, 502)
})

test('refusals and budgets keep their meaning, and the verb reads right', () => {
  assert.deepEqual(brokerFailure({ status: 422, code: 'model_refused' }, 'price those items', 'price'), {
    status: 422,
    error: 'The model declined to price that input.',
  })
  assert.equal(brokerFailure({ status: 429, code: 'budget_exceeded' }, 'x', 'x').status, 429)
  assert.equal(brokerFailure({ status: 429, code: 'user_limit' }, 'x', 'x').status, 429)
  // a broker 401 is OUR fault, and must not look like the person signed out
  assert.equal(brokerFailure({ status: 401, code: '' }, 'x', 'x').status, 502)
})

test('a non-broker error is a plain sentence too', () => {
  const f = unexpectedFailure('refine those items')
  assert.equal(f.status, 500)
  assert.equal(f.error, "Mise couldn't refine those items just now. Try again in a moment.")
})
