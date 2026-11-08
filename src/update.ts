/**
 * When a new build takes over, reload, but not in the middle of something.
 *
 * main.tsx reloads once a new service worker takes control, so an installed
 * app can't get stuck on an old build. That reload used to fire the moment the
 * worker switched: a deploy that landed while Refine was open closed it under
 * the person's thumb ("the window closed when I clicked Find Options", 11/08).
 * Now the reload waits while anything is open or a field has focus, and runs
 * when they close it or the app goes to the background, where nobody sees it.
 *
 * The old code keeps running meanwhile. That is safe for minutes: every asset
 * it already loaded stays in memory, and the worker only changes what the NEXT
 * load fetches.
 */
export interface IdleDeps {
  /** True while the person is in the middle of something. */
  busy: () => boolean
  reload: () => void
  /** Calls back whenever the page is hidden. */
  onHidden: (fn: () => void) => void
  every: (fn: () => void, ms: number) => () => void
}

export function reloadWhenIdle(d: IdleDeps): void {
  let done = false
  const go = () => {
    if (done) return
    done = true
    stop()
    d.reload()
  }
  if (!d.busy()) {
    done = true
    d.reload()
    return
  }
  const stop = d.every(() => {
    if (!d.busy()) go()
  }, 1000)
  d.onHidden(go)
}

/** In the page: an open layer (back.ts) or a focused text field counts as busy. */
export function pageBusy(openLayers: () => number): boolean {
  if (openLayers() > 0) return true
  const el = document.activeElement
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')
}
