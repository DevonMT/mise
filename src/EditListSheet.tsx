import { useState } from 'react'
import { db, type List } from './db'
import { KINDS } from './kinds'
import { Icon, LIST_ICON_KEYS } from './Icon'
import { Sheet } from './Sheet'

/** A grid of pickable list icons — reused by the create-list and edit-list flows. */
export function IconGrid({
  value,
  onChange,
}: {
  value: string
  onChange: (icon: string) => void
}) {
  return (
    <div className="icon-grid">
      {LIST_ICON_KEYS.map((k) => (
        <button
          key={k}
          type="button"
          className={value === k ? 'icon-opt on' : 'icon-opt'}
          onClick={() => onChange(k)}
          aria-label={`Icon: ${k}`}
        >
          <Icon name={k} size={22} />
        </button>
      ))}
    </div>
  )
}

export function EditListSheet({ list, onClose }: { list: List; onClose: () => void }) {
  const [name, setName] = useState(list.name)
  const [icon, setIcon] = useState(list.icon || KINDS[list.kind].icon)

  const save = async () => {
    await db.lists.update(list.id!, { name: name.trim() || 'Untitled', icon })
    onClose()
  }

  return (
    <Sheet className="editlist" onClose={onClose}>
      <h3 className="sheet-title">Edit list</h3>
      <input
        className="field name-field"
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
      />
      <p className="form-label">Icon</p>
      <IconGrid value={icon} onChange={setIcon} />
      <button className="primary" onClick={save} style={{ marginTop: 16 }}>
        Save
      </button>
    </Sheet>
  )
}
