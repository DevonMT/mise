import { useEffect, useState } from 'react'
import { useDialog } from './ds/useDialog'
import * as people from './people'
import type { SharePayload } from './share'

/**
 * Sending a list to somebody, or keeping one in step with them.
 *
 * TWO DIFFERENT THINGS, said as two different things rather than one control
 * with a mode. "Send a copy" is a snapshot: they get it as it is now and it is
 * theirs. "Keep in step" is a subscription: one list, both of you, edits either
 * way. Collapsing them into one button is how somebody shares a shopping list
 * expecting it to update and finds out on the way home that it did not.
 */
export function SharePeople({
  listUid, listName, payload, onClose, onToast,
}: {
  listUid: string | null
  listName: string
  payload: SharePayload | null
  onClose: () => void
  onToast: (s: string) => void
}) {
  const ref = useDialog(onClose)
  const [friends, setFriends] = useState<people.Person[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    void people.friends().then(setFriends)
  }, [])

  const send = async (p: people.Person) => {
    if (!payload) return
    setBusy(p.id)
    const ok = await people.sendTo(p.id, listName, payload)
    setBusy(null)
    onToast(ok ? `Sent “${listName}” to ${p.name || p.email}` : 'Could not send that.')
    if (ok) onClose()
  }

  const keep = async (p: people.Person) => {
    if (!listUid) return
    setBusy(p.id)
    const ok = await people.subscribe(listUid, p.id)
    setBusy(null)
    onToast(ok
      ? `${p.name || p.email} is on “${listName}” now`
      : 'Could not share that list.')
    if (ok) onClose()
  }

  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet people-sheet" ref={ref} role="dialog" aria-modal="true"
           aria-label={`Share ${listName}`} tabIndex={-1}
           onClick={(e) => e.stopPropagation()}>
        <h2>Share “{listName}”</h2>

        {friends === null && <p className="hint">Looking…</p>}

        {friends?.length === 0 && (
          <p className="hint">
            Nobody to share with yet. Connect with people on{' '}
            <a href="https://devondoes.dev/people">devondoes.dev</a> and they will
            appear here.
          </p>
        )}

        {friends?.map((p) => (
          <div className="person" key={p.id}>
            <span className={`avatar ${p.accent ?? ''}`}>{p.icon || '·'}</span>
            <span className="person-name">{p.name || p.email}</span>
            <button className="mini ghost" disabled={busy === p.id}
                    onClick={() => void send(p)}>Send a copy</button>
            {listUid && (
              <button className="mini" disabled={busy === p.id}
                      onClick={() => void keep(p)}>Keep in step</button>
            )}
          </div>
        ))}

        {!!friends?.length && (
          <p className="hint">
            <strong>Send a copy</strong> gives them the list as it is now, to keep.{' '}
            <strong>Keep in step</strong> is one list you both edit.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Something somebody sent you.
 *
 * Shown on open, because a list that arrives silently is a list you find in
 * three weeks. Claiming makes an independent copy — the sender's changes after
 * this do not reach you, which is exactly what "a copy" means and is why the
 * other option exists.
 */
export function Handoffs({ onTake, onToast }: {
  onTake: (p: SharePayload) => void
  onToast: (s: string) => void
}) {
  const [waiting, setWaiting] = useState<people.Waiting[]>([])

  useEffect(() => {
    void people.inbox().then(setWaiting)
  }, [])

  if (!waiting.length) return null

  const take = async (w: people.Waiting) => {
    const got = await people.claim(w.id)
    setWaiting((ws) => ws.filter((x) => x.id !== w.id))
    if (got?.payload) onTake(got.payload as SharePayload)
    else onToast('That one had already been taken.')
  }

  const drop = async (w: people.Waiting) => {
    await people.dismiss(w.id)
    setWaiting((ws) => ws.filter((x) => x.id !== w.id))
  }

  return (
    <div className="handoffs">
      {waiting.map((w) => (
        <div className="handoff" key={w.id}>
          <span className={`avatar ${w.accent ?? ''}`}>{w.icon || '·'}</span>
          <span className="grow">
            <strong>{w.name || w.email}</strong> sent you “{w.label}”
          </span>
          <button className="mini" onClick={() => void take(w)}>Take it</button>
          <button className="mini ghost" onClick={() => void drop(w)}>No thanks</button>
        </div>
      ))}
    </div>
  )
}
