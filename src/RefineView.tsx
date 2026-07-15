import { useEffect, useState } from 'react'
import { db, type Item } from './db'
import { applyRefinement } from './catalog'
import { refineItems, type RefineOption } from './parse'
import { Sheet } from './Sheet'

type Stage = 'loading' | 'ready' | 'empty' | 'error'

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
  const store = localStorage.getItem('mise.store') ?? ''
  const [stage, setStage] = useState<Stage>('loading')
  const [error, setError] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [options, setOptions] = useState<Map<string, RefineOption[]>>(new Map())
  const [applied, setApplied] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
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
  }, [store, listId])

  const apply = async (item: Item, opt: RefineOption) => {
    // Update the name to a clean product name (no size — that's the pill), keep
    // the full product string as `detail` (shown on tap), and clear the recipe
    // quantity: you buy one package of this size whatever the recipe called for.
    const name = conciseName(opt.label, opt.unit)
    await db.items.update(item.id!, {
      displayName: name,
      detail: opt.label,
      unit: opt.unit,
      quantity: undefined,
    })
    await applyRefinement(item.canonicalKey, name, opt.label, opt.unit, item.section, opt.price)
    setApplied((a) => ({ ...a, [item.canonicalKey]: opt.label }))
  }

  return (
    <Sheet className="refine" onClose={onClose}>
      <h3 className="sheet-title">🔎 Refine your list</h3>

      {stage === 'loading' && (
        <div className="loading">
          <div className="spinner" />
          <p>Finding options{store ? ` at ${store}` : ''}…</p>
        </div>
      )}

      {stage === 'empty' && <p className="review-hint">Your list is empty.</p>}
      {stage === 'error' && <p className="err-text">{error}</p>}

      {stage === 'ready' && (
        <>
          <p className="review-hint">
            Pick a specific option to sharpen the name &amp; price
            {store ? ` at ${store}` : ' (set your store in Settings for better options)'}.
          </p>
          <div className="refine-list">
            {items.map((item) => {
              const opts = options.get(item.canonicalKey) ?? []
              const chosen = applied[item.canonicalKey]
              return (
                <div key={item.id} className="refine-card">
                  <div className="refine-item">
                    {item.displayName}
                    {chosen && <span className="refine-done">✓ {chosen}</span>}
                  </div>
                  {opts.length === 0 ? (
                    <p className="refine-none">No options suggested.</p>
                  ) : (
                    <div className="refine-opts">
                      {opts.map((opt, i) => (
                        <button
                          key={i}
                          className={chosen === opt.label ? 'ropt on' : 'ropt'}
                          onClick={() => apply(item, opt)}
                        >
                          <span className="ropt-label">{opt.label}</span>
                          <span className="ropt-price">${opt.price.toFixed(2)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </>
      )}
    </Sheet>
  )
}
