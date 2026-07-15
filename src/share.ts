import { db, type Item, type ListKind, type Recipe, type Section } from './db'

/**
 * Sharing without a server.
 *
 * The payload rides in the URL *fragment*, which browsers never send to the
 * host — so a shared list never touches GitHub Pages (or anyone else). The only
 * party who sees it is whatever app carries the message. It's a snapshot, not a
 * subscription: the recipient gets the list as it was when you hit Share.
 */

const PREFIX = '#i='

export interface SharedItem {
  n: string // displayName
  k: string // canonicalKey
  q?: number
  u?: string
  s: Section
  d?: number // dueAt
  o?: string // notes
  x?: boolean // optional (recipe ingredient)
}

export type SharePayload =
  | { t: 'list'; v: 1; name: string; kind: ListKind; items: SharedItem[] }
  | {
      t: 'recipe'
      v: 1
      title: string
      servings: number
      ingredients: SharedItem[]
      instructions?: string
      tips?: string[]
    }

/* ---- base64url (no padding, URL-safe) ---- */

function bytesToB64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/* ---- gzip via CompressionStream, with a raw fallback ---- */

async function gzip(text: string): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null
  try {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null
  }
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

/**
 * Encode a payload into a shareable link. Gzipped when the browser supports it
 * (roughly a third the size — messaging apps mangle very long links), raw
 * base64 otherwise. The marker byte tells the reader which it got.
 */
export async function encodeShare(payload: SharePayload): Promise<string> {
  const json = JSON.stringify(payload)
  const gz = await gzip(json)
  const body = gz
    ? 'g.' + bytesToB64url(gz)
    : 'r.' + bytesToB64url(new TextEncoder().encode(json))
  const base = location.origin + import.meta.env.BASE_URL
  return base + PREFIX + body
}

/** Pull a payload out of a URL hash, or null if there isn't a valid one. */
export async function decodeShare(hash: string): Promise<SharePayload | null> {
  if (!hash.startsWith(PREFIX)) return null
  const body = hash.slice(PREFIX.length)
  const dot = body.indexOf('.')
  if (dot < 0) return null
  const mode = body.slice(0, dot)
  const data = body.slice(dot + 1)
  try {
    const bytes = b64urlToBytes(data)
    const json =
      mode === 'g' ? await gunzip(bytes) : new TextDecoder().decode(bytes)
    const parsed = JSON.parse(json)
    if (parsed?.v !== 1 || (parsed.t !== 'list' && parsed.t !== 'recipe')) return null
    return parsed as SharePayload
  } catch {
    return null
  }
}

/* ---- Building payloads ---- */

const toShared = (i: {
  displayName: string
  canonicalKey: string
  quantity?: number
  unit?: string
  section: Section
  dueAt?: number
  notes?: string
  optional?: boolean
}): SharedItem => ({
  n: i.displayName,
  k: i.canonicalKey,
  ...(i.quantity != null ? { q: i.quantity } : {}),
  ...(i.unit ? { u: i.unit } : {}),
  s: i.section,
  ...(i.dueAt != null ? { d: i.dueAt } : {}),
  ...(i.notes ? { o: i.notes } : {}),
  ...(i.optional ? { x: true } : {}),
})

export async function shareListPayload(
  listId: number,
  name: string,
  kind: ListKind,
): Promise<SharePayload> {
  // Only the live list travels — the backlog is your private "maybe" pile.
  const items = await db.items.filter((i) => i.listId === listId && !i.backlog).toArray()
  return { t: 'list', v: 1, name, kind, items: items.map(toShared) }
}

export function shareRecipePayload(recipe: Recipe): SharePayload {
  return {
    t: 'recipe',
    v: 1,
    title: recipe.title,
    servings: recipe.servings,
    ingredients: recipe.ingredients.map(toShared),
    ...(recipe.instructions ? { instructions: recipe.instructions } : {}),
    ...(recipe.tips && recipe.tips.length ? { tips: recipe.tips } : {}),
  }
}

export function sharedToItem(s: SharedItem): Omit<Item, 'id' | 'listId'> {
  return {
    displayName: s.n,
    canonicalKey: s.k,
    quantity: s.q,
    unit: s.u,
    section: s.s,
    checked: false,
    backlog: false,
    createdAt: Date.now(),
    dueAt: s.d,
    notes: s.o,
  }
}

/**
 * Hand the link to the OS share sheet, falling back to the clipboard on
 * browsers without Web Share. Returns how it went so the UI can say so.
 */
export async function shareLink(url: string, title: string): Promise<'shared' | 'copied' | 'failed'> {
  if (navigator.share) {
    try {
      await navigator.share({ title, url })
      return 'shared'
    } catch (e) {
      // User dismissed the sheet — not an error worth surfacing.
      if (e instanceof DOMException && e.name === 'AbortError') return 'shared'
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    return 'copied'
  } catch {
    return 'failed'
  }
}
