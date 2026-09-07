import { Icon } from './Icon'

export type Tab = 'list' | 'recipes' | 'settings'

export function BottomNav({
  tab,
  onChange,
  listIconName,
  listName,
  lists = [],
  activeListId,
  onPickList,
  onManageLists,
}: {
  tab: Tab
  onChange: (t: Tab) => void
  /** The active list's icon + name — the List tab mirrors it (no fixed cart). */
  listIconName: string
  listName: string
  /**
   * Every list, for the rail. A phone gets one "List" tab and reaches the
   * others through the switcher sheet, because a tab bar has room for three
   * things. A rail has a column of empty space and no reason to hide them
   * behind a sheet — which is what a sidebar is for.
   */
  lists?: { id?: number; name: string; icon?: string; kind: string }[]
  activeListId?: number | null
  onPickList?: (id: number) => void
  onManageLists?: () => void
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

  const tabButton = (t: (typeof tabs)[number]) => (
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
  )

  return (
    <nav className="bottomnav" aria-label="Main">
      {/* The phone's three tabs. In the rail the first one is replaced by the
          list column below, so it is hidden there rather than duplicated. */}
      <div className="nav-tabs" role="tablist" aria-label="Sections">
        {tabs.map(tabButton)}
      </div>

      {/* Rail only — CSS hides this entirely below the rail breakpoint, so a
          phone never renders a second navigation it has no room for. */}
      {lists.length > 0 && (
        <div className="rail-lists">
          <h2 className="rail-heading">Lists</h2>
          <div role="tablist" aria-label="Your lists">
            {lists.map((l) => (
              <button
                key={l.id}
                role="tab"
                aria-selected={tab === 'list' && l.id === activeListId}
                className={
                  tab === 'list' && l.id === activeListId ? 'navbtn on' : 'navbtn'
                }
                onClick={() => l.id != null && onPickList?.(l.id)}
              >
                <span className="navbtn-icon">
                  <Icon name={l.icon || 'list'} size={20} />
                </span>
                <span className="navbtn-label">{l.name}</span>
              </button>
            ))}
          </div>
          {onManageLists && (
            <button className="navbtn rail-manage" onClick={onManageLists}>
              <span className="navbtn-icon">
                <Icon name="plus" size={20} />
              </span>
              <span className="navbtn-label">New or edit…</span>
            </button>
          )}
        </div>
      )}
    </nav>
  )
}
