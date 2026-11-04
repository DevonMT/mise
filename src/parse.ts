import { db, type Section } from './db'
import { itemKeys } from './match'
import { standardizeParsed, type Estimate } from './packSizes'

/**
 * Where the parse endpoint lives.
 *
 * SAME ORIGIN by default in a built app, because that is how it is deployed:
 * the mise server on the mini serves this bundle AND /api/* from one origin, so
 * the session cookie rides along, there is no CORS, and there is no key to
 * paste. A relative URL is the correct answer and needs no configuration.
 *
 * It used to default to http://localhost:8787, which is right for `vite dev`
 * and wrong for everything else — and since a hand-built deploy sets no env
 * var, every build put on the mini asked the USER'S OWN machine to parse and
 * failed with "Can't reach the parser". The dev default now applies only where
 * it is true.
 *
 * VITE_PARSE_URL still wins where it is set, for a build served from somewhere
 * other than the server it talks to.
 */
const envUrl = (import.meta.env?.VITE_PARSE_URL as string | undefined)?.trim()
export const PARSE_URL = envUrl
  ? envUrl.replace(/\/$/, '')
  : import.meta.env?.DEV
    ? 'http://localhost:8787'
    : ''

export interface ParsedItem {
  displayName: string
  canonicalKey: string
  quantity: number | null
  unit: string | null
  /** Buy layer: the package size the SOURCE stated ("2 (10½ oz) cans"), or,
   *  on a recipe line counted in containers with none, the standard US size
   *  (packSizes.ts first, the model second), flagged by sizeEstimated (#774). */
  buyCount?: number | null
  sizeAmount?: number | null
  sizeUnit?: string | null
  packaging?: string | null
  /** The size above is an estimate, not the source's. */
  sizeEstimated?: boolean
  /** quantity/unit is an estimate (a spice with no amount), not the source's. */
  amountEstimated?: boolean
  /** Set by standardizeResult on a recipe parsed with estimates: the model has
   *  had its go at this line, so Standardize does not ask it again. */
  estimateAsked?: boolean
  section: Section
  /** The recipe marks this ingredient as optional — not added by default. */
  optional?: boolean
}

export interface ParseResult {
  sourceType: 'recipe' | 'list'
  recipeTitle: string | null
  servings: number | null
  instructions: string | null
  items: ParsedItem[]
  /** Serving ideas / variations the recipe offers. Never become list items. */
  tips?: string[]
  /** The server says it asked the model for estimates (#774). Absent from a
   *  server that predates them, which ignores the request. */
  estimates?: boolean
}

/** Read a picked/captured file into a data URL for the parse endpoint. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

/**
 * POST JSON to the parse server with a timeout and human error messages.
 * The endpoint lives on the mini behind the platform gateway; being signed in
 * is what authorises the call. Errors are phrased for a phone, not a console.
 */
async function postJson<T>(path: string, body: unknown, label: string): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 45_000)
  let res: Response
  try {
    res = await fetch(`${PARSE_URL}${path}`, {
      method: 'POST',
      // The app is served from the same origin as this API, so the platform
      // session cookie rides along. Stated explicitly because authentication
      // now depends on it, rather than on a key the user pasted in.
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error(`${label} timed out. Check your connection and try again.`)
    }
    // fetch rejects (TypeError "Failed to fetch") when the server is
    // unreachable. Since the move off the tailnet this is an ordinary
    // connectivity problem, not "Tailscale is off".
    throw new Error("Can't reach the parser. Check your connection and try again.")
  } finally {
    clearTimeout(timer)
  }
  const data = await res.json().catch(() => ({}))
  // 401 and 403 are different problems: one is "you are signed out", the other
  // is "you are signed in but nobody has given you this app". Sending someone
  // to the wrong fix wastes their time.
  if (res.status === 401) {
    throw new Error('You are signed out. Sign in at id.devondoes.dev and try again.')
  }
  // A 403 from Mise's own door carries its reason ("AI features are not part
  // of your Mise."), which is a different fix from having no Mise at all
  // (#768). Only a 403 without one (the gateway's) means no access.
  if (res.status === 403) {
    throw new Error(serverError(data) ?? 'Your account does not have access to Mise yet. Ask Devon for it.')
  }
  if (!res.ok) throw new Error(serverError(data) ?? `${label} failed (${res.status})`)
  return data as T
}

/** The server's own sentence from an error body, if it sent a usable one. Exported for the tests. */
export function serverError(data: unknown): string | null {
  const e = (data as { error?: unknown } | null)?.error
  if (typeof e !== 'string') return null
  const s = e.trim()
  return s && s.length <= 300 ? s : null
}

export async function parseCapture(input: {
  type: 'text' | 'url' | 'image'
  content: string
}): Promise<ParseResult> {
  // `estimates`: this client stores sizeEstimated/amountEstimated, so the
  // server may estimate. A client that would drop the flags never sends it (#774).
  const result = await postJson<ParseResult>('/api/parse', { ...input, estimates: true }, 'Parse')
  return standardizeResult(result)
}

/**
 * The size table over a parse result (#774). Recipes only: a typed shopping
 * list says what you want, and a size or a teaspoon of cumin nobody wrote is
 * not that. On a list, anything the model flagged as estimated is removed
 * (the values, not just the flag), so a list line is only what was typed.
 */
export function standardizeResult(result: ParseResult): ParseResult {
  if (result.sourceType !== 'recipe') {
    return {
      ...result,
      items: result.items.map((i) => ({
        ...i,
        ...(i.sizeEstimated ? { buyCount: null, sizeAmount: null, sizeUnit: null, packaging: null } : {}),
        ...(i.amountEstimated ? { quantity: null, unit: null } : {}),
        sizeEstimated: false,
        amountEstimated: false,
      })),
    }
  }
  return {
    ...result,
    items: result.items.map((i) => {
      // The table works on undefined gaps; the wire says null.
      const line = {
        ...i,
        quantity: i.quantity ?? undefined,
        unit: i.unit ?? undefined,
        buyCount: i.buyCount ?? undefined,
        sizeAmount: i.sizeAmount ?? undefined,
        sizeUnit: i.sizeUnit ?? undefined,
        packaging: i.packaging ?? undefined,
        sizeEstimated: i.sizeEstimated || undefined,
        amountEstimated: i.amountEstimated || undefined,
      }
      // A flag with nothing under it is the model's slip, not an estimate.
      if (line.sizeEstimated && line.sizeAmount == null) line.sizeEstimated = undefined
      if (line.amountEstimated && line.quantity == null) line.amountEstimated = undefined
      const out = standardizeParsed(line)
      // Marked tried only when the server confirms the model was asked; an
      // older server ignores `estimates`, and Standardize must still offer these.
      return { ...out, quantity: out.quantity ?? null, unit: out.unit ?? null, ...(result.estimates === true ? { estimateAsked: true } : {}) }
    }),
  }
}

/** One line sent to /api/standardize. */
export interface StandardizeAsk {
  index: number
  displayName: string
  quantity: number | null
  unit: string | null
}

/**
 * The model's pass of Standardize, for lines the table left with a gap. Goes
 * through the same door as every AI call, so an account without AI gets the
 * server's 403 sentence; the caller only asks when aiEnabled().
 */
export async function standardizeLines(
  recipe: { title: string; servings: number },
  lines: StandardizeAsk[],
): Promise<{ answers: Array<Estimate & { index: number }>; asked: Set<number> }> {
  if (!lines.length) return { answers: [], asked: new Set() }
  const data = await postJson<{ lines?: Array<Estimate & { index: number }>; asked?: unknown }>(
    '/api/standardize',
    { title: recipe.title, servings: recipe.servings, lines },
    'Standardize',
  )
  const answers = Array.isArray(data.lines) ? data.lines.filter((l) => l && Number.isInteger(l.index)) : []
  // The indexes the model actually saw. Only those count as tried: a line the
  // server dropped, or a reply that made no model call, must be asked again.
  const asked = new Set(Array.isArray(data.asked) ? data.asked.filter((i): i is number => Number.isInteger(i)) : [])
  return { answers, asked }
}

/**
 * What must never be added, as canonical keys.
 *
 * Read from the pantry now rather than a separate `staples` table: an item
 * flagged `alwaysHave` on any pantry list. One place holds "I always have
 * this", instead of two features with different names meaning nearly the same
 * thing.
 *
 * Independent of stock. A staple that has run out is still a staple — you have
 * just marked it out because you want it on the list this once, and honouring
 * `checked` here would silently re-suppress it.
 */
export async function getStapleKeys(): Promise<Set<string>> {
  const items = await db.items.filter((i) => i.alwaysHave === true).toArray()
  // Every key a staple answers to (see match.ts), so the "kosher salt" a recipe
  // asks for is skipped when the pantry's staple is "salt". Test a recipe line
  // with isStaple(), not with staples.has(canonicalKey), to get that. itemKeys
  // already carries the raw key, behind its guards (peppers, coriander).
  return new Set(items.flatMap((i) => [...itemKeys(i)]))
}

/** Is this recipe/parse line one of the staples from getStapleKeys()? */
export function isStaple(
  staples: Set<string>,
  line: { displayName: string; canonicalKey?: string },
): boolean {
  for (const k of itemKeys(line)) if (staples.has(k)) return true
  return false
}

export interface PriceEstimate {
  canonicalKey: string
  price: number
}

export async function estimatePrices(
  store: string,
  items: Array<{ canonicalKey: string; displayName: string; unit?: string }>,
  area = '',
): Promise<PriceEstimate[]> {
  const data = await postJson<{ prices?: PriceEstimate[] }>('/api/prices', { store, area, items }, 'Pricing')
  return data.prices ?? []
}

export interface RefineOption {
  label: string
  /** Packages a shopper typically buys (usually 1). */
  count: number
  /** Size of one package (16), or null when packaging is self-describing. */
  sizeAmount: number | null
  /** Measure the size is in: oz, lb, ct, gallon… (null with sizeAmount). */
  sizeUnit: string | null
  /** Countable purchase noun: jar, can, dozen, lb, each… */
  packaging: string | null
  /** Price of ONE package; the line total is price × count. */
  price: number
  /** The store aisle for THIS specific product — lets refine re-file a
   *  mis-categorized item (jarred salsa → condiments, fresh pico → produce). */
  section: Section
}
export interface RefineItem {
  canonicalKey: string
  options: RefineOption[]
}

export async function refineItems(
  store: string,
  items: Array<{ canonicalKey: string; displayName: string; unit?: string }>,
  area = '',
): Promise<RefineItem[]> {
  const data = await postJson<{ items?: RefineItem[] }>('/api/refine', { store, area, items }, 'Refine')
  return data.items ?? []
}
