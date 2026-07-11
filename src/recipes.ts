import { db, type Recipe } from './db'
import { addItem } from './list'
import { getStapleKeys, type ParseResult } from './parse'

/**
 * Save (or update) a recipe from a parse result, if it looks like a recipe.
 * Dedupes by title. Returns the recipe id, or null if it wasn't a recipe.
 */
export async function saveRecipeFromParse(result: ParseResult): Promise<number | null> {
  if (result.sourceType !== 'recipe' || !result.recipeTitle) return null

  const recipe: Omit<Recipe, 'id'> = {
    title: result.recipeTitle.trim(),
    servings: result.servings ?? 0,
    ingredients: result.items.map((i) => ({
      displayName: i.displayName,
      canonicalKey: i.canonicalKey,
      quantity: i.quantity ?? undefined,
      unit: i.unit ?? undefined,
      section: i.section,
    })),
    source: undefined,
    createdAt: Date.now(),
  }

  const existing = await db.recipes.where('title').equals(recipe.title).first()
  if (existing?.id != null) {
    await db.recipes.update(existing.id, recipe)
    return existing.id
  }
  return db.recipes.add(recipe as Recipe)
}

/** Add a recipe's ingredients to the active list, scaled by `factor` (default 1).
 *  Staples are skipped, same as the capture review. */
export async function addRecipeToList(recipe: Recipe, factor = 1): Promise<void> {
  const staples = await getStapleKeys()
  for (const ing of recipe.ingredients) {
    if (staples.has(ing.canonicalKey)) continue
    await addItem({
      displayName: ing.displayName,
      canonicalKey: ing.canonicalKey,
      quantity:
        ing.quantity != null ? round2(ing.quantity * factor) : undefined,
      unit: ing.unit,
      section: ing.section,
    })
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
