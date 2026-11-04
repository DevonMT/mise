/**
 * The pure parts of the /api/* door: who may call what, and how many times a
 * day each person may call. Kept apart from index.ts (which starts a server on
 * import) so they can be tested without one.
 */

/** Today as a UTC date string, the cap's day boundary. */
export type Clock = () => string

const utcDay: Clock = () => new Date().toISOString().slice(0, 10)

/**
 * A daily call cap kept PER PERSON.
 *
 * It used to be one global counter, so a friend with the AI grant could spend
 * the whole day's allowance and lock the owner out. Each caller now has their
 * own count, keyed by email (lowercased: the gateway sets the header, but two
 * spellings of one address must not get two allowances). The map is dropped
 * when the day rolls over, so it never holds more than one day of callers.
 */
export function createCallCap(limit: number, today: Clock = utcDay) {
  let day = ''
  const counts = new Map<string, number>()

  return {
    /** Spend one call for `user`. False when they are already at the cap. */
    take(user: string): boolean {
      const d = today()
      if (d !== day) {
        day = d
        counts.clear()
      }
      const key = user.trim().toLowerCase()
      const n = counts.get(key) ?? 0
      if (n >= limit) return false
      counts.set(key, n + 1)
      return true
    },
    /** Calls left today for `user`, without spending one. */
    remaining(user: string): number {
      if (today() !== day) return limit
      return Math.max(0, limit - (counts.get(user.trim().toLowerCase()) ?? 0))
    },
  }
}

export interface Denial {
  status: 403
  error: string
}

/**
 * Who may reach a route, once the door has said who they are.
 *
 * - /api/status describes how this server is wired (broker address, auth mode,
 *   model, cap). That is the owner's business, so it needs the platform's
 *   admin group. It makes no model call and spends none of anyone's cap.
 * - Every other route makes a model call. Those need the app's AI, which the
 *   gateway states as X-Platform-Variant: full (derived from the per-person
 *   `ai` capability, #627). A blank variant is no AI, and the Access fallback
 *   carries no variant, so it gets nothing.
 *
 * Both only count when the request came through the gateway, which is the one
 * door that sets those headers unconditionally.
 */
export function authorize(
  path: string,
  viaGateway: boolean,
  headers: { variant?: string; groups?: string },
): Denial | null {
  if (isStatus(path)) {
    return viaGateway && isAdmin(headers.groups)
      ? null
      : { status: 403, error: 'Only the owner can see how Mise is set up.' }
  }
  const variant = viaGateway ? (headers.variant ?? '').trim() : ''
  return variant === 'full'
    ? null
    : { status: 403, error: 'AI features are not part of your Mise.' }
}

/**
 * Hono routes `/api/status/` to the same handler as `/api/status`, so a plain
 * string compare would take the slashed spelling for a model route and wave a
 * non-admin through to the config. Every status check goes through here.
 */
export function isStatus(path: string): boolean {
  return path.replace(/\/+$/, '') === '/api/status'
}

/** X-Platform-Groups is a comma list of group slugs; the admin group is `admin`. */
export function isAdmin(groups: string | undefined): boolean {
  return (groups ?? '')
    .split(',')
    .map((g) => g.trim())
    .includes('admin')
}

/**
 * What to tell the person (and which status to send) when the broker fails.
 *
 * The broker's own detail ("could not reach the parser: connect ECONNREFUSED
 * 172.30.0.1:8610", a model name, a budget figure) goes to the journal, not to
 * whoever holds the phone. `what` completes "Mise couldn't ___".
 */
export function brokerFailure(
  err: { status: number; code: string },
  what: string,
  verb: string,
): { status: 422 | 429 | 502 | 504; error: string } {
  if (err.code === 'model_refused') {
    return { status: 422, error: `The model declined to ${verb} that input.` }
  }
  if (err.code === 'budget_exceeded') {
    return { status: 429, error: 'The AI budget for Mise is spent for this month.' }
  }
  if (err.status === 429) {
    return { status: 429, error: 'You have used your AI allowance for now. Try again later.' }
  }
  if (err.status === 504) {
    return { status: 504, error: `Mise took too long to ${what}. Try again in a moment.` }
  }
  return { status: 502, error: `Mise couldn't ${what} just now. Try again in a moment.` }
}

/** The same, for an error that is not the broker's at all. */
export function unexpectedFailure(what: string): { status: 500; error: string } {
  return { status: 500, error: `Mise couldn't ${what} just now. Try again in a moment.` }
}
