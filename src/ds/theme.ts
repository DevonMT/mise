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
 *   PERSISTENCE is injected. The default is the estate cookie store below, so
 *   the choice follows you across apps; an app that needs something else passes
 *   its own. Either way the choice applies immediately — a theme is not
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

/**
 * The estate store: the ds_theme cookie, shared by every app and by ds/chrome.js
 * (same attributes, so they never write two cookies). The platform keeps it in
 * step with the profile; a pick here is also saved there, signed in or not
 * (a signed-out save is refused and ignored: the cookie already carries it).
 *
 * 'system' is WRITTEN, not cleared: a stored 'system' is a choice, an absent
 * cookie is "never chosen", and the profile needs to tell them apart.
 *
 * Migration: the first read with no cookie adopts whatever the app stored
 * before (Mise's sync layer or localStorage, passed as `legacy`) and writes it
 * to the cookie once (the platform adopts it from there), so nobody's choice resets.
 */
const THEME_COOKIE = /(?:^|; )ds_theme=(light|dark|system)(?:;|$)/

// The types are erased at runtime and this string goes into a cookie.
const valid = (v: unknown): v is ThemeChoice => v === 'light' || v === 'dark' || v === 'system'

const writeCookie = (choice: ThemeChoice): void => {
  if (!valid(choice)) return
  document.cookie =
    `ds_theme=${choice}; Max-Age=31536000; Path=/; SameSite=Lax` +
    (location.hostname === 'localhost' ? '' : '; Domain=.devondoes.dev; Secure')
}

/**
 * `platform` is the origin of the estate API, like `data-platform` on the bar:
 * empty for an app behind the gateway (same-origin, the gateway proxies the
 * path), the platform's origin for one outside it (Rumpus, Delve), which must
 * also be in the platform's BAR_ORIGINS. Defaults to the bar's own attribute.
 */
export function cookieThemeStore(legacy: ThemeStore = localStore(KEY), platform?: string): ThemeStore {
  const base = () => platform ?? document.querySelector<HTMLElement>('.ds-bar')?.dataset.platform ?? ''
  const save = (choice: ThemeChoice): void => {
    if (!valid(choice)) return
    writeCookie(choice)
    fetch(base() + '/api/estate/prefs', {
      method: 'POST',
      credentials: 'include',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: choice }),
    }).catch(() => {
      /* offline: the cookie carries the choice on this device */
    })
  }
  return {
    read: () => {
      const m = THEME_COOKIE.exec(document.cookie)
      if (m) return m[1]
      const old = legacy.read()
      if (valid(old)) {
        // Cookie only, no POST: /api/me adopts it if the profile has no answer
        // yet, and a profile that already has one must win over a stale local
        // choice on a new device.
        writeCookie(old)
        return old
      }
      return null
    },
    write: save,
    clear: () => save('system'),
  }
}

let store: ThemeStore = cookieThemeStore()

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
