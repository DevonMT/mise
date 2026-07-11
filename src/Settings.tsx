import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, canonicalize } from './db'
import { PARSE_URL } from './parse'

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const staples =
    useLiveQuery(async () => {
      const all = await db.staples.toArray()
      return all.sort((a, b) => a.displayName.localeCompare(b.displayName))
    }, []) ?? []
  const [name, setName] = useState('')

  const add = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const canonicalKey = canonicalize(trimmed)
    const exists = await db.staples.where('canonicalKey').equals(canonicalKey).first()
    if (!exists) await db.staples.add({ canonicalKey, displayName: trimmed })
    setName('')
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet settings" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <h3 className="sheet-title">Staples you always have</h3>
        <p className="review-hint">
          These are skipped when parsing lists and recipes, so they never clutter your list.
        </p>

        <div className="qty-row">
          <input
            className="field"
            placeholder="e.g. salt, olive oil, garlic"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button className="add-btn" onClick={add} disabled={!name.trim()}>
            Add
          </button>
        </div>

        {staples.length === 0 ? (
          <p className="empty-staples">No staples yet.</p>
        ) : (
          <div className="staple-chips">
            {staples.map((s) => (
              <button
                key={s.id}
                className="staple-chip"
                onClick={() => db.staples.delete(s.id!)}
                title="Remove"
              >
                {s.displayName} ✕
              </button>
            ))}
          </div>
        )}

        <p className="endpoint-note">Parse endpoint: {PARSE_URL}</p>
      </div>
    </div>
  )
}
