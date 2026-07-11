import { useRef, useState, type ReactNode } from 'react'

/**
 * Bottom sheet with drag-to-dismiss. Drag the grab handle down past a
 * threshold to close; release short and it snaps back. The grab zone uses
 * touch-action:none so the drag never triggers the browser's pull-to-refresh.
 */
export function Sheet({
  onClose,
  className = '',
  children,
}: {
  onClose: () => void
  className?: string
  children: ReactNode
}) {
  const [dragY, setDragY] = useState(0)
  const startY = useRef<number | null>(null)
  const dragRef = useRef(0)

  const onTouchStart = (e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current == null) return
    const dy = Math.max(0, e.touches[0].clientY - startY.current)
    dragRef.current = dy
    setDragY(dy)
  }
  const onTouchEnd = () => {
    if (dragRef.current > 100) onClose()
    startY.current = null
    dragRef.current = 0
    setDragY(0)
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div
        className={`sheet ${className}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: startY.current == null ? 'transform 0.22s cubic-bezier(0.2,0.8,0.2,1)' : 'none',
        }}
      >
        <div
          className="grab-zone"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onClick={onClose}
        >
          <div className="grab" />
        </div>
        {children}
      </div>
    </div>
  )
}
