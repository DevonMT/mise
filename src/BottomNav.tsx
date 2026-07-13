export type Tab = 'list' | 'recipes' | 'settings'

const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: 'list', icon: '🛒', label: 'List' },
  { key: 'recipes', icon: '📖', label: 'Recipes' },
  { key: 'settings', icon: '⚙️', label: 'Settings' },
]

export function BottomNav({
  tab,
  onChange,
}: {
  tab: Tab
  onChange: (t: Tab) => void
}) {
  return (
    <nav className="bottomnav" role="tablist" aria-label="Main">
      {TABS.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={tab === t.key}
          className={tab === t.key ? 'navbtn on' : 'navbtn'}
          onClick={() => onChange(t.key)}
        >
          <span className="navbtn-icon">{t.icon}</span>
          <span className="navbtn-label">{t.label}</span>
        </button>
      ))}
    </nav>
  )
}
