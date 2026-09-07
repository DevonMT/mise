import { useEffect, useState } from 'react'

/**
 * The estate bar — on desktop only.
 *
 * Mise is the one app that is INSTALLED. On a phone it fills the screen, you
 * are not hopping between apps mid-shop, and a strip across the top costs a row
 * of the only thing that matters there: the list. On a desktop there is room,
 * and it is where you do move between apps.
 *
 * Width, not pointer: this is a question about how much space there is, and
 * usePointer answers a different one — see ds/usePointer.
 */
const DESKTOP = '(min-width: 900px)'

export function EstateBar() {
  const [wide, setWide] = useState(() => window.matchMedia?.(DESKTOP).matches ?? false)
  const [who, setWho] = useState('')

  useEffect(() => {
    const mq = window.matchMedia?.(DESKTOP)
    const on = () => setWide(mq?.matches ?? false)
    mq?.addEventListener('change', on)
    return () => mq?.removeEventListener('change', on)
  }, [])

  useEffect(() => {
    if (!wide) return
    // Same-origin: the gateway proxies this path on every app hostname.
    fetch('/api/me', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setWho(d?.user?.name || d?.user?.email || ''))
      .catch(() => {
        /* offline, or the platform is down. The bar still says where you are. */
      })
  }, [wide])

  if (!wide) return null

  return (
    <header className="ds-bar">
      <a className="ds-mark" href="https://devondoes.dev/">devondoes.dev</a>
      <span className="ds-sep" aria-hidden="true">/</span>
      <span className="ds-here">mise</span>
      <span className="ds-fill" />
      <span className="ds-who">{who}</span>
      {who && (
        <button
          className="ds-out"
          type="button"
          onClick={() => {
            void fetch('/api/sign-out', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: '{}',
            })
              .catch(() => undefined)
              .then(() => location.reload())
          }}
        >
          Sign out
        </button>
      )}
    </header>
  )
}
