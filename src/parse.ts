import { db, type Section } from './db'

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
const envUrl = (import.meta.env.VITE_PARSE_URL as string | undefined)?.trim()
export const PARSE_URL = envUrl
  ? envUrl.replace(/\/$/, '')
  : import.meta.env.DEV
    ? 'http://localhost:8787'
    : ''

export interface ParsedItem {
  displayName: string
  canonicalKey: string
  quantity: number | null
  unit: string | null
  /** Buy layer, when the SOURCE stated a package size ("2 (10½ oz) cans").
   *  All null when it didn't — Refine fills it in later. */
  buyCount?: number | null
  sizeAmount?: number | null
  sizeUnit?: string | null
  packaging?: string | null
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
  if (res.status === 403) {
    throw new Error('Your account does not have access to Mise yet. Ask Devon for it.')
  }
  if (!res.ok) throw new Error((data as { error?: string })?.error ?? `${label} failed (${res.status})`)
  return data as T
}

export async function parseCapture(input: {
  type: 'text' | 'url' | 'image'
  content: string
}): Promise<ParseResult> {
  return postJson<ParseResult>('/api/parse', input, 'Parse')
}

/** Current staples ignore-list as a set of canonical keys. */
export async function getStapleKeys(): Promise<Set<string>> {
  const staples = await db.staples.toArray()
  return new Set(staples.map((s) => s.canonicalKey))
}

export interface PriceEstimate {
  canonicalKey: string
  price: number
}

export async function estimatePrices(
  store: string,
  items: Array<{ canonicalKey: string; displayName: string; unit?: string }>,
): Promise<PriceEstimate[]> {
  const data = await postJson<{ prices?: PriceEstimate[] }>('/api/prices', { store, items }, 'Pricing')
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
): Promise<RefineItem[]> {
  const data = await postJson<{ items?: RefineItem[] }>('/api/refine', { store, items }, 'Refine')
  return data.items ?? []
}
