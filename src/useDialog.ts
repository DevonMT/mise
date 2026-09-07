import { useEffect, useRef } from 'react'

/**
 * The behaviour a modal owes a keyboard, which this app's sheets and overlays
 * had none of.
 *
 * There was no `role`, no `aria-modal`, no focus handling, and — checked across
 * every component — no Escape key anywhere in the app. On a phone that is
 * survivable: you tap the backdrop and it goes away. On a desktop, where the
 * app now has a rail and hover states and is plainly meant to be driven from a
 * keyboard, it means a dialog you can open and cannot close.
 *
 * Four things, in the order they matter:
 *
 *   ESCAPE closes. The single most expected key in any interface.
 *   FOCUS MOVES IN, so the next Tab lands inside the dialog rather than
 *     somewhere behind it, and a screen reader starts reading the thing that
 *     just appeared.
 *   FOCUS IS TRAPPED, because Tab out of a modal puts you in a page that is
 *     visually behind a scrim and functionally still there — you end up typing
 *     into a list you cannot see.
 *   FOCUS RETURNS to whatever opened it, so closing a menu does not dump you
 *     back at the top of the document.
 *
 * Not the native <dialog> element: these are dragged bottom sheets on touch
 * with their own snap points and animation, and showModal() brings a top-layer
 * and a UA backdrop that would have to be fought at every turn. The semantics
 * are what was missing, not the element.
 */
export function useDialog(onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const node = ref.current
    // Whatever had focus before this opened, so it can be given back.
    const opener = document.activeElement as HTMLElement | null

    const focusables = () =>
      Array.from(
        node?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null || el === document.activeElement)

    // Move in. Prefer the first control; fall back to the container, which is
    // made programmatically focusable for exactly this case — a dialog that is
    // only text still has to be where the screen reader is.
    const first = focusables()[0]
    if (first) first.focus()
    else node?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusables()
      if (!items.length) {
        e.preventDefault()
        return
      }
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      const active = document.activeElement
      // Wrap at both ends. Without the second branch, Shift+Tab from the first
      // control escapes backwards into the page, which is the same bug as
      // tabbing forwards out of it.
      if (!e.shiftKey && active === lastEl) {
        e.preventDefault()
        firstEl.focus()
      } else if (e.shiftKey && (active === firstEl || !node?.contains(active))) {
        e.preventDefault()
        lastEl.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      // Return it unless something else has deliberately claimed it — a second
      // dialog, a toast action. Testing `node.contains(activeElement)` alone
      // was wrong: by cleanup time React has usually detached the node and
      // focus has already fallen to <body>, so that check said "someone else
      // has it" when in fact nobody did, and focus was silently abandoned at
      // the top of the document.
      const active = document.activeElement
      const nobodyClaimedIt =
        !active || active === document.body || !!node?.contains(active)
      if (nobodyClaimedIt) opener?.focus?.()
    }
  }, [onClose])

  return ref
}
