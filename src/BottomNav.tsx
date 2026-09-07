import { Icon } from './Icon'

export type Tab = 'list' | 'recipes' | 'settings'

export function BottomNav({
  tab,
  onChange,
  listIconName,
  listName,
}: {
  tab: Tab
  onChange: (t: Tab) => void
  /** The active list's icon + name — the List tab mirrors it (no fixed cart). */
  listIconName: string
  listName: string
}) {
  /**
   * The list tab carries two labels and CSS picks one.
   *
   * On a phone the tab bar sits at the far end of the screen from the header,
   * so echoing the active list's name there is a useful "you are here". In the
   * desktop rail it lands a couple of centimetres from the header, which says
   * the same words — the list is named twice, side by side, and the second one
   * reads as a bug. The rail names the SECTION there; the header keeps the
   * identity, which is where the switcher is anyway.
   *
   * Done in CSS rather than by reading matchMedia at render, because a value
   * read once does not survive the window being resized — drag a window past
   * 900px and the label would keep whichever answer it happened to get first.
   */
  const tabs: { key: Tab; icon: string; label: string; wideLabel?: string }[] = [
    { key: 'list', icon: listIconName, label: listName, wideLabel: 'List' },
    { key: 'recipes', icon: 'book', label: 'Recipes' },
    { key: 'settings', icon: 'settings', label: 'Settings' },
  ]
  return (
    <nav className="bottomnav" role="tablist" aria-label="Main">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={tab === t.key}
          className={tab === t.key ? 'navbtn on' : 'navbtn'}
          onClick={() => onChange(t.key)}
        >
          <span className="navbtn-icon">
            <Icon name={t.icon} size={23} />
          </span>
          <span className="navbtn-label">
            {t.wideLabel ? (
              <>
                <span className="lbl-narrow">{t.label}</span>
                <span className="lbl-wide">{t.wideLabel}</span>
              </>
            ) : (
              t.label
            )}
          </span>
        </button>
      ))}
    </nav>
  )
}
