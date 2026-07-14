import { useState } from 'react'
import { db } from './db'
import { parseManualIngredients } from './recipes'
import { Sheet } from './Sheet'

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
    <Sheet className="recipe-form" onClose={onClose}>
      <h3 className="sheet-title">New recipe</h3>
      <input
        className="field name-field"
        placeholder="Recipe name"
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <input
        className="field"
        placeholder="Servings (optional)"
        inputMode="numeric"
        value={servings}
        onChange={(e) => setServings(e.target.value)}
        style={{ marginTop: 10 }}
      />
      <label className="form-label">Ingredients — one per line</label>
      <textarea
        className="field textarea"
        placeholder={'2 cup flour\n1 tsp salt\n3 eggs'}
        value={ingredients}
        onChange={(e) => setIngredients(e.target.value)}
      />
      <label className="form-label">Instructions (optional)</label>
      <textarea
        className="field textarea"
        placeholder={'1. Mix the dry ingredients…'}
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
      />
      <button className="primary" onClick={save} disabled={!canSave} style={{ marginTop: 12 }}>
        Save recipe
      </button>
    </Sheet>
  )
}
