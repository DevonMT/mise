import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, canonicalize } from './db'
import { PARSE_URL } from './parse'
import { estimateStorePrices, priceableKeys } from './catalog'
import { downloadBackup, importAll } from './backup'
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

  // "What's actually stored" readout — the no-console way to see whether data
  // is present. Loaded explicitly (not useLiveQuery) so a read error is shown
  // instead of a silent blank.
  type Counts = {
    items: number
    recipes: number
    catalog: number
    lists: { name: string; n: number }[]
  }
  const [dataCounts, setDataCounts] = useState<Counts | null>(null)
  const [dataErr, setDataErr] = useState('')
  const loadCounts = async () => {
    try {
      const [items, recipes, lists, catalog] = await Promise.all([
        db.items.toArray(),
        db.recipes.count(),
        db.lists.toArray(),
        db.catalog.count(),
      ])
      setDataCounts({
        items: items.length,
        recipes,
        catalog,
        lists: lists.map((l) => ({
          name: l.name,
          n: items.filter((i) => i.listId === l.id).length,
        })),
      })
      setDataErr('')
    } catch (e) {
      setDataErr(e instanceof Error ? e.message : String(e))
    }
  }
  useEffect(() => {
    loadCounts()
  }, [])
  const [persisted, setPersisted] = useState<boolean | null>(null)
  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null))
  }, [])
  const [dataMsg, setDataMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const onExport = async () => {
    try {
      await downloadBackup()
      setDataMsg('Backup saved to your downloads.')
    } catch (e) {
      setDataMsg(e instanceof Error ? e.message : String(e))
    }
  }
  const onPickBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const n = await importAll(await file.text())
      setDataMsg(`Restored ${n.items} items, ${n.recipes} recipes, ${n.lists} lists.`)
      await loadCounts()
    } catch (err) {
      setDataMsg(err instanceof Error ? err.message : String(err))
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

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

      <section className="settings-group">
        <h3 className="group-title">Your data &amp; backup</h3>
        {dataErr ? (
          <p className="err-text">Couldn’t read storage: {dataErr}</p>
        ) : dataCounts ? (
          <>
            <div className="data-readout">
              <span className="data-stat">
                <b>{dataCounts.items}</b> items
              </span>
              <span className="data-stat">
                <b>{dataCounts.recipes}</b> recipes
              </span>
              <span className="data-stat">
                <b>{dataCounts.lists.length}</b> lists
              </span>
              <span className="data-stat">
                <b>{dataCounts.catalog}</b> saved
              </span>
            </div>
            {dataCounts.lists.length > 0 && (
              <p className="group-hint" style={{ marginTop: 8 }}>
                {dataCounts.lists.map((l) => `${l.name} (${l.n})`).join(' · ')}
              </p>
            )}
          </>
        ) : (
          <p className="group-hint">Reading storage…</p>
        )}
        <p className="group-hint">
          Everything lives on this device only. Keep a backup so a browser reset can never lose it.
          {persisted === false && ' Storage isn’t marked persistent yet — reopening the app requests it.'}
          {persisted === true && ' ✓ Storage is protected from automatic clearing.'}
        </p>
        <div className="two-btn">
          <button className="ghost" onClick={onExport}>
            💾 Back up to a file
          </button>
          <button className="ghost" onClick={() => fileRef.current?.click()}>
            📂 Restore from a file
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={onPickBackup}
        />
        {dataMsg && <p className="group-hint">{dataMsg}</p>}
      </section>

      {AI_ENABLED && (
        <section className="settings-group">
          <h3 className="group-title">Store prices</h3>
          <p className="group-hint">
            Estimated prices for the {priceCount} item{priceCount === 1 ? '' : 's'} on your grocery
            lists — only those, never anything you've removed. Prices you set yourself stay put.
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
