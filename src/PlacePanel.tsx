import { useState } from 'react'
import { nearestTown } from './cities'

/**
 * Where you shop, for Refine: a store and an area (a ZIP or a town).
 *
 * Both go to the AI service so it can name the products and price at the
 * level of that chain in that region, and the panel says so in words. The
 * device's location is only ever asked for by tapping "Use My Location", is
 * turned into the nearest town here in the browser (cities.ts), and what is
 * kept is that town name, which can be edited. Nothing else leaves the phone.
 *
 * The chain list is short and fixed on purpose. There is no store locator
 * behind it, so it is "Common stores", never "Near you".
 */
const CHAINS = [
  'Walmart', 'Aldi', 'Kroger', 'Target', 'Costco', "Sam's Club", 'Safeway', 'Albertsons',
  'Publix', 'Harps', 'H-E-B', 'Meijer', 'Whole Foods', "Trader Joe's", 'Wegmans', 'Food Lion',
]

export function PlacePanel({
  store,
  area,
  first,
  onApply,
  onCancel,
}: {
  store: string
  area: string
  /** The first time Refine opens with neither set: a question, not a setting. */
  first: boolean
  onApply: (store: string, area: string) => void
  onCancel: () => void
}) {
  const [storeDraft, setStoreDraft] = useState(store)
  const [areaDraft, setAreaDraft] = useState(area)
  const [locBusy, setLocBusy] = useState(false)
  const [locMsg, setLocMsg] = useState('')

  const locate = () => {
    if (!navigator.geolocation) {
      setLocMsg('This browser can’t share a location. Type a ZIP or town instead.')
      return
    }
    setLocBusy(true)
    setLocMsg('')
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setAreaDraft(nearestTown(p.coords.latitude, p.coords.longitude))
        setLocBusy(false)
        setLocMsg('The nearest big town in our list. Edit it if it’s off.')
      },
      () => {
        setLocBusy(false)
        setLocMsg('Couldn’t get your location. Type a ZIP or town instead.')
      },
      { maximumAge: 600_000, timeout: 10_000 },
    )
  }

  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

  return (
    <div className="place-panel">
      {first && <h3 className="place-title">Where Do You Shop?</h3>}
      <label className="place-label" htmlFor="place-area">
        Your area
      </label>
      <div className="place-row">
        <input
          id="place-area"
          className="field"
          placeholder="ZIP or town, e.g. 72701"
          value={areaDraft}
          maxLength={60}
          onChange={(e) => setAreaDraft(e.target.value)}
        />
        <button className="ghost" type="button" onClick={locate} disabled={locBusy}>
          {locBusy ? 'Locating…' : 'Use My Location'}
        </button>
      </div>
      {locMsg && <p className="group-hint">{locMsg}</p>}

      <label className="place-label" htmlFor="place-store">
        Your store
      </label>
      <input
        id="place-store"
        className="field"
        placeholder="Store name, or pick one"
        value={storeDraft}
        maxLength={60}
        onChange={(e) => setStoreDraft(e.target.value)}
      />
      <div className="chips" role="group" aria-label="Common stores">
        {CHAINS.map((c) => (
          <button
            key={c}
            type="button"
            className={same(storeDraft, c) ? 'chip on' : 'chip'}
            onClick={() => setStoreDraft(c)}
          >
            {c}
          </button>
        ))}
      </div>

      <p className="group-hint">
        Your store and ZIP or town are sent to the AI service to find products and
        prices. Your device’s location is only used when you tap Use My Location, and
        it stays on your phone: only the town name is kept.
      </p>

      <div className="two-btn">
        <button
          className="primary"
          type="button"
          onClick={() => onApply(storeDraft.trim(), areaDraft.trim())}
        >
          Find Options
        </button>
        {first ? (
          <button className="ghost" type="button" onClick={() => onApply('', '')}>
            Use a Typical Store
          </button>
        ) : (
          <button className="ghost" type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}
