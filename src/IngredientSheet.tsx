import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { Sheet } from './Sheet'
import { Icon } from './Icon'
import { formatQty } from './list'
import { defaultGroceryListId } from './lists'
import {
  addIngredientToList,
  addIngredientToPantry,
  ingredientStatus,
  statusLines,
  type IngredientLine,
  type IngredientStatus,
} from './ingredient'

/**
 * The sheet itself, with no data access: everything it shows comes in as props
 * so it can be rendered and tested on its own.
 */
export function IngredientSheetView({
  ing,
  qty,
  status,
  listName,
  busy,
  onList,
  onPantry,
  onClose,
}: {
  ing: IngredientLine
  /** The amount for the current serving size, already formatted ("1 tsp"). */
  qty: string
  status: IngredientStatus | undefined
  /** The shopping list "Add" lands on, or null when there is none. */
  listName: string | null
  busy: boolean
  onList: () => void
  onPantry: () => void
  onClose: () => void
}) {
  const lines = status ? statusLines(ing, status) : []
  // What each tap will do, from the same rows the actions use.
  const pantryRow = status?.pantryTarget
  const inStock = !!pantryRow && !pantryRow.checked
  const markedOut = !!pantryRow && pantryRow.checked
  const mergeWith = status?.listTarget
  return (
    <Sheet className="menu" label={`${ing.displayName}`} onClose={onClose}>
      <h3 className="sheet-title">{ing.displayName}</h3>
      {qty && <p className="ing-sheet-qty">{qty}</p>}
      <ul className="ing-status" aria-label="Where it is now">
        {status && lines.length === 0 && <li className="ing-status-none">Not in your pantry or on a list yet</li>}
        {lines.map((l, i) => (
          <li key={i} className="ing-status-line">
            <Icon name={l.startsWith('In your pantry') ? 'pantry' : 'cart'} size={16} />
            {l}
          </li>
        ))}
      </ul>
      <button className="menu-item" disabled={busy || listName == null} onClick={onList}>
        <Icon name="cart" size={20} />
        <span className="menu-item-body">
          Add to Shopping List
          <span className="menu-item-sub">
            {listName == null
              ? 'Make a grocery list first'
              : mergeWith
                ? `Merges with the line already on ${listName}`
                : `${qty ? `${qty} to ` : 'To '}${listName}`}
          </span>
        </span>
      </button>
      <button className="menu-item" disabled={busy} onClick={onPantry}>
        <Icon name="pantry" size={20} />
        <span className="menu-item-body">
          Add to Pantry
          <span className="menu-item-sub">
            {inStock ? 'Already there, nothing changes' : markedOut ? 'Marks it back in stock' : 'Something you keep on hand'}
          </span>
        </span>
      </button>
    </Sheet>
  )
}

/** The tap-an-ingredient sheet on a recipe: where it is, and two ways to add it. */
export function IngredientSheet({
  ing,
  factor,
  activeListId,
  onClose,
  onToast,
}: {
  ing: IngredientLine
  /** Servings scale, so the amount added matches the amount shown. */
  factor: number
  activeListId: number
  onClose: () => void
  onToast: (msg: string) => void
}) {
  const data = useLiveQuery(async () => {
    const id = await defaultGroceryListId(activeListId)
    const target = id == null ? null : { id, name: (await db.lists.get(id))?.name ?? 'Groceries' }
    return { target, status: await ingredientStatus(ing, id ?? undefined) }
  }, [activeListId, ing.displayName, ing.canonicalKey, ing.unit])
  const status = data?.status
  const target = data?.target
  const [busy, setBusy] = useState(false)

  const qty = formatQty({
    quantity: ing.quantity != null ? Math.round(ing.quantity * factor * 100) / 100 : undefined,
    unit: ing.unit,
  })

  const run = async (fn: () => Promise<string>) => {
    setBusy(true)
    try {
      onToast(await fn())
      onClose()
    } catch {
      onToast('Could not add that.')
      setBusy(false)
    }
  }

  return (
    <IngredientSheetView
      ing={ing}
      qty={qty}
      status={status}
      listName={target === undefined ? 'your list' : (target?.name ?? null)}
      busy={busy || status === undefined}
      onClose={onClose}
      onList={() =>
        target &&
        run(async () => {
          const r = await addIngredientToList(ing, factor, target.id)
          return r.result === 'merged'
            ? `Merged with ${r.item.displayName} on ${target.name}`
            : `Added ${ing.displayName} to ${target.name}`
        })
      }
      onPantry={() =>
        run(async () => {
          const r = await addIngredientToPantry(ing)
          return r.result === 'added'
            ? `Added ${ing.displayName} to your pantry`
            : r.result === 'restocked'
              ? `${r.item.displayName} is back in stock`
              : `${r.item.displayName} is already in your pantry`
        })
      }
    />
  )
}
