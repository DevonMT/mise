import { db, isLive, subListParent, type Item, type List } from './db'
import { findMergeTarget, mergeInto } from './list'

/**
 * Moving items between lists, and to and from "Next time" (#808).
 *
 * "Set these aside while I shop for a recipe, then bring them back." A move is
 * an EDIT of the row, never a delete and a re-add: the row keeps its uid and
 * gets an ordinary fresh stamp from the updating hook (sync.ts), so sync
 * carries it to the other devices as the same item on a new list. A move is a
 * real choice made now, so it should win over older edits elsewhere; that is
 * why it does not use keepingStamps (that is for repairs that must lose).
 *
 * The one exception is a row whose ingredient is already on the list it is
 * moving to. Two rows for the same thing is the duplicate every add path in
 * the app works to avoid, so it merges through the same engine as an add
 * (findMergeTarget, then mergeInto with mergedPacks) and the moved row is
 * deleted, leaving a tombstone. Undo puts it back with its own uid.
 */

/** Where a move sends rows: a list, and which side of its backlog. */
export interface MoveDest {
  listId: number
  backlog: boolean
}

export interface MoveResult {
  /** Rows that moved as themselves. */
  moved: number
  /** Rows folded into a line already on the destination. */
  merged: number
  /** Puts every row back where it was, and un-merges the merged ones. */
  undo: () => Promise<void>
}

type Fields = Pick<Item, 'quantity' | 'buyCount' | 'checked'>

export async function moveItems(ids: number[], dest: MoveDest): Promise<MoveResult> {
  const movedBack: Array<{ id: number; listId: number; backlog: boolean; checked: boolean }> = []
  const mergedBack: Array<{ row: Item; targetId: number; before: Fields }> = []

  await db.transaction('rw', db.items, db.lists, async () => {
    const target = await db.lists.get(dest.listId)
    if (!target || !isLive(target)) throw new Error('That list is gone.')
    for (const id of ids) {
      const row = await db.items.get(id)
      if (!row?.id) continue
      if (row.listId === dest.listId && row.backlog === dest.backlog) continue
      // Same kind only. A recipe line has no meaning on a tasks list, and the
      // move sheet only offers lists of the kind you are standing on.
      const from = await db.lists.get(row.listId)
      if (from && from.kind !== target.kind) continue

      const existing = await findMergeTarget({
        listId: dest.listId,
        backlog: dest.backlog,
        displayName: row.displayName,
        canonicalKey: row.canonicalKey,
        unit: row.unit,
        quantity: row.quantity,
      })
      if (existing?.id != null && existing.id !== row.id) {
        mergedBack.push({
          row,
          targetId: existing.id,
          before: { quantity: existing.quantity, buyCount: existing.buyCount, checked: existing.checked },
        })
        await mergeInto(existing, row)
        await db.items.delete(row.id)
        continue
      }
      movedBack.push({ id: row.id, listId: row.listId, backlog: row.backlog, checked: row.checked })
      // Unticked, as "Save for next time" in the item sheet does: a row ticked
      // on one trip is not in the cart of the next.
      await db.items.update(row.id, { listId: dest.listId, backlog: dest.backlog, checked: false })
    }
  })

  const undo = () =>
    db.transaction('rw', db.items, async () => {
      // The merged rows first, in reverse, so a target that took two rows ends
      // at the values it had before the first.
      for (const m of [...mergedBack].reverse()) {
        await db.items.update(m.targetId, m.before)
        await db.items.put(m.row)
      }
      for (const m of movedBack) {
        await db.items.update(m.id, { listId: m.listId, backlog: m.backlog, checked: m.checked })
      }
    })

  return { moved: movedBack.length, merged: mergedBack.length, undo }
}

/** The list a new sub-list of `list` hangs under: itself, or its own parent
 *  when it already is a sub-list (one level deep, so the switcher stays flat). */
export function subListRoot(list: List, lists: List[]): List {
  return subListParent(list, lists) ?? list
}

/** Make a sub-list under `parent` (same kind, same icon). Returns its id. */
export async function createSubList(parent: List, name: string): Promise<number> {
  if (!parent.uid) throw new Error('That list has not been saved yet.')
  return db.lists.add({
    name: name.trim() || 'Saved for later',
    kind: parent.kind,
    icon: parent.icon,
    createdAt: Date.now(),
    parentUid: parent.uid,
  })
}

/** Removes a sub-list made by a move that was then undone, if nothing is on it. */
export async function dropIfEmpty(listId: number): Promise<void> {
  if ((await db.items.where('listId').equals(listId).count()) === 0) await db.lists.delete(listId)
}
