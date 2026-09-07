import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { Sheet } from './Sheet'
import { Icon } from './Icon'

/**
 * Put a saved recipe on a plan.
 *
 * The entry stores the recipe's sync `uid`, not its local id — a meal plan is
 * exactly the sort of thing that syncs, and a local id means nothing on another
 * device. A recipe with no uid yet (saved before sync existed, and not yet
 * stamped) is offered but noted, because silently omitting recipes from a
 * picker is worse than explaining one.
 */
export function RecipePickSheet({
  onPick,
  onClose,
}: {
  onPick: (recipe: { uid?: string; title: string }) => void
  onClose: () => void
}) {
  const recipes =
    useLiveQuery(async () => {
      const all = await db.recipes.toArray()
      return all.sort((a, b) => a.title.localeCompare(b.title))
    }, []) ?? []

  return (
    <Sheet className="menu" label="Choose a recipe" onClose={onClose}>
      {recipes.length === 0 ? (
        <p className="view-empty">
          No saved recipes yet. Add one under Recipes, then it can go on a plan.
        </p>
      ) : (
        recipes.map((r) => (
          <button key={r.id} className="menu-item" onClick={() => onPick(r)}>
            <Icon name="book" size={20} />
            <span className="menu-item-body">
              <span>{r.title}</span>
              <span className="menu-item-sub">
                {r.ingredients.length} ingredients
                {r.servings ? ` · serves ${r.servings}` : ''}
              </span>
            </span>
          </button>
        ))
      )}
    </Sheet>
  )
}
