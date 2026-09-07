/* Generated from devondoes/ds/react/theme.ts — do not edit here.
   Edit the source and run `node ds/sync.mjs`. `--check` fails on drift. */
/**
 * Light, dark, or whatever the device says.
 *
 * Three states, not two. "System" is a real choice and the default one — a
 * phone that goes dark at sunset should take the app with it — so the stored
 * value is a PREFERENCE ('system' | 'light' | 'dark'), never a resolved colour.
 * Storing the resolved value is the bug where choosing dark at night silently
 * pins the app to dark forever.
 *
 * Applied by stamping `data-theme` on the root, which tokens.css keys off.
 * System stamps NOTHING, so prefers-color-scheme is left to answer — which is
 * why the dark media query there is guarded against an explicit light choice
 * rather than simply set.
 *
 * Extracted from Mise with two couplings removed:
 *
 *   PERSISTENCE is injected. Mise writes the choice through its sync layer so
 *   it reaches the other devices; an app with no sync passes nothing and gets
 *   localStorage. Either way the choice applies immediately — a theme is not
 *   worth waiting on a network round trip for.
 *
 *   THE GROUND COLOUR IS READ, NOT DECLARED. It has to match --bg or the
 *   address bar and status bar disagree with the page, and a hardcoded copy of
 *   a token is a copy that drifts. Reading the computed value means an app
 *   that restyles its palette cannot get this wrong.
 */
export type ThemeChoice = 'system' | 'light' | 'dark'

export interface ThemeStore {
  /** Synchronous, because the first paint cannot wait. */
  read(): string | null
  write(choice: ThemeChoice): void
  clear(): void
}

const KEY = 'theme'

/** The fallback store. Private windows and blocked site data both throw. */
const localStore = (key: string): ThemeStore => ({
  read: () => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  write: (choice) => {
    try {
      localStorage.setItem(key, choice)
    } catch {
      /* the choice still applies for this session */
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(key)
    } catch {
      /* nothing cached */
    }
  },
})

let store: ThemeStore = localStore(KEY)

/** Point the theme at an app's own persistence. Call once, before startTheme. */
export function configureTheme(custom: ThemeStore): void {
  store = custom
}

export function readTheme(): ThemeChoice {
  const v = store.read()
  return v === 'light' || v === 'dark' ? v : 'system'
}

/** What the choice resolves to right now. */
export function resolveTheme(choice: ThemeChoice = readTheme()): 'light' | 'dark' {
  if (choice !== 'system') return choice
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement
  if (choice === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', choice)

  // The manifest's theme_color is baked in at install time and cannot follow a
  // runtime choice, but this meta can — it colours the address bar and, on
  // Android, the status bar above the app. Left alone, choosing dark leaves a
  // bright bar over a dark page. Read AFTER the stamp, so it is the value the
  // new theme actually resolves to.
  const meta = document.querySelector('meta[name="theme-color"]')
  if (!meta) return
  const ground = getComputedStyle(root).getPropertyValue('--bg').trim()
  if (ground) meta.setAttribute('content', ground)
}

export function setTheme(choice: ThemeChoice): void {
  if (choice === 'system') store.clear()
  else store.write(choice)
  applyTheme(choice)
}

/**
 * Apply the stored choice and keep following the device while it is 'system'.
 * Returns a teardown, though in practice this lives for the life of the page.
 */
export function startTheme(): () => void {
  applyTheme(readTheme())
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
  const onChange = () => {
    // Only while following the device. An explicit choice must not be
    // overridden by the OS flipping at sunset.
    if (readTheme() === 'system') applyTheme('system')
  }
  mq?.addEventListener('change', onChange)
  return () => mq?.removeEventListener('change', onChange)
}
