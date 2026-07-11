import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages'
import { PARSE_SCHEMA, SYSTEM_PROMPT, PRICES_SCHEMA, pricesSystem } from './parseContract.js'

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
      return c.json({ error: `Could not fetch that link: ${String(e)}` }, 502)
    }
    userContent = `The following text was extracted from a recipe web page. Parse it.\n\n${text}`
  } else {
    userContent = raw
  }

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 4096,
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

/** Fetch a URL and crudely reduce HTML to readable text, truncated. */
async function fetchReadable(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; MiseBot/0.1)' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = await res.text()

  // Prefer JSON-LD recipe blocks if present — they're clean and structured.
  const ld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1])
    .join('\n')

  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return `${ld}\n\n${stripped}`.slice(0, 16000)
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Mise parse server on http://localhost:${info.port}`)
  console.log(apiKey ? 'ANTHROPIC_API_KEY: set' : 'ANTHROPIC_API_KEY: MISSING — /api/parse will 503')
})
