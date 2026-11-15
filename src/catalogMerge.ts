import type { LearnedSize } from './db'

/**
 * Two catalog rows for one product (#876).
 *
 * The catalog is unique on `canonicalKey`, but a row's identity across devices
 * is its `uid`. Two devices that each meet a new product before they sync
 * (a price, a favorite, a learned size) each mint a row for it, and the account
 * then holds the same key under two uids. Adding the second one throws, and it
 * used to throw in the middle of a pull, so every record after it went
 * unapplied on every sync.
 *
 * This decides what the two become, from the rows alone, so every device that
 * sees the same pair writes the same row: the smallest uid keeps the product,
 * the others are retired (sync.ts tombstones them), and their fields are folded
 * in. Pure, for the tests.
 */

type Row = Record<string, unknown> & { uid?: string; updatedAt?: number; id?: number }

const byUid = (a: Row, b: Row) => (a.uid! < b.uid! ? -1 : a.uid! > b.uid! ? 1 : 0)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * Learned sizes from several copies of one product, one per packaging: the
 * newest (`at`) wins, ties to the first copy given. Order is the first copy's,
 * then each new packaging where it first appears, so `sizes[0]` (the pick for
 * a line that names no container) is stable.
 */
export function mergeLearned(lists: Array<LearnedSize[] | undefined>): LearnedSize[] {
  const out = new Map<string, LearnedSize>()
  for (const sizes of lists) {
    for (const s of sizes ?? []) {
      const have = out.get(s.packaging)
      if (!have || num(s.at) > num(have.at)) out.set(s.packaging, s)
    }
  }
  return [...out.values()]
}

/** Field-by-field equality, ignoring the local id and the stamp. */
export function sameRow(a: Row, b: Row): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  keys.delete('id')
  keys.delete('updatedAt')
  for (const k of keys) {
    if (a[k] === undefined && b[k] === undefined) continue
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false
  }
  return true
}

/**
 * The one row a set of same-key catalog rows becomes, and the uids it retires.
 *
 * - uid: the smallest, so both devices pick the same one.
 * - plain fields (name, aisle, price, pack...): the newest copy that has one.
 * - count and lastAdded: the larger; favorite: either. All idempotent, so
 *   folding a retired row in a second time (an offline edit to it, sent late)
 *   counts nothing twice.
 * - learnedSizes: merged per packaging (mergeLearned).
 * - updatedAt: the winner's own when nothing changed, else one past the newest
 *   copy, so the merged row beats both on the server and any real edit after
 *   it still wins. The same inputs give the same stamp on every device.
 */
export function mergeDuplicates<T extends Row>(rows: T[]): { winner: T; losers: T[] } {
  const sorted = [...rows].sort(byUid)
  const first = sorted[0]
  // Oldest first, so a newer copy's value lands on top; ties by uid.
  const oldest = [...rows].sort((a, b) => num(a.updatedAt) - num(b.updatedAt) || byUid(a, b))
  const merged: Row = {}
  for (const r of oldest) {
    for (const [k, v] of Object.entries(r)) if (v !== undefined && k !== 'id') merged[k] = v
  }
  merged.uid = first.uid
  merged.canonicalKey = first.canonicalKey
  merged.count = Math.max(...rows.map((r) => num(r.count)))
  merged.lastAdded = Math.max(...rows.map((r) => num(r.lastAdded)))
  merged.favorite = rows.some((r) => r.favorite === true)
  const learned = mergeLearned(sorted.map((r) => r.learnedSizes as LearnedSize[] | undefined))
  merged.learnedSizes = learned.length ? learned : undefined

  const winner = { ...merged } as T
  delete winner.id
  winner.updatedAt = sameRow(winner, first)
    ? first.updatedAt
    : Math.max(...rows.map((r) => num(r.updatedAt))) + 1
  return { winner, losers: sorted.slice(1) }
}
