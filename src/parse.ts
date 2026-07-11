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

export async function parseCapture(input: {
  type: 'text' | 'url' | 'image'
  content: string
}): Promise<ParseResult> {
  const res = await fetch(`${PARSE_URL}/api/parse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.error ?? `Parse failed (${res.status})`)
  }
  return data as ParseResult
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
  const res = await fetch(`${PARSE_URL}/api/prices`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ store, items }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error ?? `Pricing failed (${res.status})`)
  return (data.prices ?? []) as PriceEstimate[]
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
  const res = await fetch(`${PARSE_URL}/api/refine`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ store, items }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error ?? `Refine failed (${res.status})`)
  return (data.items ?? []) as RefineItem[]
}
