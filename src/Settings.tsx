import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, canonicalize } from './db'
import { PARSE_URL } from './parse'
import { estimateStorePrices, priceableKeys } from './catalog'
import { AI_ENABLED } from './edition'

export function SettingsView() {
  const staples =
    useLiveQuery(async () => {
      const all = await db.staples.toArray()
      return all.sort((a, b) => a.displayName.localeCompare(b.displayName))
    }, []) ?? []
  // What a re-price would actually send: distinct items on your grocery lists,
  // not the whole history. Live so the count is honest before you tap.
  const priceCount =
    useLiveQuery(async () => (await priceableKeys()).size, []) ?? 0
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
      setPriceMsg(
        n
          ? `Priced ${n} item${n === 1 ? '' : 's'} for ${store.trim() || 'a typical store'}.`
          : 'Nothing to price.',
      )
    } catch (e) {
      setPriceMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="view">
      <h2 className="view-title">Settings</h2>

      {AI_ENABLED && (
        <section className="settings-group">
          <h3 className="group-title">Store prices</h3>
          <p className="group-hint">
            Set your store, then let Claude price the {priceCount} item
            {priceCount === 1 ? '' : 's'} on your grocery lists — only those, nothing you've removed.
            Prices you edit by hand always win.
          </p>
          <input
            className="field"
            placeholder="Your store (e.g. Walmart, Aldi)"
            value={store}
            onChange={(e) => setStore(e.target.value)}
          />
          <div className="two-btn">
            <button className="ghost" onClick={() => estimate('missing')} disabled={busy || !priceCount}>
              Price missing
            </button>
            <button className="ghost" onClick={() => estimate('all')} disabled={busy || !priceCount}>
              Re-price {priceCount || 'all'}
            </button>
          </div>
          {priceMsg && (
            <p className="group-hint">
              {busy ? '⏳ ' : ''}
              {priceMsg}
            </p>
          )}
        </section>
      )}

      <section className="settings-group">
        <h3 className="group-title">Staples you always have</h3>
        <p className="group-hint">
          These are skipped when parsing lists and recipes, so they never clutter your list.
        </p>
        <div className="two-btn">
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
          <p className="group-hint">No staples yet.</p>
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
      </section>

      <p className="endpoint-note">
        Build {__BUILD__}
        {AI_ENABLED && (
          <>
            <br />
            Parse endpoint: {PARSE_URL}
          </>
        )}
      </p>
    </div>
  )
}
