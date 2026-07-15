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
  required: ['sourceType', 'recipeTitle', 'servings', 'instructions', 'items', 'tips'],
  properties: {
    sourceType: { type: 'string', enum: ['recipe', 'list'] },
    recipeTitle: { type: ['string', 'null'] },
    servings: { type: ['integer', 'null'] },
    instructions: { type: ['string', 'null'] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['displayName', 'canonicalKey', 'quantity', 'unit', 'section', 'optional'],
        properties: {
          displayName: { type: 'string' },
          canonicalKey: { type: 'string' },
          quantity: { type: ['number', 'null'] },
          unit: { type: ['string', 'null'] },
          section: { type: 'string', enum: SECTIONS },
          optional: { type: 'boolean' },
        },
      },
    },
    // Serving suggestions / variations / ideas the recipe offers, beyond the
    // core method. Never turned into shopping items. Empty when the input has none.
    tips: { type: 'array', items: { type: 'string' } },
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
- instructions: when sourceType is "recipe" and cooking steps are present, capture the COMPLETE steps as readable numbered text ("1. ...\n2. ..."). Preserve every concrete detail exactly: temperatures (e.g. 375°F), times/durations (e.g. 25 minutes), pan/dish sizes, and the amounts used in each step (e.g. "add 2 tbsp of the butter"). Do not summarize, shorten, or omit steps — reproduce the method in full so it can be cooked from memory. Null only for a plain list, or a recipe that genuinely has no method given.
- optional: true ONLY for an ingredient the recipe itself presents as not required — labeled "optional", "to taste", "for garnish", "for serving", "if desired", or offered as an add-on/topping/variation. Everything the core recipe actually requires is optional:false. Do not guess; only mark what the recipe explicitly treats as optional.
- tips: an array of short, standalone ideas the recipe offers BEYOND the core method — serving suggestions, variations, substitutions, make-ahead/storage notes, or "you can also…" ideas (e.g. "Bake the tortillas draped over an upturned muffin tin to make crispy taco bowls"). One idea per string, concise, in the recipe's own spirit. Empty array [] when the input offers none. Never invent tips, and never put a required cooking step here — steps go in instructions.

Be thorough but do not duplicate the same canonicalKey+unit within your output — merge those yourself and sum quantities.`

/** Schema for POST /api/prices — a price (USD) per catalog item. */
export const PRICES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['prices'],
  properties: {
    prices: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['canonicalKey', 'price'],
        properties: {
          canonicalKey: { type: 'string' },
          price: { type: 'number' },
        },
      },
    },
  },
} as const

/** Schema for POST /api/refine — concrete product options per item. */
export const REFINE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['canonicalKey', 'options'],
        properties: {
          canonicalKey: { type: 'string' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label', 'unit', 'price'],
              properties: {
                label: { type: 'string' },
                unit: { type: 'string' },
                price: { type: 'number' },
              },
            },
          },
        },
      },
    },
  },
} as const

export function refineSystem(store: string): string {
  return `You help a shopper turn vague grocery-list items into specific purchase choices at ${store}.

For each item you are given, return 2 to 4 concrete product options a shopper would realistically choose between at ${store}. Cover the common, meaningful variations — especially size/count and type — that change what you buy or what it costs. Examples: eggs → "Large eggs, dozen" vs "Large eggs, 18 ct" vs "Cage-free, dozen"; milk → "Whole milk, gallon" vs "Whole milk, ½ gal"; ground beef → "80/20, 1 lb" vs "80/20, family pack ~3 lb".

For each option provide:
- label: a short, specific product name including the size/type (e.g. "Large eggs, 18 ct").
- unit: the size or unit that label represents (e.g. "18 ct", "gallon", "lb", "3 lb pack").
- price: realistic ${store} price in US dollars for that option (a plain number).

Return exactly one entry per canonicalKey you were given, with its options ordered from most common/cheapest to larger/pricier. Use realistic ${store} pricing.`
}

export function pricesSystem(store: string): string {
  return `You estimate typical current retail grocery prices in US dollars at ${store}.

For each item you are given (canonicalKey, a display name, and sometimes a unit), return your best estimate of the price a shopper would pay at ${store}, as a plain number of dollars (e.g. 3.49).

- If a unit is given, price that unit or the smallest sensible package that covers it (e.g. "lb" → price per pound; "can" → one can; "whole" → each, or a typical bunch/bag if sold that way).
- If no unit is given, price the typical single package a shopper buys.
- Use realistic ${store} pricing — a value-oriented store is cheaper than a premium grocer.
- Return exactly one entry per canonicalKey you were given. Never return 0 or null; give your best realistic estimate.`
}
