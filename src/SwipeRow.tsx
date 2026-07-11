import { useRef, useState, type ReactNode } from 'react'

/**
 * A list row you can swipe: right to favorite, left to delete.
 * touch-action:pan-y lets vertical scrolling pass through while we own
 * horizontal drags, so swipes never fight the list scroll.
 */
export function SwipeRow({
  rowClassName,
  onDelete,
  onFavorite,
  children,
}: {
  rowClassName: string
  onDelete: () => void
  onFavorite: () => void
  children: ReactNode
}) {
  const [dx, setDx] = useState(0)
  const start = useRef<{ x: number; y: number } | null>(null)
  const axis = useRef<'h' | 'v' | null>(null)
  const dxRef = useRef(0)
  const COMMIT = 88
  const MAX = 130

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    start.current = { x: t.clientX, y: t.clientY }
    axis.current = null
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (!start.current) return
    const t = e.touches[0]
    const mx = t.clientX - start.current.x
    const my = t.clientY - start.current.y
    if (axis.current === null) {
      if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my)) axis.current = 'h'
      else if (Math.abs(my) > 10) axis.current = 'v'
    }
    if (axis.current === 'h') {
      const clamped = Math.max(-MAX, Math.min(MAX, mx))
      dxRef.current = clamped
      setDx(clamped)
    }
  }
  const onTouchEnd = () => {
    if (axis.current === 'h') {
      if (dxRef.current >= COMMIT) onFavorite()
      else if (dxRef.current <= -COMMIT) onDelete()
    }
    start.current = null
    axis.current = null
    dxRef.current = 0
    setDx(0)
  }

  const committed = dx >= COMMIT ? 'commit-fav' : dx <= -COMMIT ? 'commit-del' : ''
  const side = dx > 0 ? 'show-fav' : dx < 0 ? 'show-del' : ''

  return (
    <li className="swipe-row">
      <div className={`swipe-bg ${side} ${committed}`}>
        <span className="swipe-act fav">★</span>
        <span className="swipe-act del">🗑</span>
      </div>
      <div
        className={`${rowClassName} swipe-content`}
        style={{
          transform: dx ? `translateX(${dx}px)` : undefined,
          transition: start.current ? 'none' : 'transform 0.2s ease',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {children}
      </div>
    </li>
  )
}
