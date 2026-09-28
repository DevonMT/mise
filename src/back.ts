import { useEffect, useRef } from 'react'

/**
 * Android's back button, one layer at a time.
 *
 * It used to be one boolean — "is anything open?" — so a single back closed
 * every overlay AND jumped to the list tab: back from a recipe landed on the
 * list, not on Recipes. Now each thing that can be backed out of registers a
 * layer while it is open, and back closes only the topmost one: share sheet,
 * then the recipe, then the Recipes tab, then (from the list) the app.
 *
 * HOW. Layers stack in the order they opened. The browser history is kept at
 * exactly one entry per open layer, reconciled after each render rather than
 * pushed and popped inline — closing one sheet and opening another in the same
 * click would otherwise push, then pop the entry that was just pushed. A back
 * press removes an entry itself, so it is counted and the top layer is closed;
 * a layer closed any other way (a tap, Escape) gives its entry back with one
 * history.go(-n) that the listener knows to ignore.
 */

const stack: Array<{ close: () => void }> = []
/** History entries this module has pushed and not yet taken back. */
let entries = 0
/** Pops we caused ourselves, which are not the user pressing back. */
let ignoring = 0
let scheduled = false

function flush(): void {
  scheduled = false
  const diff = stack.length - entries
  if (diff > 0) {
    for (let i = 0; i < diff; i++) history.pushState({ mise: true }, '')
    entries += diff
  } else if (diff < 0) {
    ignoring++
    entries += diff
    history.go(diff)
  }
}

function schedule(): void {
  if (scheduled) return
  scheduled = true
  setTimeout(flush, 0)
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (ignoring > 0) {
      ignoring--
      return
    }
    // The user pressed back: the browser has already dropped one entry.
    entries = Math.max(0, entries - 1)
    stack.pop()?.close()
    schedule()
  })
}

/** While `open`, back calls `close` instead of going further back. */
export function useBackLayer(open: boolean, close: () => void): void {
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    if (!open) return
    const layer = { close: () => closeRef.current() }
    stack.push(layer)
    schedule()
    return () => {
      const i = stack.indexOf(layer)
      // Still stacked means it closed some other way than back.
      if (i >= 0) stack.splice(i, 1)
      schedule()
    }
  }, [open])
}
