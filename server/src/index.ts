import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import * as jose from 'jose'
import { askStructured, BrokerError } from './broker.js'
import {
  PARSE_SCHEMA,
  SYSTEM_PROMPT,
  PRICES_SCHEMA,
  pricesSystem,
  REFINE_SCHEMA,
  refineSystem,
} from './parseContract.js'
import { timingSafeEqual } from 'node:crypto'

const IMAGE_MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
type ImageMedia = (typeof IMAGE_MEDIA)[number]

// Load server/.env if present (Node 20.12+/24 built-in — no dotenv needed).
try {
  process.loadEnvFile()
} catch {
  /* no .env file — rely on the ambient environment */
}

const PORT = Number(process.env.PORT ?? 8787)
// No Anthropic client and no key here: every model call goes to the ai-broker.
const BROKER_URL = (process.env.BROKER_URL ?? 'http://172.18.0.1:8610').replace(/\/+$/, '')

// This server used to be tailnet-only, so "no auth" was safe: Tailscale WAS
// the auth. It is now reachable from the internet via Cloudflare Tunnel at
// mise.devondoes.dev, so it needs its own door.
//
// Cloudflare Access cannot be that door: the PWA is served from
// devontroedel.com and calls this cross-origin, and Access answers an
// unauthenticated request with a 302 to an interactive login page — which an
// XHR cannot complete. So the check lives here, and the key is entered by hand
// in Settings (localStorage) rather than shipped in the public bundle.
// Preferred door: Cloudflare Access. The app is served from this same origin
// (mise.devondoes.dev), so the browser sends the Access cookie automatically and
// Cloudflare hands us a signed JWT. We verify it here rather than trusting the
// header, because :8787 is still reachable on the LAN and over the tailnet —
// the edge is not the only way in.
const ACCESS_TEAM_DOMAIN = (process.env.ACCESS_TEAM_DOMAIN ?? '').trim()
const ACCESS_AUD = (process.env.ACCESS_AUD ?? '').trim()
const JWKS =
  ACCESS_TEAM_DOMAIN
    ? jose.createRemoteJWKSet(
        new URL(`https://${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`),
      )
    : null

/** Verified Access email, or null. Never throws. */
async function accessEmail(token: string | undefined): Promise<string | null> {
  if (!token || !JWKS || !ACCESS_AUD) return null
  try {
    const { payload } = await jose.jwtVerify(token, JWKS, {
      issuer: `https://${ACCESS_TEAM_DOMAIN}`,
      audience: ACCESS_AUD,
    })
    return (payload.email as string | undefined) ?? 'unknown'
  } catch {
    return null
  }
}

/**
 * The platform gateway's door.
 *
 * Two headers, and both are required. X-Platform-User carries the email and the
 * gateway sets it unconditionally, so a browser cannot smuggle its own value
 * through. But :8787 is reachable from every container on the Docker bridge,
 * and any of them could send that header directly -- so X-Gateway-Token is a
 * shared secret proving the request actually came through the gateway. Without
 * it, trusting the identity header would mean trusting every container on the
 * network to be honest about who it claims to be.
 *
 * Compared byte-for-byte in constant time, like any other secret here.
 */
const GATEWAY_TOKEN = (process.env.GATEWAY_TOKEN ?? '').trim()

function gatewayEmail(
  token: string | undefined,
  user: string | undefined,
): string | null {
  if (!GATEWAY_TOKEN || !token) return null
  const a = Buffer.from(token, 'utf8')
  const b = Buffer.from(GATEWAY_TOKEN, 'utf8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  const email = user?.trim()
  return email ? email : null
}

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)
// Backstop: if the key ever leaks, this caps the damage at a known number of
// calls per day instead of an unbounded API bill.
const DAILY_CALL_CAP = Number(process.env.DAILY_CALL_CAP ?? 200)

const app = new Hono<{ Variables: { caller: string } }>()

app.use(
  '/api/*',
  cors({
    // No allow-list configured -> stay permissive, so a LAN/dev setup still
    // works. With one configured, only those origins may call.
    origin: (origin) =>
      !origin || ALLOWED_ORIGINS.length === 0
        ? origin || '*'
        : ALLOWED_ORIGINS.includes(origin)
          ? origin
          : null,
    allowHeaders: ['content-type'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
  }),
)

let capDay = ''
let capCount = 0

app.use('/api/*', async (c, next) => {
  // /api/health stays open: it is the tunnel's and Mission Control's probe and
  // it reveals nothing but liveness.
  if (c.req.path === '/api/health' || c.req.method === 'OPTIONS') return next()

  // The gateway is checked first: it is the door this service is meant to be
  // behind now, and Access remains only until its application is removed.
  const email =
    gatewayEmail(c.req.header('x-gateway-token'), c.req.header('x-platform-user'))
    ?? await accessEmail(c.req.header('cf-access-jwt-assertion'))
  if (!email) {
    // Fail closed. With no door at all this is a deployment mistake, and saying
    // so is more useful than a 401 that reads like a rejected password.
    if (!JWKS && !GATEWAY_TOKEN) {
      return c.json(
        { error: 'Server misconfigured: neither GATEWAY_TOKEN nor Access is set.' },
        503,
      )
    }
    return c.json({ error: 'Sign in to use the AI features.' }, 401)
  }

  // Carried to the broker so a per-person allowance can bite and the ledger can
  // say who spent what. Not an authorization input — the door above already
  // decided that.
  c.set('caller', email)

  const today = new Date().toISOString().slice(0, 10)
  if (today !== capDay) {
    capDay = today
    capCount = 0
  }
  if (capCount >= DAILY_CALL_CAP) {
    return c.json(
      { error: `Daily cap of ${DAILY_CALL_CAP} AI calls reached. Try tomorrow.` },
      429,
    )
  }
  capCount += 1
  return next()
})

// Public (Access bypass) so the tunnel and Mission Control can probe it.
// Liveness ONLY — anything about how this server is configured belongs behind
// the door, not in an unauthenticated response.
app.get('/api/health', (c) => c.json({ ok: true }))

// The detail that /api/health used to leak. Sits under /api/* so it is covered
// by the auth middleware.
app.get('/api/status', (c) =>
  c.json({
    ok: true,
    // This server holds no key; the broker does. What matters here is
    // whether the broker is reachable at all, which /api/parse reports.
    broker: BROKER_URL,
    locked: Boolean(GATEWAY_TOKEN) || Boolean(JWKS),
    auth: GATEWAY_TOKEN ? 'gateway' : JWKS ? 'access' : 'none',
    model: 'claude-sonnet-5',
    dailyCap: DAILY_CALL_CAP,
  }),
)

/**
 * POST /api/parse
 * body: { type: 'text' | 'url', content: string }
 * -> the parse contract (sourceType, recipeTitle, servings, items[])
 */
app.post('/api/parse', async (c) => {
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

  let userContent: string
  // Images travel beside the prompt rather than inside it: the broker builds
  // the provider-shaped message, so this file no longer has to know that shape.
  let images: { media_type: string; data: string }[] = []

  if (type === 'image') {
    const img = parseImage(raw, body.mediaType)
    if (!img) return c.json({ error: 'Unsupported or malformed image.' }, 400)
    images = [{ media_type: img.media, data: img.data }]
    userContent =
      'This is a photo of a handwritten or whiteboard grocery list, or a recipe. Read every item and parse it.'
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
    const data = await askStructured<unknown>({
      user: c.get('caller'),
      prompt: userContent,
      schema: PARSE_SCHEMA,
      system: SYSTEM_PROMPT,
      images,
    })
    return c.json(data)
  } catch (e) {
    console.error('parse error:', e)
    // Keep the broker's status. A refusal (422) and an exhausted budget (429)
    // are not server faults, and flattening them to 500 tells the person
    // holding the phone the wrong thing about what to do next.
    if (e instanceof BrokerError) {
      const msg =
        e.code === 'model_refused' ? 'The model declined to parse that input.'
        : e.code === 'budget_exceeded' ? 'The AI budget for Mise is spent for this month.'
        : `Parse failed: ${e.message}`
      return c.json({ error: msg }, e.status as 400)
    }
    return c.json({ error: `Parse failed: ${String(e)}` }, 500)
  }
})

/**
 * POST /api/prices
 * body: { store: string, items: [{canonicalKey, displayName, unit?}] }
 * -> { prices: [{canonicalKey, price}] }
 */
app.post('/api/prices', async (c) => {
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
    const data = await askStructured<unknown>({
      user: c.get('caller'),
      prompt: `Price these items:\n${list}`,
      schema: PRICES_SCHEMA,
      system: pricesSystem(store),
    })
    return c.json(data)
  } catch (e) {
    console.error('prices error:', e)
    // Keep the broker's status. A refusal (422) and an exhausted budget (429)
    // are not server faults, and flattening them to 500 tells the person
    // holding the phone the wrong thing about what to do next.
    if (e instanceof BrokerError) {
      const msg =
        e.code === 'model_refused' ? 'The model declined to prices that input.'
        : e.code === 'budget_exceeded' ? 'The AI budget for Mise is spent for this month.'
        : `Pricing failed: ${e.message}`
      return c.json({ error: msg }, e.status as 400)
    }
    return c.json({ error: `Pricing failed: ${String(e)}` }, 500)
  }
})

/**
 * POST /api/refine
 * body: { store: string, items: [{canonicalKey, displayName, unit?}] }
 * -> { items: [{canonicalKey, options: [{label, count, sizeAmount, sizeUnit, packaging, price, section}]}] }
 */
app.post('/api/refine', async (c) => {
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
    const data = await askStructured<unknown>({
      user: c.get('caller'),
      prompt: `Give options for these items:\n${list}`,
      schema: REFINE_SCHEMA,
      system: refineSystem(store),
    })
    return c.json(data)
  } catch (e) {
    console.error('refine error:', e)
    // Keep the broker's status. A refusal (422) and an exhausted budget (429)
    // are not server faults, and flattening them to 500 tells the person
    // holding the phone the wrong thing about what to do next.
    if (e instanceof BrokerError) {
      const msg =
        e.code === 'model_refused' ? 'The model declined to refine that input.'
        : e.code === 'budget_exceeded' ? 'The AI budget for Mise is spent for this month.'
        : `Refine failed: ${e.message}`
      return c.json({ error: msg }, e.status as 400)
    }
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

// Serve the built PWA from this same origin. Same-origin is the whole point:
// it means the browser sends the Access cookie on every /api fetch, so there is
// no CORS and no key for the user to paste.
// Paths are relative to the service's WorkingDirectory (server/), which must
// stay there so process.loadEnvFile() still finds server/.env.
const STATIC_ROOT = process.env.STATIC_DIR ?? '../dist'

/**
 * Cache headers, which this server was sending none of.
 *
 * That is worse here than it sounds. With no Cache-Control, no ETag and no
 * Last-Modified, a browser falls back to heuristic caching — and it applied to
 * `sw.js` as well as the page. A cacheable service worker means the update
 * check can itself be answered from cache, so `registerType: 'autoUpdate'`
 * never fires and the old precache keeps serving the old app indefinitely. A
 * deploy would land on the server and simply not arrive.
 *
 * The split is the standard one and depends only on whether the filename
 * carries a content hash:
 *
 *   /assets/*  Vite hashes these, so the name changes whenever the bytes do.
 *              Immutable for a year; a stale one can never be wrong.
 *   everything else  index.html, sw.js, the manifest, the icons — fixed names
 *              whose contents change. `no-cache` does not mean "do not store",
 *              it means "revalidate before use", so these stay fast on a 304
 *              while never being served blind.
 */
app.use('/*', async (c, next) => {
  await next()
  if (c.res.headers.has('cache-control')) return
  const path = new URL(c.req.url).pathname
  c.header(
    'Cache-Control',
    path.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  )
})

app.use('/*', serveStatic({ root: STATIC_ROOT }))
// SPA fallback so deep links and the PWA start_url resolve.
app.get('*', serveStatic({ path: `${STATIC_ROOT}/index.html` }))

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Mise parse server on http://localhost:${info.port}`)
    console.log(`AI: via ai-broker at ${BROKER_URL} (no key held here)`)
  const doors = [GATEWAY_TOKEN ? 'platform gateway' : null, JWKS && ACCESS_AUD ? 'Access' : null].filter(Boolean)
  console.log(
    doors.length
      ? `Auth: ${doors.join(' + ')} (daily cap ${DAILY_CALL_CAP})`
      : 'Auth: NONE CONFIGURED — /api/* will 503',
  )
  console.log(`CORS: ${ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.join(', ') : 'any origin (no allow-list)'}`)
  console.log(JWKS ? `Access: ${ACCESS_TEAM_DOMAIN} (aud ${ACCESS_AUD.slice(0, 8)}…)` : 'Access: not configured')
})
