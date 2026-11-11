import { useState } from 'react'
import { db } from './db'
import { parseManualIngredients } from './recipes'
import { Sheet } from './Sheet'
import { Field } from './Field'

export function RecipeForm({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('')
  const [servings, setServings] = useState('')
  const [ingredients, setIngredients] = useState('')
  const [instructions, setInstructions] = useState('')

  const canSave = title.trim() && ingredients.trim()

  const save = async () => {
    if (!canSave) return
    await db.recipes.add({
      title: title.trim(),
      servings: servings.trim() ? Number(servings) || 0 : 0,
      ingredients: parseManualIngredients(ingredients),
      instructions: instructions.trim() || undefined,
      createdAt: Date.now(),
    })
    onClose()
  }

  return (
    <Sheet className="recipe-form" label="Recipe" onClose={onClose}>
      <h3 className="sheet-title">New Recipe</h3>
      <Field id="rf-title" label="Name">
        {(p) => (
          <input
            {...p}
            className="field name-field"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        )}
      </Field>
      <Field id="rf-servings" label="Servings (optional)" className="rf-gap">
        {(p) => (
          <input
            {...p}
            className="field"
            inputMode="numeric"
            value={servings}
            onChange={(e) => setServings(e.target.value)}
          />
        )}
      </Field>
      <Field
        id="rf-ingredients"
        label="Ingredients, one per line"
        hint="Example: 2 cup flour"
        className="rf-gap"
      >
        {(p) => (
          <textarea
            {...p}
            className="field textarea"
            value={ingredients}
            onChange={(e) => setIngredients(e.target.value)}
          />
        )}
      </Field>
      <Field id="rf-steps" label="Instructions (optional)" className="rf-gap">
        {(p) => (
          <textarea
            {...p}
            className="field textarea"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        )}
      </Field>
      <button className="primary" onClick={save} disabled={!canSave} style={{ marginTop: 12 }}>
        Save Recipe
      </button>
    </Sheet>
  )
}
