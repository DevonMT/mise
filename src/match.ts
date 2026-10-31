/**
 * Ingredient matching: "ground cumin", "cumin powder" and "cumin" are one thing.
 *
 * COMPUTED AT READ TIME. Nothing here is stored. `canonicalKey` on a row stays
 * whatever the parser or the person gave it, so old rows, rows on another
 * device and rows from an older build all keep loading and syncing unchanged;
 * a match is decided by comparing `matchKey`s when two names meet.
 *
 * DETERMINISTIC, no model. The steps, in order:
 *
 *   1. Tidy: lowercase, drop accents, drop (parentheses), keep what is before
 *      the first comma ("onion, chopped" is an onion), drop a leading amount
 *      and unit ("2 cups"), and split into words.
 *   2. Singularize each word ("tomatoes" is "tomato").
 *   3. Aliases, exact phrase ("scallion" is "green onion"), tried before and
 *      after each strip so a protected phrase is never stripped first.
 *   4. Strip filler: prep words ("chopped", "fresh"), sizes ("large").
 *   5. Strip "ground" / "powder" / "powdered", but ONLY from a dry spice
 *      ("ground cumin" is "cumin"). Never from anything else, which is what
 *      keeps "chili powder" apart from "chili", "garlic powder" apart from
 *      "garlic", "ground beef" apart from "beef" and "powdered sugar" apart
 *      from "sugar".
 *
 * WHEN IN DOUBT, DO NOT MERGE. A missed match leaves two lines you can combine
 * by hand; a false match silently loses a line from somebody's shopping list.
 * So the strip lists are short and the spice list is an allow-list.
 *
 * DECISIONS (also pinned by match.test.ts):
 *   - Plain salts are one thing: "kosher salt", "sea salt", "table salt",
 *     "flaky sea salt" all match "salt". Stocking a pantry is about not buying
 *     it again, and nobody re-buys salt for a recipe that names another kind.
 *     Seasoned salts (garlic salt, celery salt) are different products and stay
 *     apart.
 *   - Fresh vs ground ginger are different products: "ginger" and "fresh
 *     ginger" match; "ground ginger" does not.
 *   - Dried herbs are NOT folded into fresh ones ("dried basil" vs "basil")
 *     except oregano and bay leaf, which are practically always dried.
 *   - Colours and cuts are kept ("red onion" is not "onion"; "chicken thigh" is
 *     not "chicken breast"). The parser's own canonicalKey is matched too, so
 *     "Yellow onion" with key "onion" still meets "onion".
 *   - Cumin seed (whole) is not ground cumin. Cilantro is not coriander.
 *   - A word after a comma is a qualifier unless it is prep: "rice, brown" is
 *     "brown rice", "pepper, red" is "red pepper", "onion, chopped" is "onion".
 *
 * KNOWN LIMITS (a missed match, or a merge the unit check usually stops):
 *   "1 can tomatoes" and "tomatoes" share a key, as do "sliced cheese" and
 *   "cheese"; the line's unit keeps the can apart from fresh when merging.
 */

const QTY = /^[\d½¼¾⅓⅔⅛][\d\s/.½¼¾⅓⅔⅛]*(?!%)/
const UNITS = new Set([
  'cup', 'c', 'tbsp', 'tbs', 'tablespoon', 'tsp', 'teaspoon', 'oz', 'ounce', 'fl',
  'lb', 'lbs', 'pound', 'g', 'gram', 'kg', 'kilogram', 'ml', 'l', 'liter', 'litre',
  'quart', 'qt', 'pint', 'pt', 'gal', 'gallon', 'clove', 'can', 'bunch', 'pkg',
  'package', 'stick', 'dozen', 'pinch', 'dash', 'slice', 'sprig', 'handful',
  'head', 'jar', 'bag', 'box', 'bottle', 'piece', 'pc', 'pcs', 'whole',
])
/** Measures that mean an amount even with no number in front ("pinch of salt").
 *  Every other unit word is only dropped after a number, so "whole milk" and
 *  "head cheese" keep their first word. */
const SIZE = new Set(['large', 'medium', 'small', 'big'])
const LOOSE_UNITS = new Set(['pinch', 'dash', 'handful', 'sprig', 'splash'])
// Plurals of the above, which are checked before the words are singularized.
const UNIT_PLURAL = /^(cups|tbsps|tablespoons|tsps|teaspoons|ounces|pounds|grams|kilograms|liters|litres|quarts|pints|gallons|cloves|cans|bunches|packages|sticks|pinches|dashes|slices|sprigs|handfuls|heads|jars|bags|boxes|bottles|pieces)$/

/** Prep and size words that do not change what you buy. */
const FILLER = new Set([
  'fresh', 'freshly', 'chopped', 'diced', 'minced', 'sliced', 'grated', 'shredded',
  'peeled', 'cubed', 'halved', 'trimmed', 'crumbled', 'melted', 'softened', 'divided',
  'packed', 'heaping', 'level', 'large', 'medium', 'small', 'big', 'ripe', 'finely',
  'coarsely', 'roughly', 'thinly', 'thickly', 'optional', 'taste', 'to', 'about',
  'approximately', 'a', 'an', 'the', 'of', 'for', 'garnish', 'serving',
])

/** Dry spices, where "ground" / "powder" is a form of the same jar. An
 *  allow-list on purpose: see the file header. */
const SPICES = new Set([
  'cumin', 'coriander', 'cinnamon', 'nutmeg', 'turmeric', 'paprika', 'cardamom',
  'clove', 'allspice', 'cayenne', 'black pepper', 'white pepper', 'pepper', 'mace',
  'anise', 'sumac', 'fenugreek', 'celery seed',
])

/** Words that end in s and are not plurals (or that a rule would mangle). */
const NOT_PLURAL = new Set([
  'molasses', 'hummus', 'couscous', 'asparagus', 'swiss', 'grits', 'citrus',
  'bitters', 'brussels', 'watercress', 'lemongrass',
])
const IE_PLURAL = new Set(['cookies', 'brownies', 'pies', 'veggies', 'smoothies', 'calories'])
const SPELLING: Record<string, string> = {
  chile: 'chili', chilli: 'chili', chilies: 'chili', chiles: 'chili', chillies: 'chili',
  yoghurt: 'yogurt',
}

/** Exact-phrase aliases, keyed on the singularized, filler-stripped phrase.
 *  An entry that maps to itself pins a phrase against later stripping. */
const ALIASES: Record<string, string> = {
  scallion: 'green onion', 'spring onion': 'green onion',
  garbanzo: 'chickpea', 'garbanzo bean': 'chickpea', 'chick pea': 'chickpea',
  'coriander leaf': 'cilantro', 'cilantro leaf': 'cilantro',
  'confectioner sugar': 'powdered sugar', 'icing sugar': 'powdered sugar',
  'granulated sugar': 'sugar', 'white sugar': 'sugar', 'granulated white sugar': 'sugar',
  'white granulated sugar': 'sugar',
  'all purpose flour': 'flour', 'plain flour': 'flour', 'ap flour': 'flour',
  'bicarbonate soda': 'baking soda', 'bicarb soda': 'baking soda', 'sodium bicarbonate': 'baking soda',
  'extra virgin olive oil': 'olive oil', 'virgin olive oil': 'olive oil', evoo: 'olive oil',
  'heavy whipping cream': 'heavy cream', 'whipping cream': 'heavy cream',
  capsicum: 'bell pepper', aubergine: 'eggplant', courgette: 'zucchini', rocket: 'arugula',
  'crushed red pepper': 'red pepper flake', 'chili flake': 'red pepper flake',
  'crushed red pepper flake': 'red pepper flake', 'chili pepper flake': 'red pepper flake',
  'ground red pepper': 'cayenne', 'cayenne pepper': 'cayenne',
  'ginger powder': 'ground ginger',
  'mustard powder': 'dry mustard', 'ground mustard': 'dry mustard',
  'dried oregano': 'oregano', 'dried bay leaf': 'bay leaf',
  'unsweetened cocoa': 'cocoa powder', 'unsweetened cocoa powder': 'cocoa powder', cocoa: 'cocoa powder',
  'garlic clove': 'garlic', 'parmesan cheese': 'parmesan', parmigiano: 'parmesan',
  'parmigiano reggiano': 'parmesan',
  'chicken stock': 'chicken broth', 'beef stock': 'beef broth', 'vegetable stock': 'vegetable broth',
  'jalapeno pepper': 'jalapeno', 'corn starch': 'cornstarch',
}
// Bare "pepper" in a recipe is black pepper ("bell pepper" has its own words).
const BARE: Record<string, string> = { pepper: 'black pepper' }

const SALT = /^(?:(?:kosher|sea|table|fine|coarse|flaky|iodized|pink|himalayan|rock)\s+)+salt$/

function singular(w: string): string {
  if (w.length <= 3 || NOT_PLURAL.has(w)) return w
  if (w === 'leaves') return 'leaf'
  if (w === 'loaves') return 'loaf'
  if (w === 'halves') return 'half'
  if (IE_PLURAL.has(w)) return w.slice(0, -1)
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y'
  if (w.endsWith('oes')) return w.slice(0, -2)
  if (/(?:ch|sh|x|z|ss)es$/.test(w)) return w.slice(0, -2)
  if (w.endsWith('s') && !/(?:ss|us)$/.test(w)) return w.slice(0, -1)
  return w
}

function tokens(t: string): string[] {
  return t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9%\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function alias(p: string): string | undefined {
  if (SALT.test(p)) return 'salt'
  return ALIASES[p] ?? BARE[p]
}

/**
 * The key two names are compared by. '' when nothing is left to compare (an
 * empty name, or only an amount), which callers must treat as "matches
 * nothing", not as "matches every other empty name".
 */
export function matchKey(name: string): string {
  let s = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
  // "onion, chopped" is an onion, but "rice, brown" is brown rice: what follows
  // the first comma becomes a leading qualifier, and the prep words in it are
  // dropped below like any others. A tail with an amount or an "or" is a note.
  const [head, tail = ''] = s.split(',')
  s = head
  const tailWords = /\d(?!%)|\b(?:or|and|plus)\b/.test(tail) ? [] : tokens(tail)
  s = s.replace(/['’`]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9%\s/.½¼¾⅓⅔⅛]/g, ' ')
  s = s.trim()
  const hadQty = QTY.test(s)
  s = s.replace(QTY, '').trim()

  let words = s.split(/\s+/).filter(Boolean)
  // Leading unit words ("cups", "can", "large can", "a pinch of"), then "of".
  for (let i = 0; i < 3 && words.length > 1; i++) {
    const w = words[0]
    const unit = UNITS.has(w) || UNIT_PLURAL.test(w)
    if (w === 'of' || w === 'a' || w === 'an' || SIZE.has(w) || (unit && hadQty) || LOOSE_UNITS.has(w)) {
      words = words.slice(1)
    }
    else break
  }

  // Nothing but an amount ("2 cups") is not a name.
  if (hadQty && words.length === 1 && (UNITS.has(words[0]) || UNIT_PLURAL.test(words[0]))) return ''

  words = [...tailWords, ...words]
  const plural = words.includes('peppers')

  words = words.map((w) => SPELLING[w] ?? singular(w)).map((w) => SPELLING[w] ?? w)

  // A can of diced tomatoes is not a fresh tomato: "diced" stays beside it.
  const keep = words.includes('tomato') ? 'diced' : ''
  const p1 = words.filter((w) => w === keep || !FILLER.has(w)).join(' ')
  if (!p1) return ''
  // "peppers" are not the jar of black pepper.
  if (plural && p1 === 'pepper') return p1
  const a1 = alias(p1)
  if (a1) return a1

  // "ground cumin" / "cumin powder": only when what is left is a dry spice.
  const base = p1.split(' ').filter((w) => w !== 'ground' && w !== 'powder' && w !== 'powdered').join(' ')
  if (base !== p1 && SPICES.has(base)) return alias(base) ?? base
  return p1
}

/** Every key a stored row answers to: its parsed key as it was, plus the two
 *  matchKeys. The raw key stays so anything that merged before still merges. */
export function itemKeys(item: { displayName: string; canonicalKey?: string }): Set<string> {
  const out = new Set<string>()
  const add = (k: string) => k && out.add(k)
  add(matchKey(item.displayName))
  if (item.canonicalKey) {
    add(item.canonicalKey.trim().toLowerCase())
    add(matchKey(item.canonicalKey))
  }
  return out
}

/** Are these two lines the same thing to buy or stock? */
export function sameIngredient(
  a: { displayName: string; canonicalKey?: string },
  b: { displayName: string; canonicalKey?: string },
): boolean {
  const ka = itemKeys(a)
  for (const k of itemKeys(b)) if (ka.has(k)) return true
  return false
}
