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
 * time, some of them days out of date or on an older build, so five rules
 * carry the weight:
 *
 * 1. ONLY AFTER A SYNC. It runs inside sync(), straight after the merge, so it
 *    works on the agreed state and never on what a stale laptop held at launch.
 *    Never at mount, and never while a merge is writing (the hooks are off then,
 *    so nothing it did would be recorded): it refuses.
 *
 * 2. IT LOSES TO EVERY REAL EDIT. A moved row, and the marker below, is stamped
 *    one millisecond after the version it changed, not with this device's clock
 *    (keepingStamps in sync.ts). An edit or delete made anywhere after that
 *    version still wins, on the server and on every device, so a repair can
 *    never resurrect a ticked or cleared grocery. When such an edit puts a row
 *    back on the old list, rule 3 moves it on again, edit and all.
 *
 * 3. THE OLD LIST IS NEVER DELETED. It is marked `foldedInto`, hidden (db.ts
 *    liveLists) and kept as a forwarding address. A phone that was offline, or
 *    still runs an older build, keeps adding to the old list and pushing rows
 *    that name it; every device that syncs moves them on. A deleted list would
 *    leave those rows pointing at nothing, invisible everywhere. So it is also
 *    renamed (movedName), which takes it out of an older build's repair (that
 *    deletes an empty app-named duplicate after every sync), and a delete that
 *    arrives anyway is refused (applyRemote, sync.ts).
 *
 * 4. NOTHING IS DROPPED. Every row moves, even when the shared list already
 *    has the same line: a visible duplicate is a tap to fix, while a dropped
 *    row needs a tombstone, and two devices folding at once could each drop
 *    the copy the other kept.
 *
 * 5. TIMID ABOUT WHAT IT FOLDS. Only a list made before LEGACY_BEFORE, with a
 *    random uid, an app-made name equal to the shared list's name (a rename is
 *    a decision), of a kind that has a shared list, and with neither side
 *    shared with anybody (their items would land in another account). The
 *    shares are asked fresh before anything is written, for a new fold and for
 *    forwarding alike; when they cannot be fetched nothing happens.
 *
 * After a hand merge (ManageLists, which deletes the old list) there is no old
 * list left, so this does nothing.
 */
import { db, type List } from './db'
import { isApplyingRemote, keepingStamps } from './sync'
import {
  APP_MADE_NAMES,
  DEFAULT_LIST_UID,
  DEFAULT_PANTRY_UID,
  readActiveId,
  writeActiveId,
} from './lists'
import { sharedListUids } from './people'

/** Lists made before this are the legacy ones. The fixed uids shipped on
 *  2026-09-06; the slack covers devices that took weeks to update. */
export const LEGACY_BEFORE = Date.UTC(2026, 8, 30)

/** The shared list each kind folds into. A kind without one never folds.
 *  A function, not a table: lists.ts imports sync.ts, which imports this, so
 *  its constants are not initialised yet while this module loads. */
const keeperUid = (kind: string): string | undefined =>
  kind === 'grocery' ? DEFAULT_LIST_UID : kind === 'pantry' ? DEFAULT_PANTRY_UID : undefined

/** What a folded list is called from then on. Not an app-made name, so an
 *  older build's repair leaves it be, and an older build that still shows it
 *  says what happened. */
export const movedName = (name: string) => `${name.trim()} (moved)`

// The shares are asked fresh before every write. The memo only spares a list
// that is skipped for good (shared) a /shares request on every sync.
const SHARES_TTL_MS = 10 * 60_000
let sharesMemo: { at: number; uids: Set<string> } | null = null

async function sharedNow(): Promise<Set<string> | null> {
  const uids = await sharedListUids()
  sharesMemo = uids ? { at: Date.now(), uids } : null
  return uids
}

const knownShared = (uid: string) =>
  !!sharesMemo && Date.now() - sharesMemo.at < SHARES_TTL_MS && sharesMemo.uids.has(uid)

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

export type FoldResult = {
  /** True when a merge was running, so nothing was tried. */
  refused?: true
  /** Names of the lists newly marked as folded. */
  folded: string[]
  /** Rows moved onto a shared list. */
  moved: number
}

export async function foldLegacyLists(): Promise<FoldResult> {
  const nothing: FoldResult = { folded: [], moved: 0 }
  if (isApplyingRemote()) return { ...nothing, refused: true }

  // A cheap look outside any transaction: most syncs have nothing to do, and
  // the shares are a network call, which cannot happen inside one.
  const before = await db.lists.toArray()
  const keeperOf = keepers(before)
  const work: List[] = before.filter((l) => isCandidate(l, keeperOf(l.kind)))
  for (const l of before) {
    if (l.foldedInto && l.id != null && (await db.items.where('listId').equals(l.id).count())) {
      work.push(l)
    }
  }
  // Either side shared means another account's rows are involved: skip.
  const blocked = (l: List, isShared: (uid: string) => boolean) =>
    isShared(l.uid!) || isShared(l.foldedInto ?? keeperOf(l.kind)!.uid!)
  if (!work.some((l) => !blocked(l, knownShared))) return nothing

  const shared = await sharedNow()
  if (!shared) return nothing
  const allowed = new Set(
    work.filter((l) => !blocked(l, (u) => shared.has(u))).map((l) => l.uid!),
  )
  if (!allowed.size) return nothing
  // The shares took a round trip; a merge may have started meanwhile.
  if (isApplyingRemote()) return { ...nothing, refused: true }

  const out: FoldResult = { folded: [], moved: 0 }
  const moveActive: Array<[number, number]> = []
  await keepingStamps([db.lists, db.items], async () => {
    // Read again inside: the lists may have changed while the shares were asked.
    const lists = await db.lists.toArray()
    const keeperOf = keepers(lists)
    for (const l of lists) {
      if (l.id == null || !allowed.has(l.uid!)) continue
      let to: List | undefined
      if (l.foldedInto) {
        to = lists.find((k) => k.uid === l.foldedInto && !k.foldedInto)
      } else {
        const k = keeperOf(l.kind)
        if (!isCandidate(l, k)) continue
        to = k
        // One past its own version (rule 2): a rename made elsewhere after it
        // wins and un-folds it, because a rename is a decision.
        await db.lists.put({
          ...l,
          name: movedName(l.name),
          foldedInto: k.uid,
          updatedAt: (l.updatedAt ?? 0) + 1,
        })
        out.folded.push(l.name)
      }
      if (to?.id == null) continue
      moveActive.push([l.id, to.id])
      out.moved += await moveItems(l.id, to.id)
    }
  })

  // After the commit: the app must not open on a hidden list.
  const active = readActiveId()
  for (const [from, to] of moveActive) if (active === from) writeActiveId(to)
  return out
}

/** Inside keepingStamps: every write carries its own stamp. */
async function moveItems(fromId: number, toId: number): Promise<number> {
  const mine = await db.items.where('listId').equals(fromId).toArray()
  for (const it of mine) {
    // One millisecond after the version being moved (rule 2). Hub adds
    // (pending) move too; filePending, after this, merges them on the list
    // they now belong to with the ordinary add engine.
    await db.items.put({ ...it, listId: toId, updatedAt: (it.updatedAt ?? 0) + 1 })
  }
  return mine.length
}
