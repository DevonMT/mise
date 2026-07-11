import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, canonicalize } from './db'
import { PARSE_URL } from './parse'
import { estimateStorePrices } from './catalog'
import { Sheet } from './Sheet'

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const staples =
    useLiveQuery(async () => {
      const all = await db.staples.toArray()
      return all.sort((a, b) => a.displayName.localeCompare(b.displayName))
    }, []) ?? []
  const catalogCount = useLiveQuery(() => db.catalog.count(), []) ?? 0
  const [name, setName] = useState('')
  const [store, setStore] = useState(() => localStorage.getItem('mise.store') ?? '')
  const [busy, setBusy] = useState(false)
  const [priceMsg, setPriceMsg] = useState('')

  const add = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const canonicalKey = canonicalize(trimmed)
    const exists = await db.staples.where('canonicalKey').equals(canonicalKey).first()
    if (!exists) await db.staples.add({ canonicalKey, displayName: trimmed })
    setName('')
  }

  const estimate = async (mode: 'missing' | 'all') => {
    localStorage.setItem('mise.store', store.trim())
    setBusy(true)
    setPriceMsg('Estimating…')
    try {
      const n = await estimateStorePrices(store.trim(), mode)
      setPriceMsg(n ? `Priced ${n} item${n === 1 ? '' : 's'} for ${store.trim() || 'a typical store'}.` : 'Nothing to price.')
    } catch (e) {
      setPriceMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet className="settings" onClose={onClose}>
      <h3 className="sheet-title">Store prices</h3>
      <p className="review-hint">
        Set your store, then let Claude estimate prices for the {catalogCount} item
        {catalogCount === 1 ? '' : 's'} you've bought. Prices you edit by hand always win.
      </p>
      <input
        className="field"
        placeholder="Your store (e.g. Walmart, Aldi)"
        value={store}
        onChange={(e) => setStore(e.target.value)}
      />
      <div className="edit-actions" style={{ marginTop: 10 }}>
        <button className="ghost" onClick={() => estimate('missing')} disabled={busy}>
          Estimate missing
        </button>
        <button className="ghost" onClick={() => estimate('all')} disabled={busy}>
          Re-price all
        </button>
      </div>
      {priceMsg && <p className="review-hint">{busy ? '⏳ ' : ''}{priceMsg}</p>}

      <h3 className="sheet-title" style={{ marginTop: 22 }}>Staples you always have</h3>
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
    </Sheet>
  )
}
