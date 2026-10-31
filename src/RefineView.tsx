import { useEffect, useState } from 'react'
import { useDialog } from './ds/useDialog'
import { db, type Item, type Section } from './db'
import { applyRefinement, setAisle } from './catalog'
import { refineItems, type RefineOption } from './parse'
import { fitOptions } from './fit'
import { Icon } from './Icon'
import { PlacePanel } from './PlacePanel'
import { SECTIONS } from './sections'
import { AISLE_EVENT } from './aisles'
import { readSetting, setSetting } from './prefs'

type Stage = 'ask' | 'loading' | 'ready' | 'empty' | 'error'

/** Refine asks where you shop once per device; after that it is a chip. */
const ASKED_KEY = 'mise.refineAsked'
const hasAsked = () => {
  try {
    return localStorage.getItem(ASKED_KEY) === '1'
  } catch {
    return true
  }
}

/** A clean item name from a refine option: the full label minus its trailing
 *  size, so "Store brand salsa, 16 oz jar" (unit "16 oz jar") → "Store brand
 *  salsa". Falls back to the whole label if the size isn't at the end. */
export function conciseName(label: string, unit?: string): string {
  const full = label.trim()
  const u = (unit ?? '').trim()
  if (!u) return full
  const esc = u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const stripped = full.replace(new RegExp(',?\\s*' + esc + '\\s*$', 'i'), '').replace(/[,\s]+$/, '')
  return stripped.trim() || full
}

export function RefineSheet({ listId, onClose }: { listId: number; onClose: () => void }) {
  const [store, setStore] = useState(() => readSetting('mise.store') ?? '')
  const [area, setArea] = useState(() => readSetting('mise.area') ?? '')
  // The question comes first only when there is nothing to go on yet.
  const [asking, setAsking] = useState(() => !store && !area && !hasAsked())
  const [panel, setPanel] = useState(false)
  const [stage, setStage] = useState<Stage>(asking ? 'ask' : 'loading')
  const [error, setError] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [options, setOptions] = useState<Map<string, RefineOption[]>>(new Map())
  const [applied, setApplied] = useState<Record<string, string>>({})

  useEffect(() => {
    if (asking) return
    let cancelled = false
    setStage('loading')
    ;(async () => {
      const active = (await db.items.toArray()).filter(
        (i) => i.listId === listId && !i.backlog,
      )
      if (cancelled) return
      if (active.length === 0) {
        setStage('empty')
        return
      }
      setItems(active)
      try {
        const res = await refineItems(
          store,
          active.map((i) => ({ canonicalKey: i.canonicalKey, displayName: i.displayName, unit: i.unit })),
          area,
        )
        if (cancelled) return
        setOptions(new Map(res.map((r) => [r.canonicalKey, r.options])))
        setStage('ready')
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setStage('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [store, area, listId, asking])

  const applyPlace = (s: string, a: string) => {
    try {
      localStorage.setItem(ASKED_KEY, '1')
    } catch {
      /* asked again next time, which is harmless */
    }
    setPanel(false)
    setAsking(false)
    if (s === store && a === area) return
    void setSetting('mise.store', s)
    void setSetting('mise.area', a)
    // The aisle order is kept per store, so the list regroups for the new one.
    window.dispatchEvent(new CustomEvent(AISLE_EVENT))
    setApplied({})
    setStore(s)
    setArea(a)
  }

  /** File an item in a different aisle by hand: the row and the catalog. */
  const moveToAisle = async (item: Item, section: Section) => {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, section } : i)))
    try {
      await setAisle(item.id!, item.canonicalKey, section)
    } catch (e) {
      // The row did not move, so the picker must not say it did.
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, section: item.section } : i)))
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const apply = async (item: Item, opt: RefineOption) => {
    // Optimistic: show the choice immediately, before the DB round-trip, so a
    // tap always registers even if the writes are slow or fail.
    setApplied((a) => ({ ...a, [item.canonicalKey]: opt.label }))
    try {
      // Set the Buy layer (count × size + packaging) and a clean product name
      // (no size — that's the pill); keep the full product string as `detail`
      // (shown on tap), and re-file into the aisle the chosen product lives in.
      // The recipe Need (quantity/unit) is left untouched so servings can still
      // scale. Fall back to the item's current section if a stale server omits it.
      const sizeStr = [
        opt.sizeAmount != null && opt.sizeUnit ? `${opt.sizeAmount} ${opt.sizeUnit}` : '',
        opt.packaging ?? '',
      ]
        .filter(Boolean)
        .join(' ')
        .trim()
      const name = conciseName(opt.label, sizeStr)
      const section = opt.section ?? item.section
      const buyCount = opt.count && opt.count > 0 ? opt.count : 1
      const buy = {
        buyCount,
        sizeAmount: opt.sizeAmount ?? undefined,
        sizeUnit: opt.sizeUnit ?? undefined,
        packaging: opt.packaging ?? undefined,
      }
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, section } : i)))
      await db.items.update(item.id!, { displayName: name, detail: opt.label, section, ...buy })
      await applyRefinement(item.canonicalKey, {
        displayName: name,
        detail: opt.label,
        section,
        price: opt.price,
        ...buy,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const dialogRef = useDialog(onClose)

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="refine-title"
      tabIndex={-1}
      className="fullview refine-view"
    >
      <div className="fullview-head">
        <button className="icon-back" onClick={onClose} aria-label="Back to list">
          <Icon name="back" size={22} />
        </button>
        <h2 className="detail-title" id="refine-title">Refine Your List</h2>
      </div>

      <div className="fullview-body">
        {stage === 'ask' ? (
          <PlacePanel store={store} area={area} first onApply={applyPlace} onCancel={() => {}} />
        ) : (
          <>
            <button
              className="store-chip"
              type="button"
              aria-expanded={panel}
              onClick={() => setPanel((p) => !p)}
            >
              <span>
                {store || 'A typical store'}
                {area ? ` · ${area}` : ''}
              </span>
              <Icon name="chevronDown" size={16} />
            </button>
            {panel && (
              <PlacePanel
                store={store}
                area={area}
                first={false}
                onApply={applyPlace}
                onCancel={() => setPanel(false)}
              />
            )}
          </>
        )}

        {stage === 'loading' && (
          <div className="loading">
            <div className="spinner" />
            <p>Finding options{store ? ` at ${store}` : ''}{area ? ` near ${area}` : ''}…</p>
          </div>
        )}

        {stage === 'empty' && <p className="review-hint">Your list is empty.</p>}
        {stage === 'error' && <p className="err-text">{error}</p>}

        {stage === 'ready' && (
          <>
            <p className="review-hint">
              Tap an option to sharpen the name &amp; price
              {store ? ` at ${store}` : ''}. Prices are estimates.
            </p>
            <div className="refine-list">
              {items.map((item) => {
                const opts = options.get(item.canonicalKey) ?? []
                const chosen = applied[item.canonicalKey]
                const fits = fitOptions(item, opts)
                return (
                  <div key={item.id} className="refine-card">
                    <div className="refine-item">
                      {item.displayName}
                      {chosen && (
                        <span className="refine-done">
                          <Icon name="check" size={13} strokeWidth={3} /> {chosen}
                        </span>
                      )}
                    </div>
                    <label className="refine-aisle">
                      <span>Aisle</span>
                      <select
                        value={item.section}
                        onChange={(e) => void moveToAisle(item, e.target.value as Section)}
                      >
                        {SECTIONS.map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {opts.length === 0 ? (
                      <p className="refine-none">No options suggested.</p>
                    ) : (
                      <div className="refine-opts">
                        {opts.map((opt, i) => {
                          const fit = fits[i]
                          return (
                            <button
                              key={i}
                              type="button"
                              className={chosen === opt.label ? 'ropt on' : 'ropt'}
                              onClick={() => apply(item, opt)}
                            >
                              <span className="ropt-main">
                                <span className="ropt-label">{opt.label}</span>
                                {fit && (
                                  <span className={`ropt-fit ${fit.kind}`}>
                                    {fit.best && <span className="ropt-best">Best fit</span>}
                                    {fit.text}
                                    {fit.packsText && ` · ${fit.packsText}`}
                                  </span>
                                )}
                              </span>
                              <span className="ropt-price">${opt.price.toFixed(2)}</span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      <div className="fullview-foot">
        <button className="primary" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  )
}
