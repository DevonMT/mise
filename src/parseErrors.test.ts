/**
 * What a phone is told when an AI call is refused (#768). Mise's own door
 * answers 403 with its reason ("AI features are not part of your Mise."); that
 * sentence must reach the person instead of "no access to Mise", which sends
 * them to the wrong fix.
 */
import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { parseCapture, standardizeLines } = await import('./parse')

function answer(status: number, body: unknown) {
  globalThis.fetch = (async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch
}

const message = async (p: Promise<unknown>) => {
  try {
    await p
    return 'no error'
  } catch (e) {
    return (e as Error).message
  }
}

test("a 403 with the server's reason shows that reason", async () => {
  answer(403, { error: 'AI features are not part of your Mise.' })
  assert.equal(await message(parseCapture({ type: 'text', content: 'milk' })), 'AI features are not part of your Mise.')
  assert.equal(
    await message(standardizeLines({ title: 'Queso', servings: 8 }, [{ index: 0, displayName: 'cumin', quantity: null, unit: null }])),
    'AI features are not part of your Mise.',
  )
})

test('a 403 with no usable reason still says there is no access', async () => {
  for (const body of ['<html>Forbidden</html>', {}, { error: '' }, { error: 42 }, { error: 'x'.repeat(400) }]) {
    answer(403, body)
    assert.match(await message(parseCapture({ type: 'text', content: 'milk' })), /does not have access to Mise/, JSON.stringify(body))
  }
})

test('this client asks the parser for estimates (#774)', async () => {
  let sent: Record<string, unknown> = {}
  globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ sourceType: 'list', recipeTitle: null, servings: null, instructions: null, items: [] }), { status: 200 })
  }) as typeof fetch
  await parseCapture({ type: 'text', content: 'milk' })
  assert.equal(sent.estimates, true)
  assert.equal(sent.content, 'milk')
})

test('a 401 is still "signed out", whatever the body says', async () => {
  answer(401, { error: 'Sign in to use the AI features.' })
  assert.match(await message(parseCapture({ type: 'text', content: 'milk' })), /signed out/)
})
