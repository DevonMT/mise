import { db, canonicalize, type Recipe } from './db'
import { addItem } from './list'
import { getStapleKeys, type ParseResult } from './parse'

const KNOWN_UNITS = new Set([
  'cup', 'cups', 'tbsp', 'tsp', 'oz', 'lb', 'lbs', 'g', 'kg', 'ml', 'l',
  'clove', 'cloves', 'can', 'cans', 'bunch', 'pkg', 'stick', 'sticks',
  'whole', 'dozen', 'pinch', 'slice', 'slices', 'quart', 'pint', 'gal',
])

/** Best-effort local parse of manually-typed ingredient lines (no AI). */
export function parseManualIngredients(text: string): Recipe['ingredients'] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      let quantity: number | undefined
      let unit: string | undefined
      let name = line
      const m = line.match(/^(\d+(?:\.\d+)?|\d+\/\d+)\s+(.*)$/)
      if (m) {
        quantity = m[1].includes('/')
          ? Number(m[1].split('/')[0]) / Number(m[1].split('/')[1])
          : Number(m[1])
        let rest = m[2]
        const words = rest.split(/\s+/)
        if (words.length > 1 && KNOWN_UNITS.has(words[0].toLowerCase())) {
          unit = words[0]
          rest = words.slice(1).join(' ')
        }
        name = rest
      }
      return {
        displayName: name,
        canonicalKey: canonicalize(name),
        quantity: quantity != null && Number.isFinite(quantity) ? quantity : undefined,
        unit,
        section: 'other' as const,
      }
    })
}

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
    instructions: result.instructions ?? undefined,
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

/** Add a recipe's ingredients to a grocery list, scaled by `factor` (default 1).
 *  Staples are skipped, same as the capture review. */
export async function addRecipeToList(
  recipe: Recipe,
  factor = 1,
  listId: number,
): Promise<void> {
  const staples = await getStapleKeys()
  for (const ing of recipe.ingredients) {
    if (staples.has(ing.canonicalKey)) continue
    await addItem({
      listId,
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
