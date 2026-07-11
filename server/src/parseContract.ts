/** Shared parse contract — the JSON shape Claude must return. */

export const SECTIONS = [
  'produce',
  'meat',
  'dairy',
  'bakery',
  'frozen',
  'pantry',
  'household',
  'other',
] as const

/** JSON Schema for structured outputs (output_config.format).
 *  Constraints: every object needs `required` + additionalProperties:false;
 *  optional fields are expressed as nullable rather than omitted. */
export const PARSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sourceType', 'recipeTitle', 'servings', 'items'],
  properties: {
    sourceType: { type: 'string', enum: ['recipe', 'list'] },
    recipeTitle: { type: ['string', 'null'] },
    servings: { type: ['integer', 'null'] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['displayName', 'canonicalKey', 'quantity', 'unit', 'section'],
        properties: {
          displayName: { type: 'string' },
          canonicalKey: { type: 'string' },
          quantity: { type: ['number', 'null'] },
          unit: { type: ['string', 'null'] },
          section: { type: 'string', enum: SECTIONS },
        },
      },
    },
  },
} as const

export const SYSTEM_PROMPT = `You turn messy grocery and recipe input into a clean, structured shopping list. You will receive text that a user typed, pasted, or that was extracted from a recipe web page or a photo of a handwritten/whiteboard list.

Return ONLY structured data matching the schema. Rules:

- Extract every distinct grocery item. Ignore prose, section labels, prep steps, and non-shopping lines.
- displayName: a natural, shopping-friendly name (e.g. "yellow onion", "boneless chicken breast").
- canonicalKey: a normalized merge key — lowercase, singular, no brand/adjectives that don't change what you buy. "yellow onions" and "1 diced onion" both -> "onion"; "boneless skinless chicken breasts" -> "chicken breast". This is how duplicates across sources get merged, so be consistent.
- quantity: a number if one is stated or clearly implied, else null. Convert written numbers ("two") and simple fractions ("1/2" -> 0.5). Do not invent quantities.
- unit: the unit of measure if present (cup, lb, oz, clove, can, bunch, whole...), else null. If the item is just a count of whole things (e.g. "2 onions"), use "whole".
- section: the store section, chosen ONLY from: produce, meat, dairy, bakery, frozen, pantry, household, other. Pick the best fit; use "other" only when nothing fits.
- sourceType: "recipe" if the input is clearly a single recipe (title + ingredients, maybe steps), otherwise "list".
- recipeTitle: the recipe's name when sourceType is "recipe", else null.
- servings: the number of servings/yield when clearly stated for a recipe, else null.

Be thorough but do not duplicate the same canonicalKey+unit within your output — merge those yourself and sum quantities.`
