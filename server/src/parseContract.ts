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

Brands:
- You may name well-known NATIONAL / manufacturer brands that are sold across most stores (e.g. Heinz, Kraft, Pace, Barilla, Chobani).
- For a store-brand / value option, label it simply "Store brand …" (e.g. "Store brand ketchup, 20 oz"). Do NOT attach one retailer's private label to a different store. "Great Value" is Walmart's brand ONLY; "Simple Truth"/"Kroger" are Kroger's; "Signature Select" is Albertsons/Safeway; "Good & Gather" is Target's. Never use any of these unless ${store} is literally that chain. Unless you are certain of ${store}'s own store-brand name, just write "Store brand".

For each option provide:
- label: a short, specific product name including the size/type (e.g. "Large eggs, 18 ct", "Store brand salsa, 16 oz jar").
- unit: the size or unit that label represents (e.g. "18 ct", "gallon", "lb", "3 lb pack").
- price: realistic ${store} price in US dollars for that option (a plain number).

Return exactly one entry per canonicalKey you were given, with its options ordered from most common/cheapest to larger/pricier. Use realistic ${store} pricing.`
}

export function pricesSystem(store: string): string {
  return `You estimate what a shopper actually PAYS at ${store} to buy each grocery item — the price of the package or unit they put in the cart, in US dollars (e.g. 3.49).

For each item (a canonicalKey, a display name, and sometimes a unit):
- Price WHAT THE SHOPPER BUYS, never a recipe portion. If the unit is a cooking measure — cup, tbsp, tsp, clove, slice, gram, ounce, ml, pinch, stick — the shopper still buys a whole package, so price that typical package, NOT the fractional amount. Examples: salsa with unit "cup" → one jar of salsa (~$3–4); flour "cup" → a bag of flour; parmesan "cup" → a wedge or tub; butter "tbsp" → a package of butter.
- If the unit is a real purchase unit, price ONE of it: "whole"/"each" → one item (e.g. one onion, one bell pepper); "lb" → one pound; "can"/"jar"/"bottle"/"box"/"bag" → one of them; "dozen" → a dozen; "bunch" → a bunch; "gallon" → a gallon.
- If no unit is given, price the typical single package or item a shopper buys.
- Use realistic ${store} pricing — a value-oriented store is cheaper than a premium grocer.
- Return exactly one entry per canonicalKey. Never return 0 or null, and never less than about $0.30 for a real grocery item — give your best realistic estimate of the real shelf price.`
}
