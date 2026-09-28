import type { Recipe, RecipeIngredient } from './db'

/**
 * A recipe as a text message.
 *
 * Plain text because the person on the other end may not have Mise, an
 * account, or anything but the Messages app. Scaled to whatever servings you
 * were looking at, since "I'm making this for 8" is usually why you are
 * sending it.
 */

const FRACTIONS: Array<[number, string]> = [
  [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'],
  [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'],
]

/** 0.75 → "¾", 1.5 → "1½", 2.4 → "2.4". Cooks read fractions, not decimals. */
export function kitchenNumber(n: number): string {
  const whole = Math.floor(n)
  const rest = n - whole
  if (rest < 0.02) return String(whole)
  if (rest > 0.98) return String(whole + 1)
  const hit = FRACTIONS.find(([v]) => Math.abs(v - rest) < 0.02)
  if (!hit) return String(Math.round(n * 100) / 100)
  return whole ? `${whole}${hit[1]}` : hit[1]
}

function line(ing: RecipeIngredient, factor: number): string {
  if (ing.quantity == null) return `• ${ing.displayName}`
  const q = kitchenNumber(ing.quantity * factor)
  // "whole" is how the parser marks a countable thing; "3 whole eggs" reads
  // worse than "3 eggs".
  const unit = ing.unit && ing.unit !== 'whole' ? ` ${ing.unit}` : ''
  return `• ${q}${unit} ${ing.displayName}`
}

export function recipeText(recipe: Recipe, factor = 1): string {
  const out: string[] = [recipe.title]
  if (recipe.servings) out.push(`Serves ${kitchenNumber(recipe.servings * factor)}`)

  const required = recipe.ingredients.filter((i) => !i.optional)
  const optional = recipe.ingredients.filter((i) => i.optional)
  out.push('', 'INGREDIENTS', ...required.map((i) => line(i, factor)))
  if (optional.length) out.push('', 'OPTIONAL', ...optional.map((i) => line(i, factor)))

  if (recipe.instructions?.trim()) out.push('', 'STEPS', recipe.instructions.trim())
  if (recipe.tips?.length) out.push('', 'TIPS', ...recipe.tips.map((t) => `• ${t}`))
  return out.join('\n')
}

/**
 * Open the phone's Messages app with `body` filled in and no recipient, so you
 * pick who. `sms:?&body=` is the spelling both Android and iOS accept.
 */
export function smsHref(body: string): string {
  return `sms:?&body=${encodeURIComponent(body)}`
}
