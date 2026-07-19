/**
 * Line-icon set — replaces the emoji that made the UI feel dated. Every glyph
 * is a 24×24 stroke path so they share one weight and inherit color/size from
 * CSS (`.icon { width; height; stroke: currentColor }`).
 *
 * LIST_ICONS is the curated set a list can pick from for its identity (shown in
 * the header, the bottom-nav tab, the switcher, and empty states) — so a list
 * is never locked to a shopping cart.
 */

// Each entry is the inner markup of a 24×24 viewBox, stroked.
const PATHS: Record<string, string> = {
  // --- app chrome ---
  dots: '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  chevronUp: '<path d="M6 15l6-6 6 6"/>',
  chevronRight: '<path d="M9 6l6 6-6 6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12l5 5L20 6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  trash: '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/>',
  share: '<path d="M12 3v12M8 7l4-4 4 4M5 12v7a1 1 0 001 1h12a1 1 0 001-1v-7"/>',
  link: '<path d="M9 15l6-6M8 12l-2 2a3.5 3.5 0 005 5l2-2M16 12l2-2a3.5 3.5 0 00-5-5l-2 2"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  download: '<path d="M12 4v11M8 11l4 4 4-4M5 20h14"/>',
  upload: '<path d="M12 20V9M8 13l4-4 4 4M5 4h14"/>',
  refine: '<path d="M5 7h14M8 12h8M11 17h2"/>',
  select: '<path d="M4 6h10M4 12h7M4 18h10M17 15l2 2 3-4"/>',
  sparkle: '<path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z"/>',
  camera: '<path d="M4 8h3l1.5-2h7L18 8h2a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><circle cx="12" cy="13" r="3.2"/>',
  clipboard: '<path d="M9 4h6v2H9zM7 5H6a1 1 0 00-1 1v13a1 1 0 001 1h12a1 1 0 001-1V6a1 1 0 00-1-1h-1M9 12h6M9 16h4"/>',
  tag: '<path d="M4 4h7l9 9-7 7-9-9z"/><circle cx="8.5" cy="8.5" r="1.2"/>',
  bulb: '<path d="M9 18h6M10 21h4M8.5 15a5 5 0 117 0c-.8.7-1 1.3-1 2.2h-5c0-.9-.2-1.5-1-2.2z"/>',
  save: '<path d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6"/>',
  folder: '<path d="M4 6h6l2 2h8v11H4z"/>',
  lock: '<path d="M7 11V8a5 5 0 0110 0v3M5 11h14v9H5z"/>',
  // --- nav ---
  book: '<path d="M5 4h13a1 1 0 011 1v15l-7-3-7 3V5a1 1 0 011-1z"/>',
  settings: '<circle cx="16" cy="8" r="2.3"/><circle cx="7" cy="16" r="2.3"/><path d="M4 8h9M18 8h2M4 16h2M9 16h11"/>',
  // --- list identity (pickable) ---
  list: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  cart: '<path d="M4 5h2l2 11h10l2-8H7"/><circle cx="9" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/>',
  basket: '<path d="M6 9l6-5 6 5M3 9h18l-2 10H5z"/>',
  tasks: '<path d="M4 6l2 2 3-3M4 13l2 2 3-3M13 6h7M13 14h7M4 20l2 2 3-3M13 21h7"/>',
  pantry: '<path d="M8 3h8l-1 4H9zM7 7h10l1 14H6zM10 11v6M14 11v6"/>',
  leaf: '<path d="M5 19c0-8 6-13 14-13 0 8-5 14-13 14-1 0-1-1-1-1zM8 16c3-3 6-5 9-6"/>',
  home: '<path d="M4 11l8-6 8 6M6 10v10h12V10"/>',
  gift: '<path d="M4 9h16v3H4zM5 12h14v9H5zM12 9v12M9 9a2 2 0 010-4c2 0 3 2 3 4M15 9a2 2 0 000-4c-2 0-3 2-3 4"/>',
  tools: '<path d="M6 4l3 3-2 2-3-3a4 4 0 005 5l7 7 3-3-7-7a4 4 0 00-5-5z"/>',
  calendar: '<path d="M4 6h16v14H4zM4 10h16M8 4v3M16 4v3"/>',
  heart: '<path d="M12 20s-7-4.6-7-9.5A3.5 3.5 0 0112 8a3.5 3.5 0 017 2.5c0 4.9-7 9.5-7 9.5z"/>',
  star: '<path d="M12 4l2.4 5 5.6.6-4.2 3.8 1.2 5.6L12 16.8 7 19l1.2-5.6L4 9.6 9.6 9z"/>',
  coffee: '<path d="M5 8h12v5a4 4 0 01-4 4H9a4 4 0 01-4-4zM17 9h2a2 2 0 010 4h-2M7 3v2M11 3v2"/>',
  pill: '<path d="M8 4h8a4 4 0 014 4v8a4 4 0 01-4 4H8a4 4 0 01-4-4V8a4 4 0 014-4zM4 12h16"/>',
  paw: '<circle cx="7" cy="9" r="1.6"/><circle cx="12" cy="7" r="1.6"/><circle cx="17" cy="9" r="1.6"/><path d="M12 12c-3 0-5 2-5 4a2 2 0 002 2h6a2 2 0 002-2c0-2-2-4-5-4z"/>',
}

/** Keys offered in the list-icon picker, in display order. */
export const LIST_ICON_KEYS = [
  'list', 'cart', 'basket', 'tasks', 'pantry', 'leaf',
  'home', 'gift', 'tools', 'calendar', 'coffee', 'pill',
  'paw', 'heart', 'star', 'book',
] as const

export type IconName = keyof typeof PATHS

export function Icon({
  name,
  size = 24,
  className = '',
  strokeWidth = 2,
}: {
  name: string
  size?: number
  className?: string
  strokeWidth?: number
}) {
  const inner = PATHS[name] ?? PATHS.list
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  )
}
