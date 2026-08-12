/** Shared parse contract — the JSON shape Claude must return. */

/** Store-section taxonomy — MUST stay in sync with the Section union in
 *  src/db.ts and the ordered list in src/sections.ts. */
export const SECTIONS = [
  'produce',
  'bakery',
  'deli',
  'meat',
  'dairy',
  'frozen',
  'pantry',
  'baking',
  'condiments',
  'snacks',
  'beverages',
  'household',
  'personal',
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
        required: [
          'displayName',
          'canonicalKey',
          'quantity',
          'unit',
          'buyCount',
          'sizeAmount',
          'sizeUnit',
          'packaging',
          'section',
          'optional',
        ],
        properties: {
          displayName: { type: 'string' },
          canonicalKey: { type: 'string' },
          quantity: { type: ['number', 'null'] },
          unit: { type: ['string', 'null'] },
          // Buy layer — filled ONLY when the source itself states a package
          // size ("2 (10 1/2 oz) cans"). All null otherwise; Refine fills it in
          // later. Mirrors the Item fields in src/db.ts.
          buyCount: { type: ['integer', 'null'] },
          sizeAmount: { type: ['number', 'null'] },
          sizeUnit: { type: ['string', 'null'] },
          packaging: { type: ['string', 'null'] },
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
- Skip ingredients nobody shops for, even when the recipe lists them as ingredients: plain water in any form ("1 1/2 cups water", "warm water", "water for boiling"), ice, and anything the recipe makes from other listed ingredients. They still belong in the instructions — they just never become shopping items.
- displayName: the product AS IT IS SOLD, in shopping-friendly words (e.g. "yellow onion", "boneless chicken breast"). Strip the prep the cook does to it — chopped, diced, minced, sliced, grated, melted, softened, cooked, drained, rinsed, divided, room temperature — including a trailing prep clause after a comma: "Rotel Tomatoes, chopped" -> "Rotel tomatoes"; "1 1/2 cups chopped onions" -> "onions"; "1 cup grated cheddar cheese" -> "cheddar cheese". Keep a word that describes how the product is SOLD rather than what you do to it: "ground beef", "crushed tomatoes", "sliced sandwich bread", and "shredded mozzarella" where the recipe clearly wants the pre-shredded bag.
- canonicalKey: a normalized merge key — lowercase, singular, no brand/adjectives that don't change what you buy. "yellow onions" and "1 diced onion" both -> "onion"; "boneless skinless chicken breasts" -> "chicken breast". This is how duplicates across sources get merged, so be consistent.
- quantity: a number if one is stated or clearly implied, else null. Convert written numbers ("two") and simple fractions ("1/2" -> 0.5). Do not invent quantities.
- unit: the unit of measure if present (cup, lb, oz, clove, can, bunch, whole...), else null. If the item is just a count of whole things (e.g. "2 onions"), use "whole".
- buyCount / sizeAmount / sizeUnit / packaging: the package to actually put in the cart. Recipes usually state it in parentheses — "2 (10 1/2 ounce) cans cream of mushroom soup", "1 (13-16 oz) bag Doritos", "one 15 oz can black beans". Fill these ONLY when the source states a container size AND the item is counted in containers: buyCount = how many containers (2), sizeAmount = what's in ONE container (10.5), sizeUnit = that measure ("oz"), packaging = the container noun ("can", "bag", "jar", "box", "bottle", "package"). Worked: "2 (10 1/2 ounce) cans cream of mushroom soup" -> quantity 2, unit "can", buyCount 2, sizeAmount 10.5, sizeUnit "oz", packaging "can". "1 (13-16 ounce) bag plain Doritos" -> quantity 1, unit "bag", buyCount 1, sizeAmount 13, sizeUnit "oz", packaging "bag" (given a range, use the smaller number).
  Set ALL FOUR to null when the source states no container size ("1 can of beans"), or when the amount is a cooking measure — 1 1/2 cups onions, 2 tbsp butter, 3 cloves garlic, 1 lb ground beef all get null. A stated equivalent like "1 cup (8 oz) sour cream" is a conversion, NOT a package size — null. Never invent a size that isn't written down.
- section: the store section, chosen ONLY from the list below. Pick the single best fit; use "other" only when nothing else fits.
    - produce: fresh fruit & vegetables, fresh herbs, bagged salad.
    - bakery: fresh bread, buns, rolls, tortillas, bagels, pastries, cakes.
    - deli: sliced deli meats & cheeses, rotisserie chicken, prepared/ready-to-eat foods, hummus & fresh dips.
    - meat: raw/packaged meat, poultry, and seafood.
    - dairy: milk, cheese, yogurt, butter, eggs, and other refrigerated dairy.
    - frozen: anything sold frozen (frozen veg, ice cream, frozen meals, etc.).
    - pantry: shelf-stable dry & canned staples — pasta, rice, grains, dried/canned beans, canned vegetables/fruit/soup, broth/stock, cereal, oats, coffee & tea, cooking oil.
    - baking: baking supplies and spices/seasonings — flour, sugar, baking soda/powder, yeast, chocolate chips, extracts, salt, pepper, dried herbs & spices.
    - condiments: ketchup, mustard, mayo, salad dressing, cooking & pasta sauces, salsa, pickles, jam, honey, syrup, peanut butter.
    - snacks: chips, crackers, cookies, candy, nuts, granola/protein bars, popcorn.
    - beverages: water, soda, juice, sports/energy drinks, drink mixes.
    - household: paper goods, cleaning supplies, trash bags, foil/wrap, batteries.
    - personal: personal care & health — shampoo, soap, toothpaste, deodorant, cosmetics, vitamins, over-the-counter medicine.
    - other: only when nothing above fits (e.g. baby, pet, flowers).
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
              required: [
                'label',
                'count',
                'sizeAmount',
                'sizeUnit',
                'packaging',
                'price',
                'section',
              ],
              properties: {
                // Full product name incl. size, e.g. "Store brand salsa, 16 oz jar".
                label: { type: 'string' },
                // How many packages a shopper typically buys — usually 1.
                count: { type: 'integer' },
                // Size of ONE package (16). Null when the packaging is
                // self-describing (a dozen, a bunch, a single pound).
                sizeAmount: { type: ['number', 'null'] },
                // The measure sizeAmount is in: oz, lb, ct, ml, g, gallon…
                sizeUnit: { type: ['string', 'null'] },
                // The countable purchase noun: jar, can, bag, box, dozen,
                // bunch, lb, each. Null only if truly nothing fits.
                packaging: { type: ['string', 'null'] },
                // Price of ONE package (one jar/can/lb) — the line total is
                // price × count.
                price: { type: 'number' },
                section: { type: 'string', enum: SECTIONS },
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

For each option, break the purchase into its parts — how MANY of WHAT SIZE of WHICH package — and provide:
- label: a short, specific product name including the size/type (e.g. "Large eggs, 18 ct", "Store brand salsa, 16 oz jar").
- count: how many of the package a shopper typically buys in one trip. This is almost always 1 (one jar, one carton, one bag). Use more than 1 only when buying several is the norm (e.g. count 2 for "2 cans of beans"). Never 0.
- sizeAmount + sizeUnit: the amount in ONE package and its measure — 16 + "oz", 1 + "gallon", 18 + "ct", 5 + "lb". If the packaging noun already says the size (a "dozen", a "bunch", one "lb"), set BOTH sizeAmount and sizeUnit to null.
- packaging: the countable container/purchase noun for one unit — "jar", "can", "bottle", "bag", "box", "carton", "dozen", "bunch", "lb", "each". For something sold loose by weight (bananas, deli meat, bulk beef), use the weight unit itself as the packaging (e.g. packaging "lb", count 2, sizeAmount null → "2 lb"). Null only if truly nothing fits.
- price: realistic ${store} price in US dollars for ONE package (a plain number). The shopper's line total will be price × count, so price a single unit, never the multiplied total.
- section: the store aisle where THAT specific product is actually found, chosen ONLY from the list below. The right section can differ between a product's options — e.g. jarred salsa is "condiments" but fresh pico de gallo is "produce"; shelf-stable broth is "pantry" but a rotisserie chicken is "deli". Classify each option on its own merits.

Worked examples (label → count / sizeAmount / sizeUnit / packaging):
- "Store brand salsa, 16 oz jar" → 1 / 16 / oz / jar
- "Black beans, 15 oz can" (buying two) → 2 / 15 / oz / can
- "Large eggs, dozen" → 1 / null / null / dozen
- "Large eggs, 18 ct" → 1 / 18 / ct / carton
- "Whole milk, gallon" → 1 / null / null / gallon
- "80/20 ground beef, loose" (buying two pounds) → 2 / null / null / lb
- "Bananas" (buying ~3 lb) → 3 / null / null / lb
- "Family pack chicken breast, ~3 lb" → 1 / 3 / lb / pack
    - produce: fresh fruit & vegetables, fresh herbs, bagged salad.
    - bakery: fresh bread, buns, rolls, tortillas, bagels, pastries, cakes.
    - deli: sliced deli meats & cheeses, rotisserie chicken, prepared/ready-to-eat foods, hummus & fresh dips.
    - meat: raw/packaged meat, poultry, and seafood.
    - dairy: milk, cheese, yogurt, butter, eggs, and other refrigerated dairy.
    - frozen: anything sold frozen.
    - pantry: shelf-stable dry & canned staples — pasta, rice, grains, dried/canned beans, canned vegetables/fruit/soup, broth/stock, cereal, oats, coffee & tea, cooking oil.
    - baking: baking supplies and spices/seasonings — flour, sugar, baking soda/powder, yeast, chocolate chips, extracts, salt, pepper, dried herbs & spices.
    - condiments: ketchup, mustard, mayo, salad dressing, cooking & pasta sauces, salsa, pickles, jam, honey, syrup, peanut butter.
    - snacks: chips, crackers, cookies, candy, nuts, granola/protein bars, popcorn.
    - beverages: water, soda, juice, sports/energy drinks, drink mixes.
    - household: paper goods, cleaning supplies, trash bags, foil/wrap, batteries.
    - personal: personal care & health — shampoo, soap, toothpaste, deodorant, cosmetics, vitamins, over-the-counter medicine.
    - other: only when nothing above fits (e.g. baby, pet, flowers).

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
