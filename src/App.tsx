import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Item, type Section } from './db'
import { SECTIONS, SECTION_META } from './sections'
import { addItem, groupBySection, formatQty } from './list'
import { AddMenu, CaptureSheet, type CaptureMode } from './Capture'
import { SettingsSheet } from './Settings'
import { RecipesSheet } from './RecipesView'
import { QuickAddSheet } from './QuickAdd'
import { RefineSheet } from './RefineView'
import { setPrice as savePrice, setFavoriteByKey, syncCatalogName } from './catalog'
import { Sheet } from './Sheet'
import { SwipeRow } from './SwipeRow'

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
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const [refineOpen, setRefineOpen] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const catalog = useLiveQuery(() => db.catalog.toArray(), []) ?? []
  const priceMap = useMemo(
    () =>
      new Map(
        catalog.filter((c) => c.price != null).map((c) => [c.canonicalKey, c.price as number]),
      ),
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

  const toggle = (item: Item) =>
    db.items.update(item.id!, { checked: !item.checked })

  const clearChecked = () => db.items.filter((i) => !!i.checked && !i.backlog).delete()
  const clearAll = async () => {
    if (confirm('Clear the entire active list? (Backlog is kept.)'))
      await db.items.filter((i) => !i.backlog).delete()
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
    await db.items.bulkDelete([...selected])
    exitSelect()
  }

  const closeAll = () => {
    setMenuOpen(false)
    setAddMenuOpen(false)
    setCapture(null)
    setSettingsOpen(false)
    setRecipesOpen(false)
    setQuickAddOpen(false)
    setRefineOpen(false)
    setSheet(null)
    setSelectMode(false)
    setSelected(new Set())
  }

  // Android back button: close any open overlay instead of leaving the app.
  const anyOverlay =
    menuOpen ||
    addMenuOpen ||
    capture !== null ||
    settingsOpen ||
    recipesOpen ||
    quickAddOpen ||
    refineOpen ||
    sheet !== null ||
    selectMode
  useEffect(() => {
    if (!anyOverlay) return
    let poppedByBack = false
    window.history.pushState({ miseOverlay: true }, '')
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
  }, [anyOverlay])

  // One-time reconcile: sync catalog (favorites / Quick add) names to the current
  // list, fixing entries that predate name-syncing (e.g. items refined earlier).
  useEffect(() => {
    ;(async () => {
      for (const it of await db.items.toArray()) {
        await syncCatalogName(it.canonicalKey, it.displayName, it.unit)
      }
    })()
  }, [])

  const shown =
    view === 'list' ? groups : [{ section: 'other' as Section, items: backlog }]

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img className="logo-img" src={`${import.meta.env.BASE_URL}icon.svg`} alt="" /> Mise
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

      {view === 'list' && !selectMode && active.length > 0 && pricedCount > 0 && (
        <button className="subtotal" onClick={() => setSettingsOpen(true)}>
          <span className="subtotal-amt">~${total.toFixed(2)}</span>
          <span className="subtotal-sub">
            est. · {pricedCount}/{active.length} priced
          </span>
        </button>
      )}

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
                              {formatQty(item) && <span className="qty">{formatQty(item)}</span>}
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
                          onDelete={() => db.items.delete(item.id!)}
                          onFavorite={() =>
                            setFavoriteByKey(
                              item.canonicalKey,
                              item.displayName,
                              item.section,
                              true,
                              item.unit,
                            )
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
        <div className="bottom-space" />
      </main>

      {selectMode ? (
        <div className="select-bar">
          <button className="ghost" onClick={exitSelect}>
            Cancel
          </button>
          <button
            className="danger-btn"
            onClick={deleteSelected}
            disabled={selected.size === 0}
          >
            🗑 Remove {selected.size || ''}
          </button>
        </div>
      ) : (
        <button className="fab" aria-label="Add item" onClick={() => setAddMenuOpen(true)}>
          ＋
        </button>
      )}

      {menuOpen && (
        <Sheet className="menu" onClose={() => setMenuOpen(false)}>
          <button
            className="menu-item"
            onClick={() => {
              setRefineOpen(true)
              setMenuOpen(false)
            }}
          >
            🔎 Refine list (options &amp; prices)
          </button>
          <button className="menu-item" onClick={enterSelect}>
            ☑️ Select &amp; remove items
          </button>
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

      {capture !== null && (
        <CaptureSheet mode={capture} onClose={() => setCapture(null)} />
      )}

      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}

      {recipesOpen && (
        <RecipesSheet
          onClose={() => setRecipesOpen(false)}
          onAddRecipe={() => {
            setRecipesOpen(false)
            setCapture('text')
          }}
        />
      )}

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
      await db.items.update(initial!.id!, {
        backlog: !initial!.backlog,
        checked: false,
      })
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
                🗑 Delete
              </button>
            </div>
          </>
        )}
    </Sheet>
  )
}
