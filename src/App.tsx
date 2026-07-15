import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Item, type List, type Section } from './db'
import { SECTIONS, SECTION_META } from './sections'
import {
  addItem,
  formatDue,
  formatQty,
  fromDateInput,
  groupByDue,
  groupBySection,
  toDateInput,
  type Group,
} from './list'
import { KINDS } from './kinds'
import {
  addOutToGroceries,
  defaultGroceryListId,
  resolveActiveId,
  restockFromPurchase,
  restoreList,
  undoRestock,
  writeActiveId,
} from './lists'
import { AddMenu, AddRecipeMenu, CaptureSheet, type CaptureMode } from './Capture'
import { SettingsView } from './Settings'
import { RecipesView } from './RecipesView'
import { QuickAddSheet } from './QuickAdd'
import { RefineSheet } from './RefineView'
import { setPrice as savePrice, setFavoriteByKey, syncCatalogName } from './catalog'
import { Sheet } from './Sheet'
import { SwipeRow } from './SwipeRow'
import { BottomNav, type Tab } from './BottomNav'
import { RecipeForm } from './RecipeForm'
import { ListSwitcher, ManageLists } from './ListSwitcher'
import { ImportSheet } from './ImportSheet'
import { decodeShare, encodeShare, shareLink, shareListPayload, type SharePayload } from './share'
import { AI_ENABLED, EDITION_NAME } from './edition'

type ListView = 'list' | 'backlog'
type SheetState = null | 'new' | Item

export default function App() {
  const [activeId, setActiveId] = useState<number | null>(null)
  const [pending, setPending] = useState<SharePayload | null>(null)

  // Left undefined while loading, so we can tell "not loaded yet" from "none".
  const listsRaw = useLiveQuery(() => db.lists.toArray(), [])
  const lists = listsRaw ?? []
  const allItems = useLiveQuery(() => db.items.toArray(), []) ?? []
  const catalog = useLiveQuery(() => db.catalog.toArray(), []) ?? []

  const [tab, setTab] = useState<Tab>('list')
  const [view, setView] = useState<ListView>('list')
  const [sheet, setSheet] = useState<SheetState>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [capture, setCapture] = useState<null | CaptureMode>(null)
  const [captureForRecipe, setCaptureForRecipe] = useState(false)
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const [refineOpen, setRefineOpen] = useState(false)
  const [recipeFormOpen, setRecipeFormOpen] = useState(false)
  const [recipeMenuOpen, setRecipeMenuOpen] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [toast, setToast] = useState<{ msg: string; undo?: () => void } | null>(null)
  const [showHint, setShowHint] = useState(() => !localStorage.getItem('mise.swipeHint'))
  const undoTimer = useRef<number | undefined>(undefined)

  // Seed the DB and settle on a list before rendering anything list-shaped.
  useEffect(() => {
    resolveActiveId().then(setActiveId)
  }, [])

  // An inbound share link. The payload lives in the hash, so it never left the
  // sender's device for a server — we just decode it and ask what to do.
  // Opening a link while the app is *already* open only changes the hash (no
  // reload), so we have to listen for that too or the link silently does nothing.
  useEffect(() => {
    const consume = () => {
      if (!location.hash.startsWith('#i=')) return
      const hash = location.hash
      history.replaceState(null, '', location.pathname + location.search)
      decodeShare(hash).then((p) => {
        if (p) setPending(p)
        else showToast('That share link looks broken.')
      })
    }
    consume()
    window.addEventListener('hashchange', consume)
    return () => window.removeEventListener('hashchange', consume)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeList: List | undefined = useMemo(
    () => lists.find((l) => l.id === activeId),
    [lists, activeId],
  )
  const kind = activeList ? KINDS[activeList.kind] : KINDS.grocery

  // Safety net: if the active list ever disappears (merged away, deleted from
  // another tab), land somewhere real rather than rendering an empty app.
  useEffect(() => {
    if (!listsRaw || activeId == null) return
    if (listsRaw.some((l) => l.id === activeId)) return
    resolveActiveId().then(setActiveId)
  }, [listsRaw, activeId])

  const items = useMemo(
    () => (activeId == null ? [] : allItems.filter((i) => i.listId === activeId)),
    [allItems, activeId],
  )

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
  const remaining = active.filter((i) => !i.checked).length

  // Pantry reads "checked" as out-of-stock; grocery/tasks read it as done.
  const outCount = kind.kind === 'pantry' ? active.filter((i) => i.checked).length : 0

  const groups: Group[] = useMemo(() => {
    const rows = view === 'list' ? active : backlog
    if (view === 'backlog')
      return rows.length ? [{ key: 'backlog', label: '', emoji: '', items: rows }] : []
    if (kind.due) return groupByDue(rows, Date.now())
    if (kind.sections) return groupBySection(rows, SECTION_META)
    return rows.length ? [{ key: 'all', label: '', emoji: '', items: rows }] : []
  }, [active, backlog, view, kind])

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

  /**
   * Clearing checked-off groceries means "I bought these" — so anything they
   * match in a pantry goes back to in-stock. That's the loop closing.
   */
  const clearChecked = async () => {
    const rows = active.filter((i) => i.checked)
    if (!rows.length) return
    setMenuOpen(false)
    const restocked = kind.kind === 'grocery' ? await restockFromPurchase(rows) : []
    await db.items.bulkDelete(rows.map((r) => r.id!))
    const msg = restocked.length
      ? `Cleared ${rows.length} · restocked ${restocked.length} in your pantry`
      : `Cleared ${rows.length} checked-off`
    showToast(msg, async () => {
      await db.items.bulkAdd(rows)
      await undoRestock(restocked)
      setToast(null)
    })
  }

  const clearAll = () => {
    removeWithUndo([...active], `Cleared ${activeList?.name ?? 'list'} (${active.length})`)
    setMenuOpen(false)
  }

  const restock = async () => {
    if (activeId == null) return
    const target = await defaultGroceryListId(activeId)
    setMenuOpen(false)
    if (target == null) {
      showToast('No grocery list to add to — make one first.')
      return
    }
    const n = await addOutToGroceries(activeId, target)
    const name = lists.find((l) => l.id === target)?.name ?? 'Groceries'
    showToast(n ? `Added ${n} to “${name}”` : 'Nothing marked out.')
  }

  const doShareList = async () => {
    if (!activeList?.id) return
    setMenuOpen(false)
    const payload = await shareListPayload(activeList.id, activeList.name, activeList.kind)
    if (!payload || (payload.t === 'list' && payload.items.length === 0)) {
      showToast('Nothing to share — the list is empty.')
      return
    }
    const url = await encodeShare(payload)
    const how = await shareLink(url, activeList.name)
    if (how === 'copied') showToast('Link copied to clipboard')
    else if (how === 'failed') showToast('Could not share that link.')
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

  const switchTo = (id: number) => {
    writeActiveId(id)
    setActiveId(id)
    setSwitcherOpen(false)
    setView('list')
    setTab('list')
  }

  const closeAll = () => {
    setMenuOpen(false)
    setAddMenuOpen(false)
    setCapture(null)
    setCaptureForRecipe(false)
    setQuickAddOpen(false)
    setRefineOpen(false)
    setRecipeFormOpen(false)
    setRecipeMenuOpen(false)
    setSwitcherOpen(false)
    setManageOpen(false)
    setPending(null)
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
    recipeFormOpen ||
    recipeMenuOpen ||
    switcherOpen ||
    manageOpen ||
    pending !== null ||
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

  // One-time reconcile of catalog names against the current items.
  useEffect(() => {
    ;(async () => {
      for (const it of await db.items.toArray()) {
        await syncCatalogName(it.canonicalKey, it.displayName, it.unit)
      }
    })()
  }, [])

  if (activeId == null || !activeList) {
    return <div className="app" />
  }

  const isEmpty = groups.every((g) => g.items.length === 0)

  return (
    <div className="app">
      <header className="topbar">
        {tab === 'list' ? (
          <button className="list-pick" onClick={() => setSwitcherOpen(true)}>
            <span className="list-pick-icon">{kind.icon}</span>
            <span className="list-pick-name">{activeList.name}</span>
            <span className="list-pick-caret">▾</span>
          </button>
        ) : (
          <div className="brand">
            <img className="logo-img" src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />{' '}
            {EDITION_NAME}
          </div>
        )}
        {tab === 'list' && (
          <button className="icon-btn" aria-label="List actions" onClick={() => setMenuOpen(true)}>
            ⋯
          </button>
        )}
      </header>

      <main className="scroll">
        {tab === 'list' && (
          <>
            {kind.backlog && (
              <div className="tabs" role="tablist">
                <button
                  role="tab"
                  className={view === 'list' ? 'tab active' : 'tab'}
                  onClick={() => setView('list')}
                >
                  {kind.kind === 'pantry' ? 'Pantry' : 'List'}
                  {remaining > 0 && <span className="badge">{remaining}</span>}
                </button>
                <button
                  role="tab"
                  className={view === 'backlog' ? 'tab active' : 'tab'}
                  onClick={() => setView('backlog')}
                >
                  {kind.backlogLabel}
                  {backlog.length > 0 && <span className="badge">{backlog.length}</span>}
                </button>
              </div>
            )}

            {view === 'list' && !selectMode && kind.prices && active.length > 0 && pricedCount > 0 && (
              <button className="subtotal" onClick={() => setTab('settings')}>
                <span className="subtotal-amt">~${total.toFixed(2)}</span>
                <span className="subtotal-sub">
                  est. · {pricedCount}/{active.length} priced
                </span>
              </button>
            )}

            {view === 'list' && kind.kind === 'pantry' && outCount > 0 && !selectMode && (
              <button className="restock-bar" onClick={restock}>
                <span className="restock-n">{outCount} out</span>
                <span className="restock-cta">🛒 Add to groceries</span>
              </button>
            )}

            {showHint && !selectMode && active.length > 0 && (
              <div className="hint-banner">
                <span>
                  Swipe a row → {kind.checkVerb.toLowerCase()} · ← delete
                </span>
                <button className="hint-x" aria-label="Dismiss" onClick={dismissHint}>
                  ✕
                </button>
              </div>
            )}

            {isEmpty ? (
              <div className="empty">
                <div className="empty-emoji">
                  {view === 'list' ? kind.emptyEmoji : '💭'}
                </div>
                <p>
                  {view === 'list'
                    ? kind.emptyText
                    : `Nothing parked for ${kind.backlogLabel.toLowerCase()}.`}
                </p>
                <p className="hint">{kind.emptyHint}</p>
              </div>
            ) : (
              groups.map((g) => (
                <section key={g.key} className="group">
                  {g.label && (
                    <h2 className="group-head">
                      <span className="group-emoji">{g.emoji}</span>
                      {g.label}
                    </h2>
                  )}
                  <ul className="rows">
                    {g.items.map((item) => {
                      const sel = selected.has(item.id!)
                      const isFav = favSet.has(item.canonicalKey)
                      const out = kind.kind === 'pantry' && item.checked
                      const cls = selectMode
                        ? sel
                          ? 'row selected'
                          : 'row'
                        : item.checked
                          ? out
                            ? 'row out'
                            : 'row done'
                          : 'row'
                      const p = kind.prices ? priceMap.get(item.canonicalKey) : undefined
                      const due =
                        kind.due && item.dueAt != null
                          ? formatDue(item.dueAt, Date.now())
                          : null
                      const content = (
                        <>
                          <button
                            className="check"
                            aria-label={
                              selectMode ? 'Select' : item.checked ? 'Undo' : kind.checkVerb
                            }
                            onClick={() => (selectMode ? toggleSelect(item.id!) : toggle(item))}
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
                              {isFav && kind.kind !== 'tasks' && <span className="row-fav">★</span>}
                              <span className="row-text">
                                <span className="name">{item.displayName}</span>
                                {kind.due && item.notes && (
                                  <span className="row-notes">{item.notes}</span>
                                )}
                              </span>
                            </span>
                            <span className="row-meta">
                              {due && <span className={`due due-${due.tone}`}>{due.text}</span>}
                              {p != null && (
                                <span className="price">
                                  ${(p * (item.quantity ?? 1)).toFixed(2)}
                                </span>
                              )}
                              {kind.quantities && formatQty(item) && (
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
              ))
            )}
          </>
        )}

        {tab === 'recipes' && (
          <RecipesView
            activeListId={activeId}
            // With AI on, offer all the capture methods; in Lite, straight to
            // the manual form (it'd be the menu's only option).
            onAddRecipe={() =>
              AI_ENABLED ? setRecipeMenuOpen(true) : setRecipeFormOpen(true)
            }
            onAdded={(listId) => {
              // A recipe can't go on a pantry or task list, so it may have
              // landed somewhere other than where you were standing — take you
              // there, or it just looks like nothing happened.
              const moved = listId !== activeId
              const name = lists.find((l) => l.id === listId)?.name ?? 'your list'
              if (moved) switchTo(listId)
              else setTab('list')
              if (moved) showToast(`Added to “${name}”`)
            }}
            onToast={showToast}
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
          <button className="menu-item" onClick={doShareList}>
            Share this list
          </button>
          {kind.kind === 'pantry' && (
            <button className="menu-item" onClick={restock}>
              Add everything out to groceries
            </button>
          )}
          {AI_ENABLED && kind.recipes && (
            <button
              className="menu-item"
              onClick={() => {
                setRefineOpen(true)
                setMenuOpen(false)
              }}
            >
              Refine list — options &amp; prices
            </button>
          )}
          <button className="menu-item" onClick={enterSelect}>
            Select &amp; remove items
          </button>
          {/* A pantry's "checked" means out-of-stock — you restock those, you
              don't clear them — so this only makes sense for grocery/tasks. */}
          {kind.kind !== 'pantry' && (
            <button className="menu-item" onClick={clearChecked}>
              Clear {kind.kind === 'tasks' ? 'completed' : 'checked-off'} items
            </button>
          )}
          <button className="menu-item danger" onClick={clearAll}>
            Clear the list
          </button>
        </Sheet>
      )}

      {switcherOpen && (
        <ListSwitcher
          activeId={activeId}
          onPick={switchTo}
          onManage={() => {
            setSwitcherOpen(false)
            setManageOpen(true)
          }}
          onClose={() => setSwitcherOpen(false)}
        />
      )}

      {manageOpen && (
        <ManageLists
          activeId={activeId}
          onClose={() => setManageOpen(false)}
          onMerged={(from, to, n) => {
            // The list you were standing on may have just been merged away.
            if (from.id === activeId) switchTo(to.id!)
            showToast(`Merged ${n} from “${from.name}” into “${to.name}”`)
          }}
          onDeleted={async (snap) => {
            if (snap.list.id === activeId) setActiveId(await resolveActiveId())
            showToast(`Deleted “${snap.list.name}”`, async () => {
              await restoreList(snap)
              setToast(null)
            })
          }}
        />
      )}

      {pending && (
        <ImportSheet
          payload={pending}
          activeListId={activeId}
          onClose={() => setPending(null)}
          onDone={(msg, listId) => {
            setPending(null)
            if (listId != null) switchTo(listId)
            showToast(msg)
          }}
        />
      )}

      {addMenuOpen && (
        <AddMenu
          kind={activeList.kind}
          onClose={() => setAddMenuOpen(false)}
          onPick={(m) => {
            setAddMenuOpen(false)
            if (m === 'one') setSheet('new')
            else if (m === 'quick') setQuickAddOpen(true)
            else {
              setCaptureForRecipe(false)
              setCapture(m)
            }
          }}
        />
      )}

      {recipeMenuOpen && (
        <AddRecipeMenu
          onClose={() => setRecipeMenuOpen(false)}
          onPick={(m) => {
            setRecipeMenuOpen(false)
            if (m === 'manual') setRecipeFormOpen(true)
            else {
              setCaptureForRecipe(true)
              setCapture(m)
            }
          }}
        />
      )}

      {quickAddOpen && (
        <QuickAddSheet
          listId={activeId}
          onClose={() => setQuickAddOpen(false)}
          onAddNew={() => {
            setQuickAddOpen(false)
            setSheet('new')
          }}
        />
      )}

      {refineOpen && <RefineSheet listId={activeId} onClose={() => setRefineOpen(false)} />}

      {recipeFormOpen && <RecipeForm onClose={() => setRecipeFormOpen(false)} />}

      {capture !== null && (
        <CaptureSheet
          listId={activeId}
          mode={capture}
          forRecipe={captureForRecipe}
          onClose={() => {
            setCapture(null)
            setCaptureForRecipe(false)
          }}
        />
      )}

      {sheet !== null && (
        <ItemSheet
          listId={activeId}
          kindKey={activeList.kind}
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
  listId,
  kindKey,
  initial,
  defaultBacklog,
  catalogPrice,
  catalogFavorite,
  onClose,
}: {
  listId: number
  kindKey: List['kind']
  initial: Item | null
  defaultBacklog: boolean
  catalogPrice?: number
  catalogFavorite?: boolean
  onClose: () => void
}) {
  const kind = KINDS[kindKey]
  const [name, setName] = useState(initial?.displayName ?? '')
  const [qty, setQty] = useState(initial?.quantity != null ? String(initial.quantity) : '')
  const [unit, setUnit] = useState(initial?.unit ?? '')
  const [section, setSection] = useState<Section>(initial?.section ?? 'other')
  const [priceStr, setPriceStr] = useState(catalogPrice != null ? String(catalogPrice) : '')
  const [fav, setFav] = useState(Boolean(catalogFavorite))
  const [dueStr, setDueStr] = useState(initial?.dueAt != null ? toDateInput(initial.dueAt) : '')
  const [notes, setNotes] = useState(initial?.notes ?? '')

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
    const quantity =
      kind.quantities && Number.isFinite(parsed as number) ? parsed : undefined
    const dueAt = kind.due ? fromDateInput(dueStr) : undefined

    if (editing) {
      await db.items.update(initial!.id!, {
        displayName: trimmed,
        quantity,
        unit: kind.quantities ? unit.trim() || undefined : undefined,
        section,
        dueAt,
        notes: kind.due ? notes.trim() || undefined : undefined,
      })
      if (kind.prices) {
        const pp = priceStr.trim() ? Number(priceStr) : undefined
        await savePrice(
          initial!.canonicalKey,
          trimmed,
          section,
          Number.isFinite(pp as number) ? pp : undefined,
        )
      }
      await syncCatalogName(initial!.canonicalKey, trimmed, unit.trim() || undefined)
    } else {
      await addItem({
        listId,
        displayName: trimmed,
        quantity,
        unit: kind.quantities ? unit.trim() || undefined : undefined,
        section,
        backlog: defaultBacklog,
        dueAt,
        notes: kind.due ? notes.trim() || undefined : undefined,
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

  const addLabel = kind.due
    ? 'Add task'
    : 'Add to ' + (defaultBacklog ? kind.backlogLabel : kind.primaryLabel)

  return (
    <Sheet onClose={onClose}>
      <input
        className="field name-field"
        placeholder={kind.due ? 'What needs doing?' : 'What do you need?'}
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
      />

      {kind.quantities && (
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
      )}

      {kind.due && (
        <>
          <div className="due-row">
            <input
              className="field"
              type="date"
              value={dueStr}
              onChange={(e) => setDueStr(e.target.value)}
            />
            {dueStr && (
              <button className="ghost" onClick={() => setDueStr('')}>
                Clear
              </button>
            )}
          </div>
          <textarea
            className="field textarea notes-field"
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </>
      )}

      {kind.sections && (
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
      )}

      {editing && kind.prices && (
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
        {editing ? 'Save' : addLabel}
      </button>

      {editing && (
        <>
          {kind.kind !== 'tasks' && (
            <button
              className={fav ? 'ghost fav-btn on' : 'ghost fav-btn'}
              onClick={toggleFav}
              style={{ marginTop: 10 }}
            >
              {fav ? '★ Favorited — shows in Quick add' : '☆ Add to favorites'}
            </button>
          )}
          <div className="edit-actions">
            {kind.backlog && (
              <button className="ghost" onClick={moveBacklog}>
                {initial!.backlog ? '↑ Move to list' : `↓ Save for ${kind.backlogLabel.toLowerCase()}`}
              </button>
            )}
            <button className="ghost danger" onClick={remove}>
              Delete
            </button>
          </div>
        </>
      )}
    </Sheet>
  )
}
