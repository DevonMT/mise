import { useState } from 'react'
import { Sheet } from './Sheet'
import { clearThisDevice } from './account'
import { keepForAccount, sync } from './sync'

/**
 * Signed in as a different account from the one this device's lists belong to
 * (#278, account.ts). Sync has stopped; nothing moves until someone picks.
 *
 * Clearing is the first choice because it is the one that cannot leak: the
 * lists are still in the account they synced to. Keeping them merges somebody's
 * lists into this account for good, so it says so.
 */
export function AccountSheet({ account, onClose, onKept }: {
  account: string
  onClose: () => void
  /** Synced as this account: the clash is over. */
  onKept: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const clear = async () => {
    setBusy(true)
    try {
      await clearThisDevice(account)
      await sync()
      // Every view is holding rows that are gone: start clean.
      location.reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const keep = async () => {
    setBusy(true)
    const r = await keepForAccount(account)
    if (r.ok) onKept()
    else {
      setErr(r.message)
      setBusy(false)
    }
  }

  return (
    <Sheet className="account-sheet" label="Lists from another account" onClose={onClose}>
      <h3 className="sheet-title">Lists From Another Account</h3>
      <p className="review-hint">
        The lists on this device were synced by a different account than the one signed in now.
        Mise has stopped syncing so the two don’t mix.
      </p>
      <button className="primary" onClick={clear} disabled={busy}>
        Clear This Device
      </button>
      <p className="account-note">
        Removes them here and loads this account’s lists. They stay in the other account; only
        changes made here since its last sync are lost.
      </p>
      <button className="ghost" onClick={keep} disabled={busy}>
        Keep Them as Mine
      </button>
      <p className="account-note">Adds them to this account for good. Only if they’re yours.</p>
      {/* Never disabled: a stalled request must not trap anyone in the sheet. */}
      <button className="ghost" onClick={onClose}>
        Decide Later
      </button>
      {err && <p className="account-note account-err" role="alert">{err}</p>}
    </Sheet>
  )
}
