import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Item, type Section } from './db'
import { SECTIONS, SECTION_META } from './sections'
import { addItem, groupBySection, formatQty } from './list'
import { AddMenu, CaptureSheet, type CaptureMode } from './Capture'
import { SettingsSheet } from './Settings'
import { RecipesSheet } from './RecipesView'

type View = 'list' | 'backlog'

/** null = closed, 'new' = add sheet, Item = edit that item. */
type SheetState = null | 'new' | Item

export default function App() {
  const items = useLiveQuery(() => db.items.toArray(), []) ?? []
  const [view, setView] = useState<View>('list')
  const [sheet, setSheet] = useState<SheetState>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [capture, setCapture] = useState<null | CaptureMode>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [recipesOpen, setRecipesOpen] = useState(false)

  const active = useMemo(() => items.filter((i) => !i.backlog), [items])
  const backlog = useMemo(() => items.filter((i) => i.backlog), [items])
  const groups = useMemo(() => groupBySection(active), [active])
  const remaining = active.filter((i) => !i.checked).length

  const toggle = (item: Item) =>
    db.items.update(item.id!, { checked: !item.checked })

  const clearChecked = () => db.items.where('checked').equals(1).delete()
  const clearAll = async () => {
    if (confirm('Clear the entire active list? (Backlog is kept.)'))
      await db.items.where('backlog').equals(0).delete()
    setMenuOpen(false)
  }

  const shown =
    view === 'list' ? groups : [{ section: 'other' as Section, items: backlog }]

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◍</span> Mise
        </div>
        <div className="topbar-actions">
          <button
            className="icon-btn"
            aria-label="Recipes"
            onClick={() => setRecipesOpen(true)}
          >
            📖
          </button>
          <button className="icon-btn" aria-label="Menu" onClick={() => setMenuOpen(true)}>
            ⋯
          </button>
        </div>
      </header>

      <div className="tabs" role="tablist">
        <button
          role="tab"
          className={view === 'list' ? 'tab active' : 'tab'}
          onClick={() => setView('list')}
        >
          List{remaining > 0 && <span className="badge">{remaining}</span>}
        </button>
        <button
          role="tab"
          className={view === 'backlog' ? 'tab active' : 'tab'}
          onClick={() => setView('backlog')}
        >
          Next time{backlog.length > 0 && <span className="badge">{backlog.length}</span>}
        </button>
      </div>

      <main className="scroll">
        {shown.every((g) => g.items.length === 0) ? (
          <div className="empty">
            <div className="empty-emoji">{view === 'list' ? '🧺' : '💭'}</div>
            <p>
              {view === 'list'
                ? 'Your list is empty.'
                : 'Nothing parked for next time.'}
            </p>
            <p className="hint">Tap ＋ to add something.</p>
          </div>
        ) : (
          shown.map(
            (g) =>
              g.items.length > 0 && (
                <section key={g.section} className="group">
                  {view === 'list' && (
                    <h2 className="group-head">
                      <span className="group-emoji">{SECTION_META[g.section].emoji}</span>
                      {SECTION_META[g.section].label}
                    </h2>
                  )}
                  <ul className="rows">
                    {g.items.map((item) => (
                      <li key={item.id} className={item.checked ? 'row done' : 'row'}>
                        <button
                          className="check"
                          aria-label={item.checked ? 'Uncheck' : 'Check off'}
                          onClick={() => toggle(item)}
                        >
                          {item.checked ? '✓' : ''}
                        </button>
                        <button className="row-main" onClick={() => setSheet(item)}>
                          <span className="name">{item.displayName}</span>
                          {formatQty(item) && <span className="qty">{formatQty(item)}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ),
          )
        )}
        <div className="bottom-space" />
      </main>

      <button className="fab" aria-label="Add item" onClick={() => setAddMenuOpen(true)}>
        ＋
      </button>

      {menuOpen && (
        <Backdrop onClose={() => setMenuOpen(false)}>
          <div className="sheet menu" onClick={(e) => e.stopPropagation()}>
            <button
              className="menu-item"
              onClick={() => {
                clearChecked()
                setMenuOpen(false)
              }}
            >
              ✓ Clear checked-off items
            </button>
            <button className="menu-item danger" onClick={clearAll}>
              🗑 Clear entire list
            </button>
            <button
              className="menu-item"
              onClick={() => {
                setSettingsOpen(true)
                setMenuOpen(false)
              }}
            >
              ⚙️ Staples &amp; settings
            </button>
          </div>
        </Backdrop>
      )}

      {addMenuOpen && (
        <AddMenu
          onClose={() => setAddMenuOpen(false)}
          onPick={(m) => {
            setAddMenuOpen(false)
            if (m === 'one') setSheet('new')
            else setCapture(m)
          }}
        />
      )}

      {capture !== null && (
        <CaptureSheet mode={capture} onClose={() => setCapture(null)} />
      )}

      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}

      {recipesOpen && <RecipesSheet onClose={() => setRecipesOpen(false)} />}

      {sheet !== null && (
        <ItemSheet
          initial={sheet === 'new' ? null : sheet}
          defaultBacklog={view === 'backlog'}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  )
}

function Backdrop({
  children,
  onClose,
}: {
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <div className="backdrop" onClick={onClose}>
      {children}
    </div>
  )
}

function ItemSheet({
  initial,
  defaultBacklog,
  onClose,
}: {
  initial: Item | null
  defaultBacklog: boolean
  onClose: () => void
}) {
  const [name, setName] = useState(initial?.displayName ?? '')
  const [qty, setQty] = useState(initial?.quantity != null ? String(initial.quantity) : '')
  const [unit, setUnit] = useState(initial?.unit ?? '')
  const [section, setSection] = useState<Section>(initial?.section ?? 'other')

  const editing = initial != null

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const parsed = qty.trim() ? Number(qty) : undefined
    const quantity = Number.isFinite(parsed as number) ? parsed : undefined
    if (editing) {
      await db.items.update(initial!.id!, {
        displayName: trimmed,
        quantity,
        unit: unit.trim() || undefined,
        section,
      })
    } else {
      await addItem({
        displayName: trimmed,
        quantity,
        unit: unit.trim() || undefined,
        section,
        backlog: defaultBacklog,
      })
    }
    onClose()
  }

  const remove = async () => {
    if (editing) await db.items.delete(initial!.id!)
    onClose()
  }

  const moveBacklog = async () => {
    if (editing)
      await db.items.update(initial!.id!, {
        backlog: !initial!.backlog,
        checked: false,
      })
    onClose()
  }

  return (
    <Backdrop onClose={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <input
          className="field name-field"
          placeholder="What do you need?"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <div className="qty-row">
          <input
            className="field"
            placeholder="Qty"
            inputMode="decimal"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          <input
            className="field"
            placeholder="Unit (cup, lb…)"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          />
        </div>

        <div className="chips">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              className={section === s.key ? 'chip on' : 'chip'}
              onClick={() => setSection(s.key)}
            >
              {s.emoji} {s.label}
            </button>
          ))}
        </div>

        <button className="primary" onClick={save}>
          {editing ? 'Save' : 'Add to ' + (defaultBacklog ? 'Next time' : 'list')}
        </button>

        {editing && (
          <div className="edit-actions">
            <button className="ghost" onClick={moveBacklog}>
              {initial!.backlog ? '↑ Move to list' : '↓ Save for next time'}
            </button>
            <button className="ghost danger" onClick={remove}>
              🗑 Delete
            </button>
          </div>
        )}
      </div>
    </Backdrop>
  )
}
