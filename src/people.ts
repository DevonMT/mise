import { ENDPOINT } from './sync'

/**
 * The estate's people, as Mise needs them.
 *
 * Friends live on the platform — one directory for every app, rather than each
 * app keeping a list that disagrees with the others. Mise only reads it.
 *
 * Every call is same-origin: the gateway proxies /api/me on each app hostname,
 * and Mise's own sync endpoints are already served from here.
 * (sharedListUids is the exception: it calls the platform directly, see there.)
 */
export interface Person {
  id: string
  name: string | null
  email: string
  icon?: string | null
  accent?: string | null
}

export interface Waiting {
  /** The handoff. NOT the sender — see from_id. */
  id: string
  /** Who sent it: what the avatar is drawn from. */
  from_id: string
  label: string
  name: string | null
  email: string
  icon?: string | null
  accent?: string | null
}

async function get<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(path, { credentials: 'include' })
    return r.ok ? ((await r.json()) as T) : null
  } catch {
    // Offline is the normal case for this app, and none of this is worth an
    // error: the list still works, it just cannot be shared right now.
    return null
  }
}

async function post<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const r = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return r.ok ? ((await r.json()) as T) : null
  } catch {
    return null
  }
}

export async function friends(): Promise<Person[]> {
  const d = await get<{ friends: Person[] }>('/api/friends')
  return d?.friends ?? []
}

/** Lists you have subscribed somebody to, and lists somebody has subscribed
 *  you to — so the switcher can say which is which rather than silently
 *  growing somebody else's groceries. */
export async function shares(): Promise<Array<Person & { list_uid: string; mine: boolean }>> {
  const d = await get<{ shares: Array<Person & { list_uid: string; mine: boolean }> }>(
    '/api/mise/shares')
  return d?.shares ?? []
}

/** The uid of every list that appears in /shares at all, whether somebody
 *  shared it to you or you shared it out. Either way it has other people
 *  attached, so a repair must not fold or delete it. Null when the server could
 *  not be asked (offline, signed out), which is not the same as "none".
 *
 *  Called straight at the platform, not same-origin: on mise.devondoes.dev the
 *  gateway only proxies /api/me and /api/sign-out, so a relative path lands on
 *  the parse server (no such route, and it counts against the daily AI cap). */
export async function sharedListUids(): Promise<Set<string> | null> {
  const d = await get<{ shares: Array<{ list_uid: string }> }>(`${ENDPOINT}/shares`)
  if (!d || !Array.isArray(d.shares)) return null
  return new Set(d.shares.map((x) => x.list_uid))
}

export async function sendTo(to: string, label: string, payload: unknown) {
  return post<{ ok: boolean }>('/api/mise/send', { to, label, payload })
}

export async function subscribe(listUid: string, to: string) {
  return post<{ ok: boolean }>(`/api/mise/lists/${encodeURIComponent(listUid)}/share`, { to })
}

export async function unsubscribe(listUid: string, who: string) {
  return post<{ ok: boolean }>(`/api/mise/lists/${encodeURIComponent(listUid)}/unshare`, { who })
}

export async function inbox(): Promise<Waiting[]> {
  const d = await get<{ waiting: Waiting[] }>('/api/mise/inbox')
  return d?.waiting ?? []
}

export async function claim(id: string) {
  return post<{ payload: unknown }>(`/api/mise/inbox/${encodeURIComponent(id)}/claim`, {})
}

export async function dismiss(id: string) {
  return post<{ ok: boolean }>(`/api/mise/inbox/${encodeURIComponent(id)}/dismiss`, {})
}
