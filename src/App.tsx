import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Item, type Section } from './db'
import { SECTIONS, SECTION_META } from './sections'
import { addItem, groupBySection, formatQty } from './list'
import { AddMenu, CaptureSheet, type CaptureMode } from './Capture'
import { SettingsView } from './Settings'
import { RecipesView } from './RecipesView'
import { QuickAddSheet } from './QuickAdd'
import { RefineSheet } from './RefineView'
import { setPrice as savePrice, setFavoriteByKey, syncCatalogName } from './catalog'
import { Sheet } from './Sheet'
import { SwipeRow } from './SwipeRow'
import { BottomNav, type Tab } from './BottomNav'

type ListView = 'list' | 'backlog'
type SheetState = null | 'new' | Item

export default function App() {
  const items = useLiveQuery(() => db.items.toArray(), []) ?? []
  const catalog = useLiveQuery(() => db.catalog.toArray(), []) ?? []

  const [tab, setTab] = useState<Tab>('list')
  const [view, setView] = useState<ListView>('list')
  const [sheet, setSheet] = useState<SheetState>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [capture, setCapture] = useState<null | CaptureMode>(null)
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const [refineOpen, setRefineOpen] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [toast, setToast] = useState<{ msg: string; undo?: () => void } | null>(null)
  const [showHint, setShowHint] = useState(() => !localStorage.getItem('mise.swipeHint'))
  const undoTimer = useRef<number | undefined>(undefined)

  const priceMap = useMemo(
    () =>
      new Map(catalog.filter((c) => c.price != null).map((c) => [c.canonicalKey, c.price as number])),
    [catalog],
  )
  const favSet = useMemo(
    () => new Set(catalog.filter((c) => c.favorite).map((c) => c.canonicalKey)),
    [catalog],
  )

  const active = useMemo(() => items.filter((i) => !i.backlog), [items])
  const backlog = useMemo(() => items.filter((i) => i.backlog), [items])
  const groups = useMemo(() => groupBySection(active), [active])
  const remaining = active.filter((i) => !i.checked).length

  const total = useMemo(
    () =>
      active.reduce((sum, i) => {
        const p = priceMap.get(i.canonicalKey)
        return p != null ? sum + p * (i.quantity ?? 1) : sum
      }, 0),
    [active, priceMap],
  )
  const pricedCount = active.filter((i) => priceMap.has(i.canonicalKey)).length

  const toggle = (item: Item) => db.items.update(item.id!, { checked: !item.checked })

  const showToast = (msg: string, undo?: () => void) => {
    if (undoTimer.current) clearTimeout(undoTimer.current)
    setToast({ msg, undo })
    undoTimer.current = window.setTimeout(() => setToast(null), 5000)
  }
  /** Delete rows but keep them so an Undo can restore them (same ids). */
  const removeWithUndo = async (rows: Item[], msg: string) => {
    if (!rows.length) return
    await db.items.bulkDelete(rows.map((r) => r.id!))
    showToast(msg, async () => {
      await db.items.bulkAdd(rows)
      setToast(null)
    })
  }
  const doUndo = () => {
    if (undoTimer.current) clearTimeout(undoTimer.current)
    toast?.undo?.()
  }

  const clearChecked = () => {
    const rows = active.filter((i) => i.checked)
    removeWithUndo(rows, `Cleared ${rows.length} checked-off`)
    setMenuOpen(false)
  }
  const clearAll = () => {
    removeWithUndo([...active], `Cleared list (${active.length})`)
    setMenuOpen(false)
  }

  const enterSelect = () => {
    setSelected(new Set())
    setSelectMode(true)
    setMenuOpen(false)
  }
  const exitSelect = () => {
    setSelectMode(false)
    setSelected(new Set())
  }
  const toggleSelect = (id: number) =>
    setSelected((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  const deleteSelected = async () => {
    const rows = items.filter((i) => selected.has(i.id!))
    await removeWithUndo(rows, `Removed ${rows.length}`)
    exitSelect()
  }

  const dismissHint = () => {
    localStorage.setItem('mise.swipeHint', '1')
    setShowHint(false)
  }

  const closeAll = () => {
    setMenuOpen(false)
    setAddMenuOpen(false)
    setCapture(null)
    setQuickAddOpen(false)
    setRefineOpen(false)
    setSheet(null)
    setSelectMode(false)
    setSelected(new Set())
    setTab('list')
  }

  // Android back: close any overlay / leave a non-list tab, instead of exiting.
  const backCatchable =
    menuOpen ||
    addMenuOpen ||
    capture !== null ||
    quickAddOpen ||
    refineOpen ||
    sheet !== null ||
    selectMode ||
    tab !== 'list'
  useEffect(() => {
    if (!backCatchable) return
    let poppedByBack = false
    window.history.pushState({ mise: true }, '')
    const onPop = () => {
      poppedByBack = true
      closeAll()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      if (!poppedByBack) window.history.back()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backCatchable])

  // One-time reconcile of catalog names against the current list.
  useEffect(() => {
    ;(async () => {
      for (const it of await db.items.toArray()) {
        await syncCatalogName(it.canonicalKey, it.displayName, it.unit)
      }
    })()
  }, [])

  const shown = view === 'list' ? groups : [{ section: 'other' as Section, items: backlog }]

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img className="logo-img" src={`${import.meta.env.BASE_URL}icon.svg`} alt="" /> Mise
        </div>
        {tab === 'list' && (
          <button className="icon-btn" aria-label="List actions" onClick={() => setMenuOpen(true)}>
            ⋯
          </button>
        )}
      </header>

      <main className="scroll">
        {tab === 'list' && (
          <>
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

            {view === 'list' && !selectMode && active.length > 0 && pricedCount > 0 && (
              <button className="subtotal" onClick={() => setTab('settings')}>
                <span className="subtotal-amt">~${total.toFixed(2)}</span>
                <span className="subtotal-sub">
                  est. · {pricedCount}/{active.length} priced
                </span>
              </button>
            )}

            {showHint && !selectMode && active.length > 0 && (
              <div className="hint-banner">
                <span>Swipe a row → check off · ← delete</span>
                <button className="hint-x" aria-label="Dismiss" onClick={dismissHint}>
                  ✕
                </button>
              </div>
            )}

            {shown.every((g) => g.items.length === 0) ? (
              <div className="empty">
                <div className="empty-emoji">{view === 'list' ? '🛒' : '💭'}</div>
                <p>{view === 'list' ? 'Your list is empty.' : 'Nothing parked for next time.'}</p>
                <p className="hint">Tap ＋ to snap, paste, or type what you need.</p>
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
                        {g.items.map((item) => {
                          const sel = selected.has(item.id!)
                          const isFav = favSet.has(item.canonicalKey)
                          const cls = selectMode
                            ? sel
                              ? 'row selected'
                              : 'row'
                            : item.checked
                              ? 'row done'
                              : 'row'
                          const p = priceMap.get(item.canonicalKey)
                          const content = (
                            <>
                              <button
                                className="check"
                                aria-label={
                                  selectMode ? 'Select' : item.checked ? 'Uncheck' : 'Check off'
                                }
                                onClick={() =>
                                  selectMode ? toggleSelect(item.id!) : toggle(item)
                                }
                              >
                                {(selectMode ? sel : item.checked) ? '✓' : ''}
                              </button>
                              <button
                                className="row-main"
                                onClick={() =>
                                  selectMode ? toggleSelect(item.id!) : setSheet(item)
                                }
                              >
                                <span className="row-name-wrap">
                                  {isFav && <span className="row-fav">★</span>}
                                  <span className="name">{item.displayName}</span>
                                </span>
                                <span className="row-meta">
                                  {p != null && (
                                    <span className="price">
                                      ${(p * (item.quantity ?? 1)).toFixed(2)}
                                    </span>
                                  )}
                                  {formatQty(item) && (
                                    <span className="qty">{formatQty(item)}</span>
                                  )}
                                </span>
                              </button>
                            </>
                          )
                          if (selectMode) {
                            return (
                              <li key={item.id} className={cls}>
                                {content}
                              </li>
                            )
                          }
                          return (
                            <SwipeRow
                              key={item.id}
                              rowClassName={cls}
                              onCheck={() => toggle(item)}
                              onDelete={() =>
                                removeWithUndo([item], `Removed “${item.displayName}”`)
                              }
                            >
                              {content}
                            </SwipeRow>
                          )
                        })}
                      </ul>
                    </section>
                  ),
              )
            )}
          </>
        )}

        {tab === 'recipes' && (
          <RecipesView
            onAddRecipe={() => setCapture('text')}
            onAdded={() => setTab('list')}
          />
        )}

        {tab === 'settings' && <SettingsView />}

        <div className="bottom-space" />
      </main>

      {tab === 'list' && selectMode && (
        <div className="select-bar">
          <button className="ghost" onClick={exitSelect}>
            Cancel
          </button>
          <button className="danger-btn" onClick={deleteSelected} disabled={selected.size === 0}>
            Remove {selected.size || ''}
          </button>
        </div>
      )}

      {tab === 'list' && !selectMode && (
        <button className="fab" aria-label="Add item" onClick={() => setAddMenuOpen(true)}>
          ＋
        </button>
      )}

      {toast && (
        <div className="toast" role="status">
          <span className="toast-msg">{toast.msg}</span>
          {toast.undo && (
            <button className="toast-action" onClick={doUndo}>
              Undo
            </button>
          )}
        </div>
      )}

      <BottomNav tab={tab} onChange={setTab} />

      {menuOpen && (
        <Sheet className="menu" onClose={() => setMenuOpen(false)}>
          <button
            className="menu-item"
            onClick={() => {
              setRefineOpen(true)
              setMenuOpen(false)
            }}
          >
            Refine list — options &amp; prices
          </button>
          <button className="menu-item" onClick={enterSelect}>
            Select &amp; remove items
          </button>
          <button className="menu-item" onClick={clearChecked}>
            Clear checked-off items
          </button>
          <button className="menu-item danger" onClick={clearAll}>
            Clear the list
          </button>
        </Sheet>
      )}

      {addMenuOpen && (
        <AddMenu
          onClose={() => setAddMenuOpen(false)}
          onPick={(m) => {
            setAddMenuOpen(false)
            if (m === 'one') setSheet('new')
            else if (m === 'quick') setQuickAddOpen(true)
            else setCapture(m)
          }}
        />
      )}

      {quickAddOpen && (
        <QuickAddSheet
          onClose={() => setQuickAddOpen(false)}
          onAddNew={() => {
            setQuickAddOpen(false)
            setSheet('new')
          }}
        />
      )}

      {refineOpen && <RefineSheet onClose={() => setRefineOpen(false)} />}

      {capture !== null && <CaptureSheet mode={capture} onClose={() => setCapture(null)} />}

      {sheet !== null && (
        <ItemSheet
          initial={sheet === 'new' ? null : sheet}
          defaultBacklog={view === 'backlog'}
          catalogPrice={sheet !== 'new' ? priceMap.get(sheet.canonicalKey) : undefined}
          catalogFavorite={sheet !== 'new' ? favSet.has(sheet.canonicalKey) : false}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  )
}

function ItemSheet({
  initial,
  defaultBacklog,
  catalogPrice,
  catalogFavorite,
  onClose,
}: {
  initial: Item | null
  defaultBacklog: boolean
  catalogPrice?: number
  catalogFavorite?: boolean
  onClose: () => void
}) {
  const [name, setName] = useState(initial?.displayName ?? '')
  const [qty, setQty] = useState(initial?.quantity != null ? String(initial.quantity) : '')
  const [unit, setUnit] = useState(initial?.unit ?? '')
  const [section, setSection] = useState<Section>(initial?.section ?? 'other')
  const [priceStr, setPriceStr] = useState(catalogPrice != null ? String(catalogPrice) : '')
  const [fav, setFav] = useState(Boolean(catalogFavorite))

  const editing = initial != null

  const toggleFav = async () => {
    if (!editing) return
    const next = !fav
    setFav(next)
    await setFavoriteByKey(
      initial!.canonicalKey,
      name.trim() || initial!.displayName,
      section,
      next,
      unit.trim() || undefined,
    )
  }

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
      const pp = priceStr.trim() ? Number(priceStr) : undefined
      await savePrice(
        initial!.canonicalKey,
        trimmed,
        section,
        Number.isFinite(pp as number) ? pp : undefined,
      )
      await syncCatalogName(initial!.canonicalKey, trimmed, unit.trim() || undefined)
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
      await db.items.update(initial!.id!, { backlog: !initial!.backlog, checked: false })
    onClose()
  }

  return (
    <Sheet onClose={onClose}>
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

      {editing && (
        <div className="price-row">
          <span className="price-label">Price $</span>
          <input
            className="field"
            placeholder="e.g. 3.49"
            inputMode="decimal"
            value={priceStr}
            onChange={(e) => setPriceStr(e.target.value)}
          />
        </div>
      )}

      <button className="primary" onClick={save}>
        {editing ? 'Save' : 'Add to ' + (defaultBacklog ? 'Next time' : 'list')}
      </button>

      {editing && (
        <>
          <button
            className={fav ? 'ghost fav-btn on' : 'ghost fav-btn'}
            onClick={toggleFav}
            style={{ marginTop: 10 }}
          >
            {fav ? '★ Favorited — shows in Quick add' : '☆ Add to favorites'}
          </button>
          <div className="edit-actions">
            <button className="ghost" onClick={moveBacklog}>
              {initial!.backlog ? '↑ Move to list' : '↓ Save for next time'}
            </button>
            <button className="ghost danger" onClick={remove}>
              Delete
            </button>
          </div>
        </>
      )}
    </Sheet>
  )
}
