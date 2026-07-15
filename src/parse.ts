import { db, type Section } from './db'

/** Where the parse endpoint lives. Override at build with VITE_PARSE_URL
 *  (e.g. the mini PC's Tailscale HTTPS address); defaults to localhost for dev. */
const envUrl = (import.meta.env.VITE_PARSE_URL as string | undefined)?.trim()
export const PARSE_URL = envUrl ? envUrl.replace(/\/$/, '') : 'http://localhost:8787'

export interface ParsedItem {
  displayName: string
  canonicalKey: string
  quantity: number | null
  unit: string | null
  section: Section
}

export interface ParseResult {
  sourceType: 'recipe' | 'list'
  recipeTitle: string | null
  servings: number | null
  instructions: string | null
  items: ParsedItem[]
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
 * The endpoint lives on the mini over Tailscale, so the usual failure is
 * "phone isn't on the tailnet" — say that, don't surface a raw "NetworkError".
 */
async function postJson<T>(path: string, body: unknown, label: string): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 45_000)
  let res: Response
  try {
    res = await fetch(`${PARSE_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error(`${label} timed out. Check your connection and try again.`)
    }
    // fetch rejects (TypeError "Failed to fetch") when the server is
    // unreachable — on this app that's almost always Tailscale being off.
    throw new Error("Can't reach the parser. Make sure Tailscale is on, then try again.")
  } finally {
    clearTimeout(timer)
  }
  const data = await res.json().catch(() => ({}))
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
  unit: string
  price: number
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
