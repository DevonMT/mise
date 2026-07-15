import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Item, type List, type ListKind } from './db'
import { KINDS, KIND_LIST, listIcon } from './kinds'
import { createList, deleteList, mergeInto, renameList } from './lists'
import { Icon } from './Icon'
import { IconGrid } from './EditListSheet'
import { Sheet } from './Sheet'

/** Switch lists, or make a new one. The kind is chosen once, up front —
 *  it decides which of Mise's smarts the list gets. */
export function ListSwitcher({
  activeId,
  onPick,
  onManage,
  onImport,
  onClose,
}: {
  activeId: number
  onPick: (id: number) => void
  onManage: () => void
  onImport: () => void
  onClose: () => void
}) {
  const lists = useLiveQuery(() => db.lists.toArray(), []) ?? []
  const counts = useLiveQuery(async () => {
    const items = await db.items.toArray()
    const m = new Map<number, number>()
    for (const i of items) {
      if (i.backlog || i.checked) continue
      m.set(i.listId, (m.get(i.listId) ?? 0) + 1)
    }
    return m
  }, []) ?? new Map<number, number>()

  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ListKind>('grocery')
  const [icon, setIcon] = useState('list')

  const create = async () => {
    const id = await createList(name, kind, icon)
    setCreating(false)
    setName('')
    setKind('grocery')
    setIcon('list')
    onPick(id)
  }

  if (creating) {
    return (
      <Sheet className="lists" onClose={() => setCreating(false)}>
        <h3 className="sheet-title">New list</h3>
        <input
          className="field name-field"
          placeholder="Name it — Costco, Weeknight, Chores…"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
        />
        <p className="form-label">What kind? (can’t change later)</p>
        <div className="kind-picker">
          {KIND_LIST.map((k) => (
            <button
              key={k.kind}
              className={kind === k.kind ? 'kind-opt on' : 'kind-opt'}
              onClick={() => {
                setKind(k.kind)
                setIcon(k.icon)
              }}
            >
              <span className="kind-icon">
                <Icon name={k.icon} size={22} />
              </span>
              <span className="kind-body">
                <span className="kind-label">{k.label}</span>
                <span className="kind-desc">{KIND_DESC[k.kind]}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="form-label">Icon</p>
        <IconGrid value={icon} onChange={setIcon} />
        <button className="primary" onClick={create} disabled={!name.trim()} style={{ marginTop: 16 }}>
          Create list
        </button>
      </Sheet>
    )
  }

  return (
    <Sheet className="lists" onClose={onClose}>
      <div className="qa-header">
        <h3 className="sheet-title">Your lists</h3>
        <button className="add-btn" onClick={() => setCreating(true)}>
          <Icon name="plus" size={18} /> New
        </button>
      </div>

      <div className="list-rows">
        {lists.map((l) => (
          <button
            key={l.id}
            className={l.id === activeId ? 'list-row on' : 'list-row'}
            onClick={() => onPick(l.id!)}
          >
            <span className="list-icon">
              <Icon name={listIcon(l)} size={22} />
            </span>
            <span className="list-body">
              <span className="list-name">{l.name}</span>
              <span className="list-sub">{KINDS[l.kind].label}</span>
            </span>
            {(counts.get(l.id!) ?? 0) > 0 && <span className="badge">{counts.get(l.id!)}</span>}
          </button>
        ))}
      </div>

      <div className="switcher-foot">
        <button className="ghost" onClick={onImport}>
          <Icon name="link" size={18} /> Paste a shared link
        </button>
        <button className="ghost" onClick={onManage}>
          Manage lists
        </button>
      </div>
    </Sheet>
  )
}

const KIND_DESC: Record<ListKind, string> = {
  grocery: 'Aisles, merging, staples, recipes, prices',
  tasks: 'Due dates and notes. No quantities.',
  pantry: 'What you keep on hand — restocks your groceries',
}

/** Rename / merge / delete. Kept out of the switcher so the common path stays one tap. */
export function ManageLists({
  activeId,
  onClose,
  onMerged,
  onDeleted,
}: {
  activeId: number
  onClose: () => void
  onMerged: (source: List, target: List, n: number) => void
  onDeleted: (snapshot: { list: List; items: Item[] }) => void
}) {
  const lists = useLiveQuery(() => db.lists.toArray(), []) ?? []
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [mergeFrom, setMergeFrom] = useState<List | null>(null)

  const startRename = (l: List) => {
    setEditing(l.id!)
    setDraft(l.name)
  }

  const commitRename = async () => {
    if (editing != null) await renameList(editing, draft)
    setEditing(null)
  }

  if (mergeFrom) {
    const targets = lists.filter((l) => l.id !== mergeFrom.id)
    return (
      <Sheet className="lists" onClose={() => setMergeFrom(null)}>
        <h3 className="sheet-title">Merge “{mergeFrom.name}” into…</h3>
        <p className="group-hint">
          Its items move over and duplicates merge automatically. “{mergeFrom.name}” is then
          deleted.
        </p>
        {targets.length === 0 ? (
          <p className="review-hint">You only have one list.</p>
        ) : (
          <div className="list-rows">
            {targets.map((t) => (
              <button
                key={t.id}
                className="list-row"
                onClick={async () => {
                  const n = await mergeInto(mergeFrom.id!, t.id!)
                  onMerged(mergeFrom, t, n)
                  setMergeFrom(null)
                }}
              >
                <span className="list-icon">
                  <Icon name={listIcon(t)} size={22} />
                </span>
                <span className="list-body">
                  <span className="list-name">{t.name}</span>
                  <span className="list-sub">{KINDS[t.kind].label}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </Sheet>
    )
  }

  return (
    <Sheet className="lists" onClose={onClose}>
      <h3 className="sheet-title">Manage lists</h3>
      <div className="manage-rows">
        {lists.map((l) => (
          <div key={l.id} className="manage-row">
            {editing === l.id ? (
              <input
                className="field"
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => e.key === 'Enter' && commitRename()}
              />
            ) : (
              <div className="manage-head">
                <span className="list-icon">
                  <Icon name={listIcon(l)} size={20} />
                </span>
                <span className="list-name">{l.name}</span>
                {l.id === activeId && <span className="rev-tag">active</span>}
              </div>
            )}
            <div className="manage-acts">
              <button className="ghost" onClick={() => startRename(l)}>
                Rename
              </button>
              <button
                className="ghost"
                disabled={lists.length < 2}
                onClick={() => setMergeFrom(l)}
              >
                Merge
              </button>
              <button
                className="ghost danger"
                disabled={lists.length < 2}
                onClick={async () => {
                  const snap = await deleteList(l.id!)
                  if (snap) onDeleted(snap)
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
      {lists.length < 2 && (
        <p className="group-hint" style={{ marginTop: 12 }}>
          Merging and deleting need at least two lists.
        </p>
      )}
    </Sheet>
  )
}
