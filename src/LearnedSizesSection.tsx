import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type LearnedSize } from './db'
import { Field } from './Field'
import {
  PACKAGINGS, SIZE_UNITS, confirmLearnedSize, deleteLearnedSize, editLearnedSize, sizeText,
} from './learnedSizes'

interface Row {
  id: number
  name: string
  size: LearnedSize
}

/**
 * Settings' Learned Sizes (#814): the package sizes Mise estimated for
 * products its table doesn't know, to check, fix or forget. Shown when AI is
 * on (that is when sizes are learned) or when there are some already, from
 * another device or from before AI was turned off.
 */
export function LearnedSizes({ aiOn }: { aiOn: boolean }) {
  const rows =
    useLiveQuery(async () => {
      const out: Row[] = []
      for (const c of await db.catalog.filter((c) => !!c.learnedSizes?.length).toArray()) {
        if (c.id == null) continue
        for (const size of c.learnedSizes ?? []) out.push({ id: c.id, name: c.displayName, size })
      }
      return out.sort((a, b) => a.name.localeCompare(b.name) || a.size.packaging.localeCompare(b.size.packaging))
    }, []) ?? []
  const [editing, setEditing] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  if (!aiOn && !rows.length) return null
  const keyOf = (r: Row) => `${r.id}:${r.size.packaging}`

  const run = async (p: Promise<string | null>) => {
    const err = await p
    setMsg(err ?? '')
    return !err
  }

  return (
    <section className="settings-group">
      <h3 className="group-title">Learned Sizes</h3>
      <p className="group-hint">
        Package sizes Mise estimated for recipe items its size table doesn’t cover. Mise reuses
        them instead of estimating again. ≈ marks one you haven’t checked.
      </p>
      {rows.length === 0 ? (
        <p className="group-hint">Nothing here yet. Sizes show up here when Mise estimates one for a recipe.</p>
      ) : (
        <ul className="learned-list">
          {rows.map((r) =>
            editing === keyOf(r) ? (
              <li key={keyOf(r)} className="learned-row editing">
                <EditSize
                  row={r}
                  onCancel={() => {
                    setEditing(null)
                    setMsg('')
                  }}
                  onSave={async (next) => {
                    if (await run(editLearnedSize(r.id, r.size.packaging, next))) setEditing(null)
                  }}
                />
              </li>
            ) : (
              <li key={keyOf(r)} className="learned-row">
                <div className="learned-main">
                  <span className="learned-name">{r.name}</span>
                  <span className="learned-size">
                    {r.size.estimated && (
                      <span className="learned-est" title="Estimate, not checked yet">
                        ≈{' '}
                      </span>
                    )}
                    {sizeText(r.size)}
                  </span>
                </div>
                <div className="learned-actions">
                  {r.size.estimated && (
                    <button
                      className="ghost learned-btn"
                      aria-label={`Confirm ${r.name}, ${sizeText(r.size)}`}
                      onClick={() => void run(confirmLearnedSize(r.id, r.size.packaging))}
                    >
                      Confirm
                    </button>
                  )}
                  <button
                    className="ghost learned-btn"
                    aria-label={`Edit ${r.name}, ${sizeText(r.size)}`}
                    onClick={() => {
                      setEditing(keyOf(r))
                      setMsg('')
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="ghost danger learned-btn"
                    aria-label={`Delete ${r.name}, ${sizeText(r.size)}`}
                    onClick={() => void run(deleteLearnedSize(r.id, r.size.packaging))}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
      {msg && <p className="err-text">{msg}</p>}
    </section>
  )
}

function EditSize({
  row,
  onSave,
  onCancel,
}: {
  row: Row
  onSave: (next: { size: number; unit: string; packaging: string }) => void
  onCancel: () => void
}) {
  const [size, setSize] = useState(String(row.size.size))
  const [unit, setUnit] = useState(row.size.unit)
  const [packaging, setPackaging] = useState(row.size.packaging)
  // The size's own unit or package stays pickable even when the list lacks it.
  const units = (SIZE_UNITS as readonly string[]).includes(unit) ? SIZE_UNITS : [row.size.unit, ...SIZE_UNITS]
  const packs = (PACKAGINGS as readonly string[]).includes(row.size.packaging) ? PACKAGINGS : [row.size.packaging, ...PACKAGINGS]
  const id = `learned-${row.id}-${row.size.packaging.replace(/\W+/g, '-')}`
  return (
    <form
      className="learned-edit"
      onSubmit={(e) => {
        e.preventDefault()
        onSave({ size: Number(size), unit, packaging })
      }}
    >
      <span className="learned-name">{row.name}</span>
      <div className="learned-fields">
        <Field id={`${id}-size`} label="Size">
          {(p) => (
            <input
              {...p}
              className="field"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={size}
              onChange={(e) => setSize(e.target.value)}
            />
          )}
        </Field>
        <Field id={`${id}-unit`} label="Unit">
          {(p) => (
            <select {...p} className="field" value={unit} onChange={(e) => setUnit(e.target.value)}>
              {units.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field id={`${id}-pack`} label="Package">
          {(p) => (
            <select {...p} className="field" value={packaging} onChange={(e) => setPackaging(e.target.value)}>
              {packs.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div className="edit-actions">
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="ghost learned-save">
          Save Size
        </button>
      </div>
    </form>
  )
}
