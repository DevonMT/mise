import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type CatalogEntry } from './db'
import { addItem } from './list'
import { toggleFavorite } from './catalog'
import { Icon } from './Icon'
import { Sheet } from './Sheet'

export function QuickAddSheet({
  listId,
  onClose,
  onAddNew,
}: {
  listId: number
  onClose: () => void
  onAddNew: () => void
}) {
  const catalog = useLiveQuery(() => db.catalog.toArray(), []) ?? []
  const [added, setAdded] = useState<Set<string>>(new Set())

  const favorites = catalog
    .filter((c) => c.favorite)
    .sort((a, b) => a.displayName.localeCompare(b.displayName))

  const add = async (c: CatalogEntry) => {
    await addItem({
      listId,
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

  return (
    <Sheet className="quickadd" onClose={onClose}>
      <div className="qa-header">
        <h3 className="sheet-title">
          <Icon name="star" size={20} /> Quick add
        </h3>
        <button className="add-btn" onClick={onAddNew}>
          <Icon name="plus" size={18} /> New
        </button>
      </div>

      {favorites.length === 0 ? (
        <p className="review-hint">
          No favorites yet. Open any item on your list and tap the star to keep it here for one-tap
          adding — or use New to add something.
        </p>
      ) : (
        <div className="qa-grid">
          {favorites.map((c) => (
            <div key={c.id} className={added.has(c.canonicalKey) ? 'qa-chip added' : 'qa-chip'}>
              <button className="qa-add" onClick={() => add(c)}>
                <span className="qa-name">{c.displayName}</span>
                <span className="qa-hint">
                  {added.has(c.canonicalKey) ? (
                    <>
                      <Icon name="check" size={15} strokeWidth={3} /> added
                    </>
                  ) : (
                    <Icon name="plus" size={18} />
                  )}
                </span>
              </button>
              <button
                className="qa-star on"
                aria-label="Unfavorite"
                onClick={() => toggleFavorite(c)}
              >
                <Icon name="star" size={19} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  )
}
