import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Recipe } from './db'
import { addRecipeToList } from './recipes'
import { formatQty } from './list'
import { defaultGroceryListId } from './lists'
import { encodeShare, shareLink, shareRecipePayload } from './share'

export function RecipesView({
  activeListId,
  onAddRecipe,
  onAdded,
  onToast,
}: {
  activeListId: number
  onAddRecipe: () => void
  onAdded: () => void
  onToast: (msg: string) => void
}) {
  const recipes =
    useLiveQuery(async () => {
      const all = await db.recipes.toArray()
      return all.sort((a, b) => b.createdAt - a.createdAt)
    }, []) ?? []
  const [selected, setSelected] = useState<Recipe | null>(null)

  if (selected) {
    return (
      <div className="view">
        <RecipeDetail
          recipe={selected}
          activeListId={activeListId}
          onBack={() => setSelected(null)}
          onToast={onToast}
          onDone={() => {
            setSelected(null)
            onAdded()
          }}
        />
      </div>
    )
  }

  return (
    <div className="view">
      <div className="view-head">
        <h2 className="view-title">Recipes</h2>
        <button className="add-btn" onClick={onAddRecipe}>
          ＋ Add
        </button>
      </div>
      {recipes.length === 0 ? (
        <p className="view-empty">
          No recipes yet. Paste or snap a recipe and it saves itself here.
        </p>
      ) : (
        <div className="recipe-list">
          {recipes.map((r) => (
            <button key={r.id} className="recipe-card" onClick={() => setSelected(r)}>
              <span className="recipe-title">{r.title}</span>
              <span className="recipe-sub">
                {r.servings ? `serves ${r.servings} · ` : ''}
                {r.ingredients.length} ingredients
                {r.instructions ? ' · has steps' : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function RecipeDetail({
  recipe,
  activeListId,
  onBack,
  onDone,
  onToast,
}: {
  recipe: Recipe
  activeListId: number
  onBack: () => void
  onDone: () => void
  onToast: (msg: string) => void
}) {
  const base = recipe.servings || 0
  const [n, setN] = useState(base || 1)
  const factor = base ? n / base : n
  const step = base ? 1 : 0.5
  const min = base ? 1 : 0.5

  // Ingredients always land on a grocery list, even if you're standing on a
  // task list when you tap Add.
  const add = async () => {
    const target = await defaultGroceryListId(activeListId)
    if (target == null) {
      onToast('No grocery list to add to — make one first.')
      return
    }
    await addRecipeToList(recipe, factor, target)
    onDone()
  }

  const share = async () => {
    const url = await encodeShare(shareRecipePayload(recipe))
    const how = await shareLink(url, recipe.title)
    if (how === 'copied') onToast('Recipe link copied to clipboard')
    else if (how === 'failed') onToast('Could not share that recipe.')
  }

  const remove = async () => {
    if (confirm(`Delete “${recipe.title}” from your recipes?`)) {
      await db.recipes.delete(recipe.id!)
      onBack()
    }
  }

  return (
    <>
      <div className="detail-head">
        <button className="icon-back" onClick={onBack} aria-label="Back to recipes">
          ‹
        </button>
        <h2 className="detail-title">{recipe.title}</h2>
        <button className="icon-share" onClick={share} aria-label="Share recipe">
          ↗
        </button>
      </div>

      <div className="scaler">
        <span className="scaler-label">{base ? 'Servings' : 'Batch ×'}</span>
        <div className="stepper">
          <button onClick={() => setN((v) => Math.max(min, +(v - step).toFixed(2)))}>−</button>
          <span className="stepper-val">{base ? n : `×${n}`}</span>
          <button onClick={() => setN((v) => +(v + step).toFixed(2))}>＋</button>
        </div>
        {base > 0 && n !== base && <span className="scaler-note">{factor.toFixed(2)}×</span>}
      </div>

      <div className="ing-list">
        {recipe.ingredients.map((ing, i) => (
          <div key={i} className="ing-row">
            <span className="ing-name">{ing.displayName}</span>
            <span className="ing-qty">
              {formatQty({
                quantity:
                  ing.quantity != null
                    ? Math.round(ing.quantity * factor * 100) / 100
                    : undefined,
                unit: ing.unit,
              })}
            </span>
          </div>
        ))}
      </div>

      {recipe.instructions && (
        <div className="steps">
          <h4 className="steps-head">Instructions</h4>
          <p className="steps-body">{recipe.instructions}</p>
        </div>
      )}

      <button className="primary" onClick={add}>
        Add to list
      </button>
      <button className="ghost danger" onClick={remove} style={{ marginTop: 10 }}>
        Delete recipe
      </button>
    </>
  )
}
