import { useState } from 'react'
import type { Section } from './db'
import { getAisleOrder, hasCustomOrder, resetAisleOrder, setAisleOrder } from './aisles'
import { readSetting } from './prefs'
import { SECTION_META } from './sections'
import { Icon } from './Icon'
import { Sheet } from './Sheet'

/**
 * The aisle walk for the store you shop at, opened from the list's menu: that
 * is where you notice the order is wrong. The order is kept per store name
 * (aisles.ts) and the store is picked in Refine, so this edits whatever store
 * Refine last settled on. Saving regroups the list live (AISLE_EVENT).
 */
export function AisleOrderSheet({ onClose }: { onClose: () => void }) {
  const store = (readSetting('mise.store') ?? '').trim()
  const [order, setOrder] = useState<Section[]>(() => getAisleOrder(store))
  const [custom, setCustom] = useState(() => hasCustomOrder(store))

  const move = (from: number, dir: -1 | 1) => {
    const to = from + dir
    if (to < 0 || to >= order.length) return
    const next = order.slice()
    ;[next[from], next[to]] = [next[to], next[from]]
    setOrder(next)
    setAisleOrder(store, next)
    setCustom(true)
  }
  const reset = () => {
    resetAisleOrder(store)
    setOrder(getAisleOrder(store))
    setCustom(false)
  }

  return (
    <Sheet className="aislesheet" label="Aisle order" onClose={onClose}>
      <h3 className="sheet-title">Aisle Order</h3>
      <p className="group-hint">
        The order your list groups sections while you shop. Arrange it to match{' '}
        {store ? `${store}’s` : 'your store’s'} layout. Pick the store in Refine.
      </p>
      <ul className="aisle-editor">
        {order.map((s, i) => (
          <li key={s} className="aisle-row">
            <span className="aisle-name">{SECTION_META[s].label}</span>
            <div className="aisle-moves">
              <button
                className="aisle-move"
                aria-label={`Move ${SECTION_META[s].label} up`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <Icon name="chevronUp" size={18} />
              </button>
              <button
                className="aisle-move"
                aria-label={`Move ${SECTION_META[s].label} down`}
                disabled={i === order.length - 1}
                onClick={() => move(i, 1)}
              >
                <Icon name="chevronDown" size={18} />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button className="ghost" onClick={reset} disabled={!custom}>
        Reset to Store-Walk Default
      </button>
    </Sheet>
  )
}
