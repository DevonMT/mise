/**
 * Folding the legacy duplicate lists into the shared one of their kind (#680).
 *
 * Before 2026-09-06 (f199dd3) every device seeded its own "My list" and
 * "Pantry" with a random uid, and sync, doing what it was told, kept them all.
 * The fixed `default:list` / `default:pantry` uids stopped new ones, but an
 * account that synced before then still shows two "My list" rows: the old one
 * holding the groceries, the shared one beside it.
 *
 * This moves the old list's items onto the shared list and hides the old list.
 * It is a repair to a database that other devices are editing at the same
 * time, some of them days out of date, so four rules carry the weight:
 *
 * 1. ONLY AFTER A SYNC. It runs inside sync(), straight after the merge, so it
 *    works on the agreed state and never on what a stale laptop held at launch.
 *    Never at mount, and never while a merge is writing (the hooks are off then,
 *    so nothing it did would be recorded): it refuses.
 *
 * 2. IT LOSES TO EVERY REAL EDIT. A moved row is stamped one millisecond after
 *    the version it moved, not with this device's clock (keepingStamps in
 *    sync.ts). An edit or delete made anywhere after that version still wins,
 *    on the server and on every device, so a repair can never resurrect a
 *    ticked or cleared grocery. When such an edit puts a row back on the old
 *    list, rule 3 moves it on again, edit and all.
 *
 * 3. THE OLD LIST IS NEVER DELETED. It is marked `foldedInto` and hidden
 *    (db.ts liveLists), and stays as a forwarding address. A phone that was
 *    offline, or still runs an older build, keeps adding to the old list and
 *    pushing rows that name it; every device that syncs moves them on. A
 *    deleted list would leave those rows pointing at nothing, invisible
 *    everywhere. One hidden row per account is the price.
 *
 * 4. TIMID ABOUT WHAT IT FOLDS. Only a list made before LEGACY_BEFORE, with a
 *    random uid, an app-made name equal to the shared list's name (a rename is
 *    a decision), of a kind that has a shared list, and with neither side
 *    shared with anybody (their items would land in another account). When the
 *    shares cannot be fetched nothing new is folded.
 *
 * Items: a row is dropped only when the shared list already holds one with the
 * same content (key, unit, amounts, packs, ticked, next-time, notes, dates).
 * Anything else moves, even if that leaves two "milk" lines: a visible
 * duplicate is a tap to fix, a merged-away amount is gone.
 *
 * After a hand merge (ManageLists, which deletes the old list) there is no old
 * list left, so this does nothing.
 */
import { db, type Item, type List } from './db'
import { isApplyingRemote, keepingStamps } from './sync'
import {
  APP_MADE_NAMES,
  DEFAULT_LIST_UID,
  DEFAULT_PANTRY_UID,
  readActiveId,
  writeActiveId,
} from './lists'
import { sharedListUids } from './people'
import { unitKey } from './list'

/** Lists made before this are the legacy ones. The fixed uids shipped on
 *  2026-09-06; the slack covers devices that took weeks to update. */
export const LEGACY_BEFORE = Date.UTC(2026, 8, 30)

/** The shared list each kind folds into. A kind without one never folds.
 *  A function, not a table: lists.ts imports sync.ts, which imports this, so
 *  its constants are not initialised yet while this module loads. */
const keeperUid = (kind: string): string | undefined =>
  kind === 'grocery' ? DEFAULT_LIST_UID : kind === 'pantry' ? DEFAULT_PANTRY_UID : undefined

// A candidate that is skipped for good (shared) would otherwise cost a /shares
// request on every sync.
const SHARES_TTL_MS = 10 * 60_000
let sharesMemo: { at: number; uids: Set<string> } | null = null

async function sharedNow(): Promise<Set<string> | null> {
  if (sharesMemo && Date.now() - sharesMemo.at < SHARES_TTL_MS) return sharesMemo.uids
  const uids = await sharedListUids()
  sharesMemo = uids ? { at: Date.now(), uids } : null
  return uids
}

/** For the tests. */
export function forgetShares(): void {
  sharesMemo = null
}

const norm = (s: string) => s.trim().toLowerCase()

function keepers(lists: List[]): (kind: string) => List | undefined {
  return (kind) => {
    const uid = keeperUid(kind)
    return uid ? lists.find((l) => l.uid === uid && l.kind === kind && l.id != null) : undefined
  }
}

function isCandidate(l: List, keeper: List | undefined): keeper is List {
  return (
    !!keeper &&
    l.id != null &&
    !l.foldedInto &&
    !!l.uid &&
    !l.uid.startsWith('default:') &&
    l.createdAt < LEGACY_BEFORE &&
    APP_MADE_NAMES.has(norm(l.name)) &&
    norm(l.name) === norm(keeper.name)
  )
}

/** Everything a person could have meant by a row, except its name's spelling.
 *  Two rows that agree on all of it are the same line. */
const content = (i: Item) =>
  JSON.stringify([
    i.canonicalKey, unitKey(i.unit), i.quantity ?? null, !!i.backlog, !!i.checked,
    !!i.alwaysHave, i.notes ?? '', i.dueAt ?? null, i.detail ?? '', i.buyCount ?? null,
    i.sizeAmount ?? null, i.sizeUnit ?? '', i.packaging ?? '', i.recipeUid ?? '',
    i.schedule ?? null,
  ])

export type FoldResult = {
  /** True when a merge was running, so nothing was tried. */
  refused?: true
  /** Names of the lists newly marked as folded. */
  folded: string[]
  /** Rows moved onto a shared list, and rows dropped as exact duplicates. */
  moved: number
  dropped: number
}

export async function foldLegacyLists(): Promise<FoldResult> {
  const nothing: FoldResult = { folded: [], moved: 0, dropped: 0 }
  if (isApplyingRemote()) return { ...nothing, refused: true }

  // A cheap look outside any transaction: most syncs have nothing to do, and
  // the shares are a network call, which cannot happen inside one.
  const before = await db.lists.toArray()
  const keeperOf = keepers(before)
  const fresh = before.filter((l) => isCandidate(l, keeperOf(l.kind)))
  const forwarding = before.filter((l) => l.foldedInto && l.id != null).map((l) => l.id!)
  const strays = forwarding.length
    ? await db.items.where('listId').anyOf(forwarding).count()
    : 0

  const allowed = new Set<string>()
  if (fresh.length) {
    const shared = await sharedNow()
    for (const l of fresh) {
      const k = keeperOf(l.kind)!
      if (shared && !shared.has(l.uid!) && !shared.has(k.uid!)) allowed.add(l.uid!)
    }
  }
  if (!allowed.size && !strays) return nothing
  // The shares took a round trip; a merge may have started meanwhile.
  if (isApplyingRemote()) return { ...nothing, refused: true }

  const out: FoldResult = { folded: [], moved: 0, dropped: 0 }
  const moveActive: Array<[number, number]> = []
  await keepingStamps([db.lists, db.items, db.tombstones], async () => {
    // Read again inside: the lists may have changed while the shares were asked.
    const now = Date.now()
    const lists = await db.lists.toArray()
    const keeperOf = keepers(lists)
    for (const l of lists) {
      if (l.id == null) continue
      let target: List | undefined
      if (l.foldedInto) {
        target = lists.find((k) => k.uid === l.foldedInto && !k.foldedInto)
      } else if (allowed.has(l.uid!)) {
        const k = keeperOf(l.kind)
        if (!isCandidate(l, k)) continue
        target = k
        await db.lists.put({
          ...l,
          foldedInto: k.uid,
          updatedAt: Math.max(now, (l.updatedAt ?? 0) + 1),
        })
        out.folded.push(l.name)
      }
      if (target?.id == null) continue
      moveActive.push([l.id, target.id])
      const r = await moveItems(l.id, target.id)
      out.moved += r.moved
      out.dropped += r.dropped
    }
  })

  // After the commit: the app must not open on a hidden list.
  const active = readActiveId()
  for (const [from, to] of moveActive) if (active === from) writeActiveId(to)
  return out
}

/** Inside keepingStamps: every write carries its own stamp. */
async function moveItems(fromId: number, toId: number) {
  let moved = 0
  let dropped = 0
  const mine = await db.items.where('listId').equals(fromId).toArray()
  if (!mine.length) return { moved, dropped }
  const there = new Set(
    (await db.items.where('listId').equals(toId).toArray())
      .filter((t) => !t.pending)
      .map(content),
  )
  for (const it of mine) {
    if (it.id == null) continue
    // One millisecond after the version being moved: see rule 2 above.
    const yieldAt = (it.updatedAt ?? 0) + 1
    // Hub adds (pending) always move: filePending, after this, merges them on
    // the list they now belong to with the ordinary add engine.
    if (!it.pending && there.has(content(it))) {
      await db.items.delete(it.id)
      if (it.uid) await tombstone(it.uid, yieldAt)
      dropped++
    } else {
      await db.items.put({ ...it, listId: toId, updatedAt: yieldAt })
      if (!it.pending) there.add(content(it))
      moved++
    }
  }
  return { moved, dropped }
}

/** `[kind+uid]` is unique, so a second delete of the same row updates the one
 *  tombstone rather than failing (which would abort the whole fold). */
async function tombstone(uid: string, deletedAt: number) {
  const prior = await db.tombstones.where('[kind+uid]').equals(['item', uid]).first()
  if (prior?.id != null) {
    await db.tombstones.update(prior.id, { deletedAt: Math.max(prior.deletedAt, deletedAt) })
  } else {
    await db.tombstones.add({ kind: 'item', uid, deletedAt })
  }
}
