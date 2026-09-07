import { useSyncExternalStore } from 'react'

/**
 * Whether this device is driven by a pointer rather than a finger.
 *
 * Deliberately not a width test. An iPad in landscape is 1180px wide and still
 * a touch device; a laptop window dragged to 800px is still a mouse. Behaviour
 * that depends on precision — hover affordances, click-to-toggle where touch
 * needs a deliberate target — belongs on this question, and layout belongs on
 * width.
 *
 * Live rather than read once: plugging in a mouse, or a tablet docking to a
 * keyboard, changes the answer while the app is open.
 */
const QUERY = '(hover: hover) and (pointer: fine)'

const subscribe = (cb: () => void) => {
  const mq = window.matchMedia?.(QUERY)
  mq?.addEventListener('change', cb)
  return () => mq?.removeEventListener('change', cb)
}

export function usePointer(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia?.(QUERY).matches ?? false,
    () => false,
  )
}
