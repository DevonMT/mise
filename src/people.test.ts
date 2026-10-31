/**
 * Every people call must go to the platform, never same-origin.
 *
 * On mise.devondoes.dev a relative /api path does not fail — the gateway hands
 * it to the parse server, which answers 200 with index.html and counts it
 * against the daily AI cap. So the bug is silent, and only the URL shows it.
 *
 *   node --test --import tsx src/people.test.ts
 */
import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const calls: Array<{ url: string; init?: RequestInit }> = []
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  calls.push({ url: String(url), init })
  return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
}) as typeof fetch

const { ENDPOINT } = await import('./sync')
const people = await import('./people')

test('every people call goes to the platform with credentials', async () => {
  calls.length = 0
  await people.friends()
  await people.shares()
  await people.sharedListUids()
  await people.sendTo('u1', 'Groceries', { items: [] })
  await people.subscribe('list/1', 'u1')
  await people.unsubscribe('list/1', 'u1')
  await people.inbox()
  await people.claim('h1')
  await people.dismiss('h1')

  assert.deepEqual(calls.map((c) => c.url), [
    `${ENDPOINT}/friends`,
    `${ENDPOINT}/shares`,
    `${ENDPOINT}/shares`,
    `${ENDPOINT}/send`,
    `${ENDPOINT}/lists/list%2F1/share`,
    `${ENDPOINT}/lists/list%2F1/unshare`,
    `${ENDPOINT}/inbox`,
    `${ENDPOINT}/inbox/h1/claim`,
    `${ENDPOINT}/inbox/h1/dismiss`,
  ])
  for (const c of calls) {
    assert.ok(c.url.startsWith('https://'), `${c.url} is not absolute`)
    assert.equal(c.init?.credentials, 'include', `${c.url} drops the session cookie`)
  }
})

test("a refused share brings back the platform's reason, and offline is null", async () => {
  const real = globalThis.fetch
  try {
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ error: 'Every account has its own copy of this list.' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } })) as typeof fetch
    assert.deepEqual(await people.subscribe('default:list', 'u1'),
      { error: 'Every account has its own copy of this list.' })

    globalThis.fetch = (async () => { throw new TypeError('offline') }) as typeof fetch
    assert.deepEqual(await people.subscribe('l1', 'u1'), { error: null })
  } finally {
    globalThis.fetch = real
  }
})
