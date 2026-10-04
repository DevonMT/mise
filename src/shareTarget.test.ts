/**
 * What Android hands us when Mise is picked from the share sheet. The link is
 * in `url` for some apps and buried in `text` for others; neither may be
 * trusted to be there, and nothing is ever added without the review step.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sharedLink, isShareQuery } from './shareTarget'

test('takes the link from url', () => {
  assert.equal(sharedLink('?url=https%3A%2F%2Fx.com%2Fchili'), 'https://x.com/chili')
})

test('finds a link buried in text', () => {
  const s = '?title=Chili&text=' + encodeURIComponent('Great chili https://x.com/chili?a=1&b=2 yum')
  assert.equal(sharedLink(s), 'https://x.com/chili?a=1&b=2')
})

test('url wins over text', () => {
  assert.equal(sharedLink('?url=https://a.com/1&text=https://b.com/2'), 'https://a.com/1')
})

test('trailing punctuation is not part of the link', () => {
  assert.equal(sharedLink('?text=' + encodeURIComponent('try https://x.com/r.')), 'https://x.com/r')
})

test('shared text with no link yields null but is still a share query', () => {
  assert.equal(sharedLink('?text=just+words'), null)
  assert.equal(isShareQuery('?text=just+words'), true)
})

test('ordinary launches are not share queries', () => {
  assert.equal(sharedLink(''), null)
  assert.equal(isShareQuery(''), false)
  assert.equal(isShareQuery('?utm_source=x'), false)
})

test('non-http schemes are ignored', () => {
  assert.equal(sharedLink('?url=javascript:alert(1)'), null)
})
