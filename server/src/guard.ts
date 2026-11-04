/**
 * The pure parts of the /api/* door: how many times a day each person may
 * call. Kept apart from index.ts (which starts a server on import) so they can
 * be tested without one.
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
