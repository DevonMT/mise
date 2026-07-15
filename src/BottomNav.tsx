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
  const tabs: { key: Tab; icon: string; label: string }[] = [
    { key: 'list', icon: listIconName, label: listName },
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
          <span className="navbtn-label">{t.label}</span>
        </button>
      ))}
    </nav>
  )
}
