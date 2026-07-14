import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Recipe } from './db'
import { KINDS } from './kinds'
import { addItem } from './list'
import { createList } from './lists'
import { sharedToItem, type SharePayload } from './share'
import { Sheet } from './Sheet'

/**
 * What you see when you open a link someone shared with you. Nothing is written
 * until you say so — an inbound link never silently mutates your data.
 */
export function ImportSheet({
  payload,
  activeListId,
  onClose,
  onDone,
}: {
  payload: SharePayload
  activeListId: number
  onClose: () => void
  onDone: (msg: string, listId?: number) => void
}) {
  const lists = useLiveQuery(() => db.lists.toArray(), []) ?? []
  const [busy, setBusy] = useState(false)

  if (payload.t === 'recipe') {
    const save = async () => {
      setBusy(true)
      const recipe: Omit<Recipe, 'id'> = {
        title: payload.title,
        servings: payload.servings,
        ingredients: payload.ingredients.map((i) => ({
          displayName: i.n,
          canonicalKey: i.k,
          quantity: i.q,
          unit: i.u,
          section: i.s,
        })),
        instructions: payload.instructions,
        createdAt: Date.now(),
      }
      const existing = await db.recipes.where('title').equals(recipe.title).first()
      if (existing?.id != null) await db.recipes.update(existing.id, recipe)
      else await db.recipes.add(recipe as Recipe)
      onDone(`Saved “${payload.title}” to your recipes`)
    }

    return (
      <Sheet className="import" onClose={onClose}>
        <div className="import-badge">📖 Shared recipe</div>
        <h3 className="sheet-title">{payload.title}</h3>
        <p className="review-hint">
          {payload.servings ? `Serves ${payload.servings} · ` : ''}
          {payload.ingredients.length} ingredients
          {payload.instructions ? ' · includes steps' : ''}
        </p>
        <div className="ing-list">
          {payload.ingredients.map((i, idx) => (
            <div key={idx} className="ing-row">
              <span className="ing-name">{i.n}</span>
              <span className="ing-qty">
                {i.q != null ? `${i.q}${i.u ? ' ' + i.u : ''}` : ''}
              </span>
            </div>
          ))}
        </div>
        <button className="primary" onClick={save} disabled={busy}>
          Save to my recipes
        </button>
        <button className="ghost" style={{ marginTop: 10 }} onClick={onClose}>
          No thanks
        </button>
      </Sheet>
    )
  }

  // --- a shared list ---
  const meta = KINDS[payload.kind]
  const compatible = lists.filter((l) => l.kind === payload.kind)

  const importAsNew = async () => {
    setBusy(true)
    const id = await createList(payload.name, payload.kind)
    for (const s of payload.items) {
      const it = sharedToItem(s)
      await addItem({
        listId: id,
        displayName: it.displayName,
        canonicalKey: it.canonicalKey,
        quantity: it.quantity,
        unit: it.unit,
        section: it.section,
        dueAt: it.dueAt,
        notes: it.notes,
      })
    }
    onDone(`Imported “${payload.name}” (${payload.items.length} items)`, id)
  }

  const mergeIntoExisting = async (listId: number, listName: string) => {
    setBusy(true)
    for (const s of payload.items) {
      const it = sharedToItem(s)
      await addItem({
        listId,
        displayName: it.displayName,
        canonicalKey: it.canonicalKey,
        quantity: it.quantity,
        unit: it.unit,
        section: it.section,
        dueAt: it.dueAt,
        notes: it.notes,
      })
    }
    onDone(`Merged ${payload.items.length} items into “${listName}”`, listId)
  }

  return (
    <Sheet className="import" onClose={onClose}>
      <div className="import-badge">
        {meta.icon} Shared {meta.label.toLowerCase()} list
      </div>
      <h3 className="sheet-title">{payload.name}</h3>
      <p className="review-hint">{payload.items.length} items</p>

      <div className="ing-list">
        {payload.items.map((i, idx) => (
          <div key={idx} className="ing-row">
            <span className="ing-name">{i.n}</span>
            <span className="ing-qty">
              {i.q != null ? `${i.q}${i.u ? ' ' + i.u : ''}` : ''}
            </span>
          </div>
        ))}
      </div>

      <button className="primary" onClick={importAsNew} disabled={busy}>
        Keep as a new list
      </button>

      {compatible.length > 0 && (
        <>
          <p className="qa-head">Or merge into</p>
          <div className="list-rows">
            {compatible.map((l) => (
              <button
                key={l.id}
                className={l.id === activeListId ? 'list-row on' : 'list-row'}
                disabled={busy}
                onClick={() => mergeIntoExisting(l.id!, l.name)}
              >
                <span className="list-icon">{KINDS[l.kind].icon}</span>
                <span className="list-body">
                  <span className="list-name">{l.name}</span>
                  <span className="list-sub">duplicates will merge</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      <button className="ghost" style={{ marginTop: 12, width: '100%' }} onClick={onClose}>
        No thanks
      </button>
    </Sheet>
  )
}
