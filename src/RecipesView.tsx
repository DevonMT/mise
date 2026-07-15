import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Recipe } from './db'
import { addRecipeToList } from './recipes'
import { formatQty } from './list'
import { defaultGroceryListId } from './lists'
import { encodeShare, shareLink, shareRecipePayload } from './share'
import { Icon } from './Icon'
import { AI_ENABLED } from './edition'

export function RecipesView({
  activeListId,
  onAddRecipe,
  onAdded,
  onToast,
}: {
  activeListId: number
  onAddRecipe: () => void
  /** The grocery list the ingredients actually landed on — may not be the one
   *  you were standing on, so the caller switches you to it. */
  onAdded: (listId: number) => void
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
          onDone={(listId) => {
            setSelected(null)
            onAdded(listId)
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
          <Icon name="plus" size={18} /> Add
        </button>
      </div>
      {recipes.length === 0 ? (
        <p className="view-empty">
          No recipes yet. Tap <strong>Add</strong> to{' '}
          {AI_ENABLED ? 'snap, paste, link, or type one in.' : 'enter one.'}
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
                {r.tips && r.tips.length > 0 ? ' · has tips' : ''}
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
  onDone: (listId: number) => void
  onToast: (msg: string) => void
}) {
  const base = recipe.servings || 0
  const [n, setN] = useState(base || 1)
  const factor = base ? n / base : n
  const step = base ? 1 : 0.5
  const min = base ? 1 : 0.5
  // Which optional ingredients (by index into recipe.ingredients) to include.
  const [optSel, setOptSel] = useState<Set<number>>(new Set())

  const indexed = recipe.ingredients.map((ing, i) => ({ ing, i }))
  const required = indexed.filter((x) => !x.ing.optional)
  const optional = indexed.filter((x) => x.ing.optional)
  const tips = recipe.tips ?? []

  const toggleOpt = (i: number) =>
    setOptSel((s) => {
      const next = new Set(s)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })

  // Ingredients only ever land on a grocery list — a pantry is what you *have*
  // and a task list has no use for flour, so neither can receive a recipe.
  // If you're standing on one of those, we find a grocery list and say so.
  const add = async () => {
    const target = await defaultGroceryListId(activeListId)
    if (target == null) {
      onToast('No grocery list to add to — make one first.')
      return
    }
    await addRecipeToList(recipe, factor, target, optSel)
    onDone(target)
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

  const qtyOf = (ing: Recipe['ingredients'][number]) =>
    formatQty({
      quantity: ing.quantity != null ? Math.round(ing.quantity * factor * 100) / 100 : undefined,
      unit: ing.unit,
    })

  return (
    <>
      <div className="detail-head">
        <button className="icon-back" onClick={onBack} aria-label="Back to recipes">
          <Icon name="back" size={22} />
        </button>
        <h2 className="detail-title">{recipe.title}</h2>
        <button className="icon-share" onClick={share} aria-label="Share recipe">
          <Icon name="share" size={20} />
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
        {required.map(({ ing, i }) => (
          <div key={i} className="ing-row">
            <span className="ing-name">{ing.displayName}</span>
            <span className="ing-qty">{qtyOf(ing)}</span>
          </div>
        ))}
      </div>

      {optional.length > 0 && (
        <div className="opt-block">
          <h4 className="steps-head">Optional — tap to include</h4>
          <div className="ing-list">
            {optional.map(({ ing, i }) => {
              const on = optSel.has(i)
              return (
                <button
                  key={i}
                  className={on ? 'opt-row on' : 'opt-row'}
                  onClick={() => toggleOpt(i)}
                >
                  <span className="opt-check">{on ? '✓' : ''}</span>
                  <span className="ing-name">{ing.displayName}</span>
                  <span className="ing-qty">{qtyOf(ing)}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {recipe.instructions && (
        <div className="steps">
          <h4 className="steps-head">Instructions</h4>
          <p className="steps-body">{recipe.instructions}</p>
        </div>
      )}

      {tips.length > 0 && (
        <div className="tips">
          <h4 className="steps-head steps-head-icon">
            <Icon name="bulb" size={16} /> Tips &amp; ideas
          </h4>
          <ul className="tips-list">
            {tips.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      )}

      <button className="primary" onClick={add}>
        Add to list{optSel.size > 0 ? ` · +${optSel.size} optional` : ''}
      </button>
      <button className="ghost danger" onClick={remove} style={{ marginTop: 10 }}>
        Delete recipe
      </button>
    </>
  )
}
