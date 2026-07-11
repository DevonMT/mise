import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type CatalogEntry } from './db'
import { addItem } from './list'
import { toggleFavorite, removeFromCatalog } from './catalog'
import { SECTION_META } from './sections'
import { Sheet } from './Sheet'

export function QuickAddSheet({ onClose }: { onClose: () => void }) {
  const catalog = useLiveQuery(() => db.catalog.toArray(), []) ?? []
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')

  const query = q.trim().toLowerCase()
  const match = (c: CatalogEntry) => !query || c.displayName.toLowerCase().includes(query)

  const favorites = catalog
    .filter((c) => c.favorite && match(c))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
  const frequent = catalog
    .filter((c) => !c.favorite && match(c))
    .sort((a, b) => b.count - a.count || b.lastAdded - a.lastAdded)
    .slice(0, 24)

  const add = async (c: CatalogEntry) => {
    await addItem({
      displayName: c.displayName,
      canonicalKey: c.canonicalKey,
      unit: c.unit,
      section: c.section,
    })
    setAdded((s) => new Set(s).add(c.canonicalKey))
    setTimeout(
      () =>
        setAdded((s) => {
          const n = new Set(s)
          n.delete(c.canonicalKey)
          return n
        }),
      1100,
    )
  }

  const Chip = ({ c }: { c: CatalogEntry }) => (
    <div className={added.has(c.canonicalKey) ? 'qa-chip added' : 'qa-chip'}>
      <button className="qa-add" onClick={() => add(c)}>
        <span className="qa-emoji">{SECTION_META[c.section].emoji}</span>
        <span className="qa-name">{c.displayName}</span>
        <span className="qa-hint">{added.has(c.canonicalKey) ? '✓ added' : '＋'}</span>
      </button>
      <button
        className={c.favorite ? 'qa-star on' : 'qa-star'}
        aria-label="favorite"
        onClick={() => toggleFavorite(c)}
        onDoubleClick={() => removeFromCatalog(c)}
      >
        {c.favorite ? '★' : '☆'}
      </button>
    </div>
  )

  return (
    <Sheet className="quickadd" onClose={onClose}>
      <h3 className="sheet-title">⭐ Quick add</h3>
      {catalog.length === 0 ? (
        <p className="review-hint">
          Nothing here yet. As you add items they'll collect here for one-tap re-adding —
          tap ☆ to keep favorites at the top.
        </p>
      ) : (
        <>
          <input
            className="field"
            placeholder="Filter…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {favorites.length > 0 && (
            <>
              <h4 className="qa-head">Favorites</h4>
              <div className="qa-grid">
                {favorites.map((c) => (
                  <Chip key={c.id} c={c} />
                ))}
              </div>
            </>
          )}
          {frequent.length > 0 && (
            <>
              <h4 className="qa-head">Frequently bought</h4>
              <div className="qa-grid">
                {frequent.map((c) => (
                  <Chip key={c.id} c={c} />
                ))}
              </div>
            </>
          )}
          <p className="review-hint qa-foot">
            Tap to add · ☆ to favorite · double-tap ★ to forget an item
          </p>
        </>
      )}
    </Sheet>
  )
}
