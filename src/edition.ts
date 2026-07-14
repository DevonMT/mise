/**
 * Build editions:
 *  - 'personal' (default): full app, AI features on (parse / prices / refine via the mini).
 *  - 'lite': public/free build — every AI feature (and thus every call to the
 *    server / your key) is removed. 100% local, no backend, no cost.
 *
 * Selected at build time with VITE_MISE_EDITION=lite.
 */
export const EDITION =
  import.meta.env.VITE_MISE_EDITION === 'lite' ? 'lite' : 'personal'

/** Whether the AI-powered (server-backed, billable) features are available. */
export const AI_ENABLED = EDITION !== 'lite'

/** Name shown in the header. */
export const EDITION_NAME = EDITION === 'lite' ? 'Mise Lite' : 'Mise'
