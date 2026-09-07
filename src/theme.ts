/**
 * Light, dark, or whatever the device says.
 *
 * Three states, not two. "System" is a real choice and the default one — a
 * phone that goes dark at sunset should take the app with it — so the stored
 * value is a preference ('system' | 'light' | 'dark'), never a resolved colour.
 * Storing the resolved value is the bug where choosing dark at night silently
 * pins the app to dark forever.
 *
 * Applied by stamping `data-theme` on the root, which the stylesheet's token
 * blocks key off. System stamps NOTHING, so `prefers-color-scheme` is left to
 * answer — which is why the dark media query is guarded against an explicit
 * light choice rather than simply set.
 */
export type ThemeChoice = 'system' | 'light' | 'dark'

const KEY = 'mise.theme'

/** The colour actually painted behind the app, per theme. Must match --bg, or
 *  the status bar on Android and the browser chrome disagree with the page. */
const GROUND: Record<'light' | 'dark', string> = {
  light: '#f2f4f3',
  dark: '#0e1214',
}

export function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    // Private windows and blocked site data both throw here. A theme is not
    // worth failing to start over.
    return 'system'
  }
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
  // runtime choice, but this meta can — it is what colours the address bar and,
  // on Android, the status bar above the app. Left alone, choosing dark leaves
  // a bright bar over a dark page.
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', GROUND[resolveTheme(choice)])
}

export function setTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, choice)
  } catch {
    /* the choice still applies for this session */
  }
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
