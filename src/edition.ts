import { useSyncExternalStore } from 'react'

/**
 * Which edition this app is running as.
 *
 * This used to be decided entirely at build time, which meant offering both
 * editions meant publishing two copies — and two copies went to two origins,
 * IndexedDB is per-origin, and the groceries ended up in whichever one you
 * happened to open. Which edition someone gets is a fact about that PERSON, so
 * it now comes from their grant on the platform.
 *
 *   VITE_MISE_EDITION=lite   a genuinely standalone, account-free build.
 *                            No server, no account, nothing to ask.
 *   otherwise                the account decides, at runtime.
 *
 * The build flag still wins where it is set, because a standalone build has no
 * account to ask and must never wait on a network call to know what it is.
 */
const BUILD_LITE = import.meta.env?.VITE_MISE_EDITION === 'lite'

export type Edition = 'personal' | 'lite'

/**
 * The tier the platform says this account holds, once known.
 *
 * Starts as 'lite' and not 'personal'. That is the same deny-by-default posture
 * as the rest of the estate, and here it has teeth: the ai-broker refuses the
 * Claude Max path for any app reachable by non-admins, because the subscription
 * may not serve third parties. Guessing 'personal' and being wrong would put
 * someone's model calls on a metered key at Devon's cost, or on the
 * subscription in breach of its terms. Guessing 'lite' and being wrong costs a
 * few seconds of three buttons being absent.
 */
let granted: Edition = 'lite'
/**
 * Whether the server has told us yet.
 *
 * Without this, the opening 'lite' is indistinguishable from a real answer of
 * lite, so the first successful sync of every session looks like a change from
 * lite to full — and gets announced as one. Learning the tier is not a change
 * to it.
 */
let known = false
const listeners = new Set<() => void>()

export const EDITION: Edition = BUILD_LITE ? 'lite' : 'personal'

/** Whether the AI-powered (server-backed, billable) features are available. */
export function aiEnabled(): boolean {
  return !BUILD_LITE && granted === 'personal'
}

/** Name shown in the header. */
export function editionName(): string {
  return aiEnabled() ? 'Mise' : 'Mise Lite'
}

/**
 * Called by sync with whatever the platform last said. `full` is the only value
 * that unlocks anything — an unknown tier, a null, or a failed request all mean
 * lite, so a server that starts answering nonsense degrades rather than opens
 * up.
 */
export function setGrantedVariant(variant: string | null | undefined): void {
  const next: Edition = variant === 'full' ? 'personal' : 'lite'
  const wasKnown = known
  known = true
  if (next === granted) return
  granted = next
  for (const fn of listeners) fn()
  // A caller can tell "we finally found out" from "it actually changed".
  lastWasRealChange = wasKnown
}

let lastWasRealChange = false

/** True only if the most recent update changed a tier we already knew. */
export function tierActuallyChanged(): boolean {
  const v = lastWasRealChange
  lastWasRealChange = false
  return v
}

export function editionKnown(): boolean {
  return known
}

export function grantedEdition(): Edition {
  return granted
}

/** Subscribe to tier changes so the UI can appear or disappear without a reload. */
export function onEditionChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * React binding. `useSyncExternalStore` rather than a context, because the tier
 * is process-wide, changes rarely, and every component that cares only needs a
 * boolean — a provider would be ceremony around one variable.
 */
export function useAiEnabled(): boolean {
  return useSyncExternalStore(onEditionChange, aiEnabled, () => false)
}
