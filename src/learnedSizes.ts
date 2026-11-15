import { liveQuery } from 'dexie'
import { canonicalize, db, type CatalogEntry, type LearnedGone, type LearnedSize, type Section } from './db'
import { setLearnedSizes, sizeToLearn } from './packSizes'
import { unitInfo } from './fit'

/**
 * Learned package sizes (#814): the reading and writing side. The lookup
 * itself is in packSizes.ts (table, then learned, then the model).
 *
 * WHERE THEY LIVE. On the account's own catalog row (`learnedSizes`), so they
 * sync like the rest of the catalog and need no new table, record kind or
 * server change. Per account, not shared: an edit here is one person's fact
 * about their own shop, and a shared store would let one account's edit (or a
 * bad estimate) change everyone's buy math, with nobody to review it. A product
 * name is harmless, but it is still what someone cooks. The cost of not sharing
 * is small: a parse estimates sizes in the call it makes anyway, and Standardize
 * asks at most once per product per account.
 *
 * ESTIMATE UNTIL CHECKED. A learned size starts `estimated` (shown with ≈).
 * Confirming it, or editing it, clears that.
 */

/** Rows that carry learned sizes. */
const learnedRows = () => db.catalog.filter((c) => !!c.learnedSizes?.length).toArray()

/** Load the learned sizes into the lookup. Call before a parse or Standardize, so a size learned a moment ago counts. */
export async function refreshLearnedSizes(): Promise<void> {
  setLearnedSizes(await learnedRows())
}

/** Keep the lookup current while the app runs: a sync, another tab, an edit in Settings. Returns the unsubscribe. */
export function watchLearnedSizes(): () => void {
  const sub = liveQuery(learnedRows).subscribe({ next: setLearnedSizes, error: () => {} })
  return () => sub.unsubscribe()
}

type Teaching = Pick<CatalogEntry, 'displayName' | 'canonicalKey' | 'section'> &
  Parameters<typeof sizeToLearn>[0]

/**
 * Save the sizes these lines teach (see sizeToLearn): one per product and
 * packaging, never over a size already there, so a confirmed or edited size is
 * never replaced by a fresh guess. Returns how many were learned. Never throws:
 * learning is a bonus on top of a save that already happened.
 */
export async function learnSizes(lines: Array<Teaching & { section: Section }>): Promise<number> {
  try {
    await refreshLearnedSizes()
    const found = new Map<string, { line: Teaching & { section: Section }; key: string; size: NonNullable<ReturnType<typeof sizeToLearn>> }>()
    for (const l of lines) {
      const size = sizeToLearn(l)
      if (!size) continue
      const key = (l.canonicalKey?.trim() || canonicalize(l.displayName)).toLowerCase()
      if (key) found.set(`${key}\n${size.packaging}`, { line: l, key, size })
    }
    if (!found.size) return 0
    let n = 0
    const now = Date.now()
    await db.transaction('rw', db.catalog, async () => {
      for (const { line, key, size } of found.values()) {
        const row = await db.catalog.where('canonicalKey').equals(key).first()
        const have = row?.learnedSizes ?? []
        if (have.some((s) => s.packaging === size.packaging)) continue
        const learnedSizes = [...have, { ...size, estimated: true, at: now }]
        // Learned again after a delete: the size is newer than its marker (#870).
        if (row?.id != null) await db.catalog.update(row.id, { learnedSizes, learnedGone: without(row.learnedGone, size.packaging) })
        else
          await db.catalog.add({
            canonicalKey: key,
            displayName: line.displayName.trim(),
            section: line.section,
            count: 0,
            favorite: false,
            lastAdded: now,
            learnedSizes,
          })
        n++
      }
    })
    await refreshLearnedSizes()
    return n
  } catch {
    return 0
  }
}

/** Units and packages the Learned Sizes editor offers. */
export const SIZE_UNITS = ['oz', 'fl oz', 'lb', 'g', 'kg', 'ml', 'l', 'ct'] as const
export const PACKAGINGS = [
  'bag', 'block', 'bottle', 'box', 'can', 'carton', 'container', 'jar', 'packet', 'package', 'pouch', 'tub', 'tube',
] as const

/** A row's delete markers less one packaging's; undefined when none are left. */
function without(gone: LearnedGone[] | undefined, packaging: string): LearnedGone[] | undefined {
  const out = (gone ?? []).filter((g) => g.packaging !== packaging)
  return out.length ? out : undefined
}

/**
 * Change one learned size (picked by its packaging) with `fn`, then reload the
 * lookup. A packaging that is no longer there afterwards (deleted, or edited to
 * another packaging) leaves a delete marker (#870), so a sync with a device
 * that still holds the old size does not bring it back; one that is there
 * loses its marker.
 */
async function changeSize(id: number, packaging: string, fn: (sizes: LearnedSize[], i: number) => LearnedSize[] | string): Promise<string | null> {
  let err: string | null = null
  await db.transaction('rw', db.catalog, async () => {
    const row = await db.catalog.get(id)
    const sizes = row?.learnedSizes ?? []
    const i = sizes.findIndex((s) => s.packaging === packaging)
    if (!row || i < 0) {
      err = 'That size is gone. It may have been deleted on another device.'
      return
    }
    const next = fn(sizes, i)
    if (typeof next === 'string') {
      err = next
      return
    }
    let learnedGone = row.learnedGone
    for (const s of next) learnedGone = without(learnedGone, s.packaging)
    if (!next.some((s) => s.packaging === packaging)) {
      learnedGone = [...(learnedGone ?? []), { packaging, at: Date.now() }]
    }
    await db.catalog.update(id, { learnedSizes: next.length ? next : undefined, learnedGone })
  })
  await refreshLearnedSizes()
  return err
}

/** Mark a learned size as checked: it keeps its numbers and loses the ≈. */
export function confirmLearnedSize(id: number, packaging: string): Promise<string | null> {
  return changeSize(id, packaging, (sizes, i) =>
    sizes.map((s, j) => (j === i ? { ...s, estimated: undefined, at: Date.now() } : s)),
  )
}

/**
 * Edit a learned size. An edit is the person's own number, so it is no longer
 * an estimate. Returns an error sentence, or null when saved.
 */
export function editLearnedSize(
  id: number,
  packaging: string,
  next: { size: number; unit: string; packaging: string },
): Promise<string | null> {
  const unit = next.unit.trim()
  const pkg = next.packaging.trim().toLowerCase()
  if (!Number.isFinite(next.size) || next.size <= 0 || next.size > 1000) return Promise.resolve('Enter a size between 0 and 1000.')
  if (!unitInfo(unit)) return Promise.resolve('Pick a unit from the list.')
  if (!pkg || pkg.length > 20 || /[\p{Cc}<>{}]/u.test(pkg)) return Promise.resolve('Pick a package from the list.')
  return changeSize(id, packaging, (sizes, i) => {
    if (pkg !== packaging && sizes.some((s) => s.packaging === pkg)) {
      return `This already has a ${pkg} size. Edit that one instead.`
    }
    return sizes.map((s, j) => (j === i ? { size: next.size, unit, packaging: pkg, at: Date.now() } : s))
  })
}

/** Forget a learned size. The next recipe that needs it asks the model again. */
export function deleteLearnedSize(id: number, packaging: string): Promise<string | null> {
  return changeSize(id, packaging, (sizes, i) => sizes.filter((_, j) => j !== i))
}

/** "10 oz jar". */
export function sizeText(s: Pick<LearnedSize, 'size' | 'unit' | 'packaging'>): string {
  const n = Math.round(s.size * 100) / 100
  return `${n} ${s.unit} ${s.packaging}`
}
