import { useState } from 'react'
import { isLive, subListParent, type List } from './db'
import { KINDS, listIcon } from './kinds'
import { subListRoot, type MoveDest } from './move'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { Field } from './Field'
import { useBackLayer } from './back'

/** Where the picked rows go: a list (and which side of its backlog), or a new
 *  sub-list made on the spot. */
export type MovePick = { to: MoveDest; label: string } | { newSubList: string; parent: List }

/**
 * "Move 3 Items": Next time, the list these came from, any other list of the
 * same kind, or a new sub-list (#808). Only the same kind, so a recipe line
 * never lands on a chores list.
 */
export function MoveSheet({
  count,
  list,
  lists,
  view,
  onPick,
  onClose,
}: {
  count: number
  list: List
  lists: List[]
  view: 'list' | 'backlog'
  onPick: (p: MovePick) => void
  onClose: () => void
}) {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  useBackLayer(naming, () => setNaming(false))

  const kind = KINDS[list.kind]
  const parent = subListParent(list, lists)
  const root = subListRoot(list, lists)
  const others = lists.filter(
    (l) => isLive(l) && l.kind === list.kind && l.id !== list.id && l.id !== parent?.id,
  )
  const sub = (l: List) => {
    const p = subListParent(l, lists)
    return p ? `Sub-list of ${p.name}` : KINDS[l.kind].label
  }
  const title = `Move ${count} ${count === 1 ? 'Item' : 'Items'}`

  if (naming) {
    const create = () => onPick({ newSubList: name.trim() || 'Saved for later', parent: root })
    return (
      <Sheet className="lists move-sheet" label={title} onClose={() => setNaming(false)}>
        <h3 className="sheet-title">New Sub-list</h3>
        <p className="group-hint">Shows under {root.name} in your lists.</p>
        <Field id="sublist-name" label="Sub-list name" hint="Blank is named Saved for Later.">
          {(p) => (
            <input
              {...p}
              className="field name-field"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()}
            />
          )}
        </Field>
        <button className="primary" onClick={create}>
          Create and Move {count}
        </button>
      </Sheet>
    )
  }

  const row = (key: string, icon: string, label: string, subText: string, pick: () => void) => (
    <button key={key} className="list-row" onClick={pick}>
      <span className="list-icon">
        <Icon name={icon} size={22} />
      </span>
      <span className="list-body">
        <span className="list-name">{label}</span>
        <span className="list-sub">{subText}</span>
      </span>
    </button>
  )

  return (
    <Sheet className="lists move-sheet" label={title} onClose={onClose}>
      <h3 className="sheet-title">{title}</h3>
      <div className="list-rows">
        {parent &&
          row('parent', 'back', `Back to ${parent.name}`, 'Where these came from', () =>
            onPick({ to: { listId: parent.id!, backlog: false }, label: `“${parent.name}”` }),
          )}
        {kind.backlog &&
          (view === 'list'
            ? row('backlog', 'calendar', kind.backlogLabel, `Set aside on ${list.name}`, () =>
                onPick({ to: { listId: list.id!, backlog: true }, label: kind.backlogLabel }),
              )
            : row('active', 'list', `Back on ${list.name}`, `Off ${kind.backlogLabel.toLowerCase()}`, () =>
                onPick({ to: { listId: list.id!, backlog: false }, label: `“${list.name}”` }),
              ))}
        {others.map((l) =>
          row(String(l.id), listIcon(l), l.name, sub(l), () =>
            onPick({ to: { listId: l.id!, backlog: false }, label: `“${l.name}”` }),
          ),
        )}
        {row('new', 'plus', 'New Sub-list', `Under ${root.name}`, () => setNaming(true))}
      </div>
    </Sheet>
  )
}
