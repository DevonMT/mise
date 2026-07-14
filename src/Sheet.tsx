import { useRef, useState, type ReactNode } from 'react'

/**
 * Bottom sheet with two snap points.
 *
 *   drag up   → full (92dvh, content scrolls)
 *   drag down → back to peek (its natural height)
 *   drag down again → dismissed
 *
 * The grab zone uses touch-action:none so a drag never triggers the browser's
 * pull-to-refresh. A drag is not a tap: we swallow the click that a touch
 * sequence synthesizes afterwards, or dragging up would immediately close.
 */
type Snap = 'peek' | 'full'

const EXPAND = 40 // drag up this far from peek → go full
const DISMISS = 90 // drag down this far → down a level
const FLING = 240 // a long drag down from full closes outright

export function Sheet({
  onClose,
  className = '',
  children,
}: {
  onClose: () => void
  className?: string
  children: ReactNode
}) {
  const [snap, setSnap] = useState<Snap>('peek')
  const [dragY, setDragY] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startY = useRef<number | null>(null)
  const dragRef = useRef(0)
  const didDrag = useRef(false)

  const onTouchStart = (e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY
    didDrag.current = false
    setDragging(true)
  }

  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current == null) return
    let dy = e.touches[0].clientY - startY.current
    // At full you can't drag further up; at peek an upward drag is the
    // expand gesture, so let it move a little (rubber-banded) as feedback.
    if (snap === 'full' && dy < 0) dy = 0
    else if (dy < 0) dy = Math.max(dy, -80) / 2
    if (Math.abs(dy) > 4) didDrag.current = true
    dragRef.current = dy
    setDragY(dy)
  }

  const onTouchEnd = () => {
    const dy = dragRef.current
    if (snap === 'peek') {
      if (dy <= -EXPAND / 2) setSnap('full')
      else if (dy > DISMISS) onClose()
    } else {
      if (dy > FLING) onClose()
      else if (dy > DISMISS) setSnap('peek')
    }
    startY.current = null
    dragRef.current = 0
    setDragY(0)
    setDragging(false)
  }

  // A tap on the bar still closes; a drag that ends on it must not.
  const onGrabClick = () => {
    if (didDrag.current) {
      didDrag.current = false
      return
    }
    onClose()
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div
        className={`sheet ${snap === 'full' ? 'full' : ''} ${className}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: dragging
            ? 'none'
            : 'transform 0.22s cubic-bezier(0.2,0.8,0.2,1), height 0.22s cubic-bezier(0.2,0.8,0.2,1)',
        }}
      >
        <div
          className="grab-zone"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onClick={onGrabClick}
        >
          <div className="grab" />
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}
