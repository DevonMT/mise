import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages'
import {
  PARSE_SCHEMA,
  SYSTEM_PROMPT,
  PRICES_SCHEMA,
  pricesSystem,
  REFINE_SCHEMA,
  refineSystem,
} from './parseContract.js'

const IMAGE_MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
type ImageMedia = (typeof IMAGE_MEDIA)[number]

// Load server/.env if present (Node 20.12+/24 built-in — no dotenv needed).
try {
  process.loadEnvFile()
} catch {
  /* no .env file — rely on the ambient environment */
}

const PORT = Number(process.env.PORT ?? 8787)
const apiKey = process.env.ANTHROPIC_API_KEY
const client = apiKey ? new Anthropic({ apiKey }) : null

const app = new Hono()

// Personal LAN app — allow any origin (the PWA calls this from the phone).
app.use('/api/*', cors())

app.get('/api/health', (c) =>
  c.json({ ok: true, hasKey: Boolean(apiKey), model: 'claude-sonnet-5' }),
)

/**
 * POST /api/parse
 * body: { type: 'text' | 'url', content: string }
 * -> the parse contract (sourceType, recipeTitle, servings, items[])
 */
app.post('/api/parse', async (c) => {
  if (!client) {
    return c.json(
      { error: 'Server has no ANTHROPIC_API_KEY set. Add it to server/.env.' },
      503,
    )
  }

  let body: { type?: string; content?: string; mediaType?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body.' }, 400)
  }

  const type =
    body.type === 'url' ? 'url' : body.type === 'image' ? 'image' : 'text'
  const raw = (body.content ?? '').trim()
  if (!raw) return c.json({ error: 'Empty content.' }, 400)

  let userContent: MessageParam['content']

  if (type === 'image') {
    const img = parseImage(raw, body.mediaType)
    if (!img) return c.json({ error: 'Unsupported or malformed image.' }, 400)
    userContent = [
      { type: 'image', source: { type: 'base64', media_type: img.media, data: img.data } },
      {
        type: 'text',
        text: 'This is a photo of a handwritten or whiteboard grocery list, or a recipe. Read every item and parse it.',
      },
    ]
  } else if (type === 'url') {
    let text: string
    try {
      text = await fetchReadable(raw)
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e)
      return c.json(
        { error: `Couldn't read that link — ${why}. Try copying the recipe text and pasting it instead.` },
        502,
      )
    }
    userContent = `The following text was extracted from a recipe web page. Parse it.\n\n${text}`
  } else {
    userContent = raw
  }

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 8000,
      thinking: { type: 'disabled' },
      system: SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: PARSE_SCHEMA } },
      messages: [{ role: 'user', content: userContent }],
    })

    if (message.stop_reason === 'refusal') {
      return c.json({ error: 'The model declined to parse that input.' }, 422)
    }

    const textBlock = message.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return c.json({ error: 'No structured output returned.' }, 502)
    }
    return c.json(JSON.parse(textBlock.text))
  } catch (e) {
    console.error('parse error:', e)
    return c.json({ error: `Parse failed: ${String(e)}` }, 500)
  }
})

/**
 * POST /api/prices
 * body: { store: string, items: [{canonicalKey, displayName, unit?}] }
 * -> { prices: [{canonicalKey, price}] }
 */
app.post('/api/prices', async (c) => {
  if (!client) {
    return c.json({ error: 'Server has no ANTHROPIC_API_KEY set.' }, 503)
  }
  let body: { store?: string; items?: Array<{ canonicalKey: string; displayName: string; unit?: string }> }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body.' }, 400)
  }
  const store = (body.store ?? '').trim() || 'a typical US grocery store'
  const items = (body.items ?? []).slice(0, 300)
  if (items.length === 0) return c.json({ prices: [] })

  const list = items
    .map((i) => `- ${i.canonicalKey}: ${i.displayName}${i.unit ? ` (${i.unit})` : ''}`)
    .join('\n')

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 8000,
      thinking: { type: 'disabled' },
      system: pricesSystem(store),
      output_config: { format: { type: 'json_schema', schema: PRICES_SCHEMA } },
      messages: [{ role: 'user', content: `Price these items:\n${list}` }],
    })
    const textBlock = message.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return c.json({ error: 'No prices returned.' }, 502)
    }
    return c.json(JSON.parse(textBlock.text))
  } catch (e) {
    console.error('prices error:', e)
    return c.json({ error: `Pricing failed: ${String(e)}` }, 500)
  }
})

/**
 * POST /api/refine
 * body: { store: string, items: [{canonicalKey, displayName, unit?}] }
 * -> { items: [{canonicalKey, options: [{label, unit, price}]}] }
 */
app.post('/api/refine', async (c) => {
  if (!client) return c.json({ error: 'Server has no ANTHROPIC_API_KEY set.' }, 503)
  let body: { store?: string; items?: Array<{ canonicalKey: string; displayName: string; unit?: string }> }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body.' }, 400)
  }
  const store = (body.store ?? '').trim() || 'a typical US grocery store'
  const items = (body.items ?? []).slice(0, 100)
  if (items.length === 0) return c.json({ items: [] })

  const list = items
    .map((i) => `- ${i.canonicalKey}: ${i.displayName}${i.unit ? ` (${i.unit})` : ''}`)
    .join('\n')

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 8000,
      thinking: { type: 'disabled' },
      system: refineSystem(store),
      output_config: { format: { type: 'json_schema', schema: REFINE_SCHEMA } },
      messages: [{ role: 'user', content: `Give options for these items:\n${list}` }],
    })
    const textBlock = message.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return c.json({ error: 'No options returned.' }, 502)
    }
    return c.json(JSON.parse(textBlock.text))
  } catch (e) {
    console.error('refine error:', e)
    return c.json({ error: `Refine failed: ${String(e)}` }, 500)
  }
})

/** Accept either a data URL (data:image/jpeg;base64,XXXX) or raw base64 + mediaType. */
function parseImage(
  content: string,
  mediaType?: string,
): { media: ImageMedia; data: string } | null {
  const m = content.match(/^data:(image\/[a-z+]+);base64,(.+)$/is)
  const media = (m ? m[1] : mediaType)?.toLowerCase() as ImageMedia | undefined
  const data = m ? m[2] : content
  if (!media || !IMAGE_MEDIA.includes(media)) return null
  return { media, data }
}

/** Fetch a URL and crudely reduce HTML to readable text, truncated.
 *  Uses a real browser UA (recipe sites 403 obvious bots) and a hard timeout
 *  (a hanging site must fail fast, or the phone's request drops → NetworkError). */
async function fetchReadable(url: string): Promise<string> {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    throw new Error("that doesn't look like a valid link")
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error('only http/https links work')
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 12_000)
  let res: Response
  try {
    res = await fetch(target, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      },
    })
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error('the site took too long to respond')
    }
    throw new Error('the site could not be reached')
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) throw new Error(`the site returned HTTP ${res.status}`)

  const ctype = res.headers.get('content-type') ?? ''
  if (ctype && !/html|xml|json|text/i.test(ctype)) {
    throw new Error(`that link is ${ctype.split(';')[0].trim()}, not a recipe page`)
  }

  const html = await res.text()

  // Prefer JSON-LD recipe blocks if present — they're clean and structured.
  const ld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1].trim())
    .join('\n')

  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const combined = `${ld}\n\n${stripped}`.trim()
  if (!combined) throw new Error('no readable text on that page')
  return combined.slice(0, 16000)
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Mise parse server on http://localhost:${info.port}`)
  console.log(apiKey ? 'ANTHROPIC_API_KEY: set' : 'ANTHROPIC_API_KEY: MISSING — /api/parse will 503')
})
