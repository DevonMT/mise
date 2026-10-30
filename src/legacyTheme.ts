/**
 * Mise's own theme setting ('mise.theme', synced before the estate cookie took
 * over) as a ONE-TIME migration source for the estate theme store.
 *
 * The store reads it whenever the ds_theme cookie is missing. Left readable, a
 * later pick made in the bar would flip back to the old one every time the
 * cookie lapsed (Safari caps script-set cookies at 7 days; cookies can be
 * blocked), because nothing writes 'mise.theme' any more. So the first valid
 * value is handed over once and a flag on this device ends the migration.
 */
const DONE = 'mise.themeMigrated'

type Flag = Pick<Storage, 'getItem' | 'setItem'>

export function legacyThemeOnce(read: () => string | null, flag: Flag): string | null {
  try {
    if (flag.getItem(DONE)) return null
  } catch {
    return null
  }
  const v = read()
  if (v !== 'light' && v !== 'dark' && v !== 'system') return null
  try {
    flag.setItem(DONE, '1')
  } catch {
    /* blocked storage: the value is handed over, the cookie carries it from here */
  }
  return v
}
