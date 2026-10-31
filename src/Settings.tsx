import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { readAllWithTimeout } from './db'
import { estimateStorePrices, priceableKeys } from './catalog'
import { downloadBackup, importAll } from './backup'
import { Icon } from './Icon'
import { EDITION, useAiEnabled } from './edition'
import { readSetting } from './prefs'
import {
  lastSyncedAt, setSyncEnabled, sync, syncAvailable, syncEnabled,
  type Availability, type SyncResult,
} from './sync'

export function SettingsView() {
  const aiOn = useAiEnabled()
  // What a re-price would actually send: distinct items on your grocery lists,
  // not the whole history. Live so the count is honest before you tap.
  const priceCount =
    useLiveQuery(async () => (await priceableKeys()).size, []) ?? 0
  // Read-only here: the store and area are picked in Refine, where their effect
  // shows. Settings only says what pricing will use.
  const store = (readSetting('mise.store') ?? '').trim()
  const area = (readSetting('mise.area') ?? '').trim()

  // Sync. Undefined until the health check answers, so the section can say
  // "checking" instead of flickering through "not available".
  const [canSync, setCanSync] = useState<Availability | undefined>(undefined)
  const [syncOn, setSyncOn] = useState(syncEnabled)
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [syncedAt, setSyncedAt] = useState<number | null>(lastSyncedAt)
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

  const estimate = async (mode: 'missing' | 'all') => {
    setBusy(true)
    setPriceMsg('Estimating…')
    try {
      const n = await estimateStorePrices(store, mode, area)
      setPriceMsg(
        n
          ? `Priced ${n} item${n === 1 ? '' : 's'} for ${store || 'a typical store'}.`
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
        <h3 className="group-title">Your Data &amp; Backup</h3>
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
            ? 'Your account keeps a copy, and so does this device. A backup file is a copy only you hold.'
            : 'Everything is on this device only, so keep a backup file in case the browser clears it.'}
        </p>
        <div className="two-btn">
          <button className="ghost" onClick={onExport}>
            <Icon name="save" size={18} /> Back Up to a File
          </button>
          <button className="ghost" onClick={() => fileRef.current?.click()}>
            <Icon name="folder" size={18} /> Restore From a File
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
          <h3 className="group-title">Sync Across Devices</h3>
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
                signed in to the same account. The most recent change to an item wins, and
                deleting on one device deletes it everywhere. Everything keeps working
                offline and syncs when you come back.
              </p>
              {syncOn && (
                <>
                  <div className="two-btn">
                    <button className="ghost" disabled={syncBusy} onClick={() => void runSync()}>
                      <Icon name="save" size={18} /> {syncBusy ? 'Syncing…' : 'Sync Now'}
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
              Up to a File” above moves data between the two.
            </p>
          )}
        </section>
      )}

      {aiOn && (
        <section className="settings-group">
          <h3 className="group-title">Store Prices</h3>
          <p className="group-hint">
            Estimated prices for the {priceCount} item{priceCount === 1 ? '' : 's'} on your grocery
            lists — only those, never anything you've removed. Prices you set yourself stay put.
          </p>
          <p className="group-hint">
            <b>Your store:</b> {store || 'a typical store'}
            {area ? ` · ${area}` : ''}. Change it in Refine.
          </p>
          <div className="two-btn">
            <button className="ghost" onClick={() => estimate('missing')} disabled={busy || !priceCount}>
              Price Missing
            </button>
            <button className="ghost" onClick={() => estimate('all')} disabled={busy || !priceCount}>
              Re-Price {priceCount || 'All'}
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

      <p className="endpoint-note">Build {__BUILD__}</p>
    </div>
  )
}
