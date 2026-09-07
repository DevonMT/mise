import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, canonicalize, readAllWithTimeout, type Section } from './db'
import { PARSE_URL } from './parse'
import { estimateStorePrices, priceableKeys } from './catalog'
import { downloadBackup, importAll } from './backup'
import { SECTION_META } from './sections'
import {
  AISLE_EVENT,
  getAisleOrder,
  hasCustomOrder,
  resetAisleOrder,
  setAisleOrder,
} from './aisles'
import { Icon } from './Icon'
import { EDITION, useAiEnabled } from './edition'
import {
  lastSyncedAt, setSyncEnabled, sync, syncAvailable, syncEnabled,
  type Availability, type SyncResult,
} from './sync'

function describeLayout(): string {
  const w = window.innerWidth
  const mode = w >= 900 ? 'rail' : w >= 700 ? 'wide tabs' : 'phone'
  return `${location.host} · ${w}px · ${mode}`
}

export function SettingsView() {
  const aiOn = useAiEnabled()
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

  // Which layout is actually in force, next to the build stamp.
  //
  // "It still looks like a phone app" has two completely different causes — an
  // old bundle, or a window under 900px — and from the outside they are
  // indistinguishable, which cost an evening of telling Devon to reload
  // something that was already current. One line answers both: the stamp says
  // which build, the width says which layout it chose and why.
  const [layout, setLayout] = useState(describeLayout)
  useEffect(() => {
    const onResize = () => setLayout(describeLayout())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Sync. Undefined until the health check answers, so the section can say
  // "checking" instead of flickering through "not available".
  const [canSync, setCanSync] = useState<Availability | undefined>(undefined)
  const [syncOn, setSyncOn] = useState(syncEnabled)
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [syncedAt, setSyncedAt] = useState<number | null>(lastSyncedAt)
  const [busy, setBusy] = useState(false)
  const [priceMsg, setPriceMsg] = useState('')

  // Per-store aisle order — reseeds when you switch stores. Saving dispatches
  // AISLE_EVENT so the list regroups live (see aisles.ts / App.tsx).
  const [aisles, setAisles] = useState<Section[]>(() => getAisleOrder(store))
  useEffect(() => setAisles(getAisleOrder(store)), [store])
  const moveAisle = (from: number, dir: -1 | 1) => {
    const to = from + dir
    if (to < 0 || to >= aisles.length) return
    const next = aisles.slice()
    ;[next[from], next[to]] = [next[to], next[from]]
    setAisles(next)
    setAisleOrder(store, next)
  }
  const resetAisles = () => {
    resetAisleOrder(store)
    setAisles(getAisleOrder(store))
  }
  /** Persist the active store so pricing, refine, and grouping all agree on it. */
  const commitStore = () => {
    localStorage.setItem('mise.store', store.trim())
    window.dispatchEvent(new CustomEvent(AISLE_EVENT))
  }

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
      const { items, recipes, lists, catalog } = await readAllWithTimeout()
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
      const msg = e instanceof Error ? e.message : String(e)
      setDataErr(
        msg === 'STORAGE_BLOCKED'
          ? "Storage is blocked — Mise is open somewhere else. Close every other copy (other browser tabs, and the installed app if you're in a browser, or vice-versa), then reopen just this one. Your data is almost certainly fine — it's only locked, not lost."
          : msg,
      )
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

  useEffect(() => {
    let alive = true
    void syncAvailable().then((ok) => alive && setCanSync(ok))
    return () => {
      alive = false
    }
  }, [])

  const describe = (r: SyncResult): string => {
    if (!r.ok) return r.message
    const { added, updated, removed, sent } = r
    if (!added && !updated && !removed) return `Up to date — ${sent} records checked.`
    const parts = []
    if (added) parts.push(`${added} added`)
    if (updated) parts.push(`${updated} updated`)
    if (removed) parts.push(`${removed} removed`)
    return `Synced: ${parts.join(', ')}.`
  }

  const runSync = async () => {
    setSyncBusy(true)
    setSyncMsg('')
    try {
      const r = await sync()
      setSyncMsg(describe(r))
      setSyncedAt(lastSyncedAt())
    } finally {
      setSyncBusy(false)
    }
  }

  const onToggleSync = async (on: boolean) => {
    setSyncEnabled(on)
    setSyncOn(on)
    setSyncMsg('')
    // Sync immediately on turning it on: the first thing anyone wants to know
    // is whether their list actually made it, and waiting for the next app
    // open to find out is the worst possible time to learn it did not.
    if (on) await runSync()
  }

  const [protectMsg, setProtectMsg] = useState('')
  const onProtect = async () => {
    try {
      const ok = await navigator.storage?.persist?.()
      setPersisted(ok ?? null)
      setProtectMsg(
        ok
          ? 'Done — this browser will keep the data unless you clear it yourself.'
          : 'The browser said no. A backup file is the reliable answer; so is turning on sync.',
      )
    } catch {
      setProtectMsg('This browser doesn’t offer that.')
    }
  }

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
          {syncOn
            ? 'Synced to your account, and kept on this device too. A backup is still the only copy you hold yourself.'
            : 'Everything lives on this device only. Keep a backup so a browser reset can never lose it.'}{' '}
          {persisted === true && ' ✓ This browser has been told not to clear it automatically.'}
        </p>
        {/*
          Only offered when it would actually change an outcome.

          The app used to ask for persistent storage on every load, back when
          IndexedDB was the only copy and an eviction lost the lists outright.
          With sync on, the device holds a cache of something the account also
          has, so an eviction costs a re-download. Firefox answers this with a
          permission prompt, so asking anyway meant prompting people whose data
          was already safe, before they had any, with no explanation — which is
          how a permission ends up denied for good.
        */}
        {persisted === false && !syncOn && (
          <>
            <p className="group-hint">
              This browser may clear the app’s data on its own if the device runs
              short of space. Nothing here is synced, so that would lose it.
            </p>
            <div className="two-btn">
              <button className="ghost" onClick={onProtect}>
                <Icon name="save" size={18} /> Ask to keep this data
              </button>
            </div>
            {protectMsg && <p className="group-hint">{protectMsg}</p>}
          </>
        )}
        <div className="two-btn">
          <button className="ghost" onClick={onExport}>
            <Icon name="save" size={18} /> Back up to a file
          </button>
          <button className="ghost" onClick={() => fileRef.current?.click()}>
            <Icon name="folder" size={18} /> Restore from a file
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

      {/*
        Gated on the BUILD, not on the AI tier. Lite syncs too — it is the same
        lists, and holding someone's only copy hostage to a capability tier
        would be indefensible.

        It was briefly gated on `aiOn`, which used to be a build constant and is
        now the runtime tier. That tier starts at lite and is learned FROM the
        server, so the control for turning sync on was hidden until sync had
        already run: a switch you could not reach without having already flipped
        it.
      */}
      {EDITION === 'personal' && (
        <section className="settings-group">
          <h3 className="group-title">Sync across devices</h3>
          {canSync === undefined ? (
            <p className="group-hint">Checking…</p>
          ) : canSync === 'ok' ? (
            <>
              <label className="row-toggle">
                <input
                  type="checkbox"
                  checked={syncOn}
                  disabled={syncBusy}
                  onChange={(e) => void onToggleSync(e.target.checked)}
                />
                <span>Keep this device in step with your account</span>
              </label>
              <p className="group-hint">
                Your lists, recipes, staples and saved items are shared with every device
                signed in to the same account. Edits merge — the most recent change to a
                given item wins, and deleting on one device deletes it everywhere.
                Everything keeps working offline and syncs when you come back.
              </p>
              {syncOn && (
                <>
                  <div className="two-btn">
                    <button className="ghost" disabled={syncBusy} onClick={() => void runSync()}>
                      <Icon name="save" size={18} /> {syncBusy ? 'Syncing…' : 'Sync now'}
                    </button>
                  </div>
                  <p className="group-hint">
                    {syncedAt
                      ? `Last synced ${new Date(syncedAt).toLocaleString()}.`
                      : 'Not synced yet.'}
                  </p>
                </>
              )}
              {syncMsg && <p className="group-hint">{syncMsg}</p>}
            </>
          ) : canSync === 'signin' ? (
            <p className="group-hint">
              You’re signed out. Sign in at{' '}
              <a href="https://id.devondoes.dev">id.devondoes.dev</a> and reopen Settings —
              nothing here changes until you do, and your list is untouched.
            </p>
          ) : (
            <p className="group-hint">
              Not available here. Sync needs the copy of Mise at{' '}
              <a href="https://mise.devondoes.dev">mise.devondoes.dev</a> — a browser will
              only hand the session to that address. This copy stays fully local, and “Back
              up to a file” above moves data between the two.
            </p>
          )}
        </section>
      )}

      {aiOn && (
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
            onBlur={commitStore}
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
              {busy ? '… ' : ''}
              {priceMsg}
            </p>
          )}
        </section>
      )}

      <section className="settings-group">
        <h3 className="group-title">Aisle order</h3>
        <p className="group-hint">
          The order your list groups sections while you shop. Arrange it to match{' '}
          {store.trim() ? store.trim() : 'your store'}’s layout.
        </p>
        <ul className="aisle-editor">
          {aisles.map((s, i) => (
            <li key={s} className="aisle-row">
              <span className="aisle-name">{SECTION_META[s].label}</span>
              <div className="aisle-moves">
                <button
                  className="aisle-move"
                  aria-label={`Move ${SECTION_META[s].label} up`}
                  disabled={i === 0}
                  onClick={() => moveAisle(i, -1)}
                >
                  <Icon name="chevronUp" size={18} />
                </button>
                <button
                  className="aisle-move"
                  aria-label={`Move ${SECTION_META[s].label} down`}
                  disabled={i === aisles.length - 1}
                  onClick={() => moveAisle(i, 1)}
                >
                  <Icon name="chevronDown" size={18} />
                </button>
              </div>
            </li>
          ))}
        </ul>
        <button className="ghost" onClick={resetAisles} disabled={!hasCustomOrder(store)}>
          Reset to store-walk default
        </button>
      </section>

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

      {/* The way back. Mise is reached from devondoes.dev and, once installed,
          runs with no browser chrome at all — so without this there is no route
          out of it on the device where it is most used. Settings rather than the
          bottom bar: leaving is rare, and the bottom bar is for the three things
          that are not. */}
      <section className="settings-group">
        <h3 className="group-title">Elsewhere</h3>
        <a className="home-link" href="https://devondoes.dev/">
          <span className="home-dot" aria-hidden="true" />
          All apps on devondoes.dev
        </a>
      </section>

      <p className="endpoint-note">
        Build {__BUILD__} · {layout}
        {aiOn && (
          <>
            <br />
            Parse endpoint: {PARSE_URL}
          </>
        )}
      </p>
    </div>
  )
}
