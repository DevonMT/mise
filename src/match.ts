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
 *   1. Tidy: lowercase, drop accents, drop (parentheses). What follows the first
 *      comma is a qualifier ("rice, brown" is brown rice) or a note ("onion,
 *      chopped"; "olive oil, for frying"), see tailQualifiers().
 *   2. Drop the leading amount: numbers ("1 1/2", "1-2", "1 to 2", "15oz",
 *      "two"), then measure words ("cups", "lb.", "stalks", "head of") and
 *      "a"/"an"/"of". Measure words only go after a number or before "of", so
 *      "whole milk" and "head cheese" keep their first word.
 *   3. Cut a trailing note ("... for frying", "... as needed", "juice of 1
 *      lemon" is turned round into "lemon juice").
 *   4. Singularize each word ("tomatoes" is "tomato").
 *   5. Strip filler: prep words ("chopped", "fresh"), sizes ("large"), except
 *      where the word changes what you buy (KEEP below).
 *   6. Drop a redundant last word ("cheddar cheese" is "cheddar", "penne
 *      pasta" is "penne", "thyme sprigs" is "thyme", "salmon fillet" is
 *      "salmon").
 *   7. Aliases, exact phrase ("scallion" is "green onion").
 *   8. Strip "ground" / "powder" / "powdered", but ONLY from a dry spice
 *      ("ground cumin" is "cumin"). Never from anything else, which is what
 *      keeps "chili powder" apart from "chili", "garlic powder" apart from
 *      "garlic", "ground beef" apart from "beef" and "powdered sugar" apart
 *      from "sugar".
 *
 * WHEN IN DOUBT, DO NOT MERGE. A missed match leaves two lines you can combine
 * by hand; a false match silently loses a line from somebody's shopping list.
 * So the strip lists are short, the spice list is an allow-list, and every
 * alias below is something a shopper would put in the same basket.
 *
 * DECISIONS (also pinned by match.test.ts):
 *   - Plain salts are one thing: "kosher salt", "sea salt", "table salt",
 *     "flaky sea salt", "Maldon", "Diamond Crystal" all match "salt". Stocking a
 *     pantry is about not buying it again, and nobody re-buys salt for a recipe
 *     that names another kind. Seasoned salts (garlic salt, celery salt) are
 *     different products and stay apart.
 *   - Fresh vs ground: "ginger" and "fresh ginger" match; "ground ginger" does
 *     not. "Fresh turmeric" is a root and stays apart from ground turmeric;
 *     "fresh coriander" is cilantro (UK), not the ground jar.
 *   - Dried herbs are NOT folded into fresh ones ("dried basil" vs "basil")
 *     except oregano and bay leaf, which are practically always dried.
 *   - Colours, cuts and varieties are kept ("red onion" is not "onion"; "chicken
 *     thigh" is not "chicken breast"; "bread flour" is not "flour"). The
 *     parser's own canonicalKey is matched too, so "Yellow onion" with key
 *     "onion" still meets "onion".
 *   - Bare words mean the default: "pepper" is black pepper, "sugar" is
 *     granulated ("white sugar", "granulated sugar"), "brown sugar" is light
 *     brown, "vanilla" is extract, "hamburger" is ground beef, "fennel" is the
 *     bulb (fennel seeds are their own thing). "Peppers" (plural) are not the jar.
 *   - A form you buy separately stays apart even if the prep word is usually
 *     filler: "sliced almonds", "shredded coconut", "fresh mozzarella", "diced
 *     tomatoes" are not "almonds", "coconut", "mozzarella", "tomatoes".
 *   - Cumin seed (whole) is not ground cumin. Cilantro is not coriander.
 *   - "Low sodium" and "reduced sodium" are one; both stay apart from the plain
 *     product (it is a different thing on the shelf).
 *   - A word after a comma is a qualifier unless it is prep or a note. A lone
 *     word with one qualifier in brackets is the same ("sugar (brown)"); longer
 *     names keep brackets as a note ("olive oil (extra virgin)").
 *   - "1,5 kg" is a decimal, not a comma. "Whole" is never a measure ("2 cups
 *     whole milk" is whole milk; "1 whole chicken" stays "whole chicken").
 *     A number inside a name stays ("5 spice", "7 up", "00 flour", "3 cheese").
 *   - A key with no letters, or one character, is '' (matches nothing).
 *
 * KNOWN LIMITS (a missed match, or a merge the unit check usually stops):
 *   "sliced cheese" and "cheese" share a key unless the cheese is named; "salt
 *   and pepper" is one key (it is two things); "butter or margarine" keeps both
 *   words; the line's unit keeps a can apart from fresh when merging.
 */

const NUM = /^[\d½¼¾⅓⅔⅛][\d/.½¼¾⅓⅔⅛]*$/
const NUM_UNIT = /^\d+(?:\.\d+)?(?:oz|ounce|g|gram|kg|ml|l|lb|lbs|cl|fl)$/
const NUM_WORD = new Set(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'])

/** Measures, singular. A leading one is dropped after a number or before "of". */
const UNITS = new Set([
  'cup', 'c', 't', 'tb', 'tbsp', 'tbs', 'tablespoon', 'tsp', 'teaspoon', 'oz', 'ounce', 'fl',
  'lb', 'lbs', 'pound', 'g', 'gram', 'kg', 'kilogram', 'ml', 'l', 'liter', 'litre', 'cl',
  'quart', 'qt', 'pint', 'pt', 'gal', 'gallon', 'clove', 'can', 'tin', 'bunch', 'pkg',
  'package', 'packet', 'sachet', 'envelope', 'stick', 'dozen', 'pinch', 'dash', 'slice', 'sprig',
  'handful', 'head', 'bulb', 'stalk', 'rib', 'knob', 'inch', 'link', 'strip', 'rasher',
  'wedge', 'fillet', 'filet', 'sheet', 'loaf', 'tub', 'carton', 'container', 'scoop',
  'jar', 'bag', 'box', 'bottle', 'piece', 'pc', 'pcs', 'splash', 'drizzle',
])
/** Measures that mean an amount even with no number in front ("pinch of salt"). */
const LOOSE_UNITS = new Set(['pinch', 'dash', 'handful', 'sprig', 'splash', 'drizzle'])
/** Between a number and the name: "2 heaping tablespoons sugar". */
const MEASURE_MOD = new Set(['heaping', 'heaped', 'level', 'scant', 'rounded', 'generous', 'packed'])
const SIZE = new Set(['large', 'medium', 'small', 'big', 'jumbo'])

/** Prep and size words that do not change what you buy. */
const FILLER = new Set([
  'fresh', 'freshly', 'chopped', 'diced', 'minced', 'sliced', 'grated', 'shredded',
  'peeled', 'cubed', 'halved', 'quartered', 'trimmed', 'crumbled', 'melted', 'softened', 'divided',
  'seeded', 'cored', 'pitted', 'stemmed', 'deveined', 'shucked', 'rinsed', 'drained', 'washed',
  'scrubbed', 'cleaned', 'patted', 'juiced', 'zested', 'beaten', 'whisked', 'thawed', 'sifted',
  'torn', 'smashed', 'mashed', 'separated', 'warmed', 'chilled', 'cooled', 'removed',
  'room', 'temperature', 'lightly', 'well',
  'packed', 'heaping', 'level', 'large', 'medium', 'small', 'big', 'jumbo', 'ripe', 'finely',
  'coarsely', 'roughly', 'thinly', 'thickly', 'optional', 'taste', 'to', 'about',
  'approximately', 'a', 'an', 'the', 'of', 'for', 'garnish', 'serving',
  'plain', 'pure',
])
/** A tail after the comma that starts like this is a note about the dish. */
const NOTE_START = new Set([
  'for', 'as', 'to', 'if', 'plus', 'at', 'about', 'more', 'cut', 'into', 'from', 'with', 'without',
  'on', 'such', 'preferably', 'divided', 'cold', 'warm', 'lukewarm',
])

/**
 * A prep word that is NOT filler next to these: it is a separate product.
 * "sliced almonds" is not "almonds" and "shredded coconut" is not "coconut";
 * "diced tomatoes" is the can. A prep word after a comma is always prep.
 */
const CHEESES = [
  'cheddar', 'mozzarella', 'ricotta', 'parmesan', 'provolone', 'feta', 'gouda', 'brie', 'gruyere',
  'havarti', 'colby', 'asiago', 'romano', 'pecorino', 'mascarpone', 'muenster', 'fontina',
  'manchego', 'swiss', 'gorgonzola', 'halloumi', 'camembert', 'emmental', 'edam',
]
const KEEP: Record<string, Set<string>> = {
  diced: new Set(['tomato']),
  chopped: new Set(['tomato']),
  sliced: new Set(['almond', 'cheese', 'bread', 'olive', 'pickle', 'jalapeno', 'pepperoni', 'peach', ...CHEESES]),
  shredded: new Set(['coconut', 'wheat']),
  fresh: new Set(['mozzarella', 'pasta', 'turmeric', 'coriander', 'yeast', 'tuna']),
  minced: new Set(['beef', 'pork', 'lamb', 'turkey', 'chicken']),
}

/** Dry spices, where "ground" / "powder" is a form of the same jar. An
 *  allow-list on purpose: see the file header. */
const SPICES = new Set([
  'cumin', 'coriander', 'cinnamon', 'nutmeg', 'turmeric', 'paprika', 'cardamom',
  'clove', 'allspice', 'cayenne', 'black pepper', 'white pepper', 'pepper', 'mace',
  'anise', 'sumac', 'fenugreek', 'celery seed',
])

/** A last word that adds nothing after one of these: "cheddar cheese", "penne
 *  pasta", "thyme sprigs", "salmon fillet", "2 celery stalks". */
const HERBS = ['thyme', 'basil', 'mint', 'parsley', 'rosemary', 'sage', 'oregano', 'dill', 'cilantro', 'tarragon', 'chive', 'marjoram']
const FISH = [
  'salmon', 'cod', 'tilapia', 'haddock', 'halibut', 'trout', 'sole', 'snapper', 'bass', 'catfish',
  'anchovy', 'flounder', 'mahi', 'fish',
]
const SHAPES = [
  'spaghetti', 'penne', 'rigatoni', 'fusilli', 'linguine', 'fettuccine', 'macaroni', 'rotini',
  'farfalle', 'orecchiette', 'ziti', 'tagliatelle', 'pappardelle', 'bucatini', 'orzo', 'shell', 'hair',
]
const REDUNDANT: Record<string, Set<string>> = {
  cheese: new Set(CHEESES),
  pasta: new Set(SHAPES),
  sauce: new Set(['worcestershire', 'hoisin', 'sriracha', 'tabasco', 'marinara']),
  mustard: new Set(['dijon']),
  paste: new Set(['miso']),
  dressing: new Set(['ranch']),
  lettuce: new Set(['romaine', 'iceberg']),
  fillet: new Set(FISH),
  filet: new Set(FISH),
  stalk: new Set(['celery', 'lemongrass', 'rhubarb']),
  rib: new Set(['celery']),
  bulb: new Set(['garlic']),
  head: new Set(['garlic', 'cauliflower', 'broccoli', 'cabbage', 'lettuce', 'romaine']),
  leaf: new Set(HERBS),
  sprig: new Set(HERBS),
  stem: new Set(HERBS),
}
const WATER_TEMP = new Set(['cold', 'warm', 'hot', 'boiling', 'lukewarm', 'tepid', 'ice', 'iced', 'filtered', 'tap', 'cool'])

/** Words that end in s and are not plurals (or that a rule would mangle). */
const NOT_PLURAL = new Set([
  'molasses', 'hummus', 'couscous', 'asparagus', 'swiss', 'grits', 'citrus',
  'bitters', 'brussels', 'watercress', 'lemongrass',
])
const IE_PLURAL = new Set(['cookies', 'brownies', 'pies', 'veggies', 'smoothies', 'calories'])
const SPELLING: Record<string, string> = {
  chile: 'chili', chilli: 'chili', chilies: 'chili', chiles: 'chili', chillies: 'chili',
  yoghurt: 'yogurt', veggie: 'vegetable', raising: 'rising',
}

/** Exact-phrase aliases, keyed on the singularized, filler-stripped phrase.
 *  An entry that maps to itself pins a phrase against later stripping. */
const ALIASES: Record<string, string> = {
  // produce
  scallion: 'green onion', 'spring onion': 'green onion',
  capsicum: 'bell pepper', aubergine: 'eggplant', courgette: 'zucchini', rocket: 'arugula',
  'plum tomato': 'roma tomato', beetroot: 'beet', 'swiss chard': 'chard', 'pak choi': 'bok choy',
  mangetout: 'snow pea', 'sugar snap pea': 'snap pea', 'green pea': 'pea', 'string bean': 'green bean',
  'red kidney bean': 'kidney bean', garbanzo: 'chickpea', 'garbanzo bean': 'chickpea', 'chick pea': 'chickpea',
  'white mushroom': 'mushroom', 'button mushroom': 'mushroom', 'baby bella mushroom': 'cremini mushroom',
  'canned pumpkin': 'pumpkin puree', 'jalapeno pepper': 'jalapeno', 'fennel bulb': 'fennel',
  'ear corn': 'corn on the cob', 'corn on cob': 'corn on the cob',
  'lemon peel': 'lemon zest', 'lime peel': 'lime zest', 'orange peel': 'orange zest',
  'garlic clove': 'garlic', 'ginger root': 'ginger',
  'dried onion': 'dried onion', 'dried minced onion': 'dried onion', 'onion flake': 'dried onion',
  'dehydrated onion': 'dried onion',
  // herbs and spices
  'coriander leaf': 'cilantro', 'cilantro leaf': 'cilantro',
  'fresh coriander': 'cilantro', 'fresh coriander leaf': 'cilantro',
  'italian parsley': 'flat leaf parsley',
  'whole egg': 'egg', 'whole lemon': 'lemon', 'whole star anise': 'star anise',
  'whole bay leaf': 'bay leaf',
  fivespice: 'five spice', 'chinese fivespice': 'five spice', 'fivespice powder': 'five spice',
  'chinese fivespice powder': 'five spice',
  'turmeric root': 'fresh turmeric', haldi: 'turmeric', jeera: 'cumin seed', 'whole cumin': 'cumin seed',
  'crushed red pepper': 'red pepper flake', 'chili flake': 'red pepper flake',
  'crushed red pepper flake': 'red pepper flake', 'chili pepper flake': 'red pepper flake',
  'ground red pepper': 'cayenne', 'cayenne pepper': 'cayenne',
  'ginger powder': 'ground ginger', 'sweet paprika': 'paprika',
  'mustard powder': 'dry mustard', 'ground mustard': 'dry mustard',
  'dried oregano': 'oregano', 'dried bay leaf': 'bay leaf',
  'granulated garlic': 'garlic powder', 'garlic granule': 'garlic powder',
  'cracked black pepper': 'black pepper', 'cracked pepper': 'black pepper',
  'coarse black pepper': 'black pepper', 'coarse ground black pepper': 'black pepper',
  'black peppercorn': 'peppercorn', 'whole peppercorn': 'peppercorn', 'whole black peppercorn': 'peppercorn',
  'fleur de sel': 'salt', 'seasoning salt': 'seasoned salt',
  // pantry
  'confectioner sugar': 'powdered sugar', 'icing sugar': 'powdered sugar',
  'granulated sugar': 'sugar', 'white sugar': 'sugar', 'granulated white sugar': 'sugar',
  'white granulated sugar': 'sugar', 'light brown sugar': 'brown sugar', 'caster sugar': 'superfine sugar',
  'all purpose flour': 'flour', 'ap flour': 'flour', 'wholemeal flour': 'whole wheat flour',
  'bicarbonate soda': 'baking soda', 'bicarb soda': 'baking soda', 'sodium bicarbonate': 'baking soda',
  'dry yeast': 'active dry yeast',
  'extra virgin olive oil': 'olive oil', 'virgin olive oil': 'olive oil', evoo: 'olive oil',
  'distilled white vinegar': 'white vinegar', 'distilled vinegar': 'white vinegar',
  'cider vinegar': 'apple cider vinegar', 'rice wine vinegar': 'rice vinegar',
  shoyu: 'soy sauce', 'stock cube': 'bouillon cube',
  'chicken stock': 'chicken broth', 'beef stock': 'beef broth', 'vegetable stock': 'vegetable broth',
  'unsweetened cocoa': 'cocoa powder', 'unsweetened cocoa powder': 'cocoa powder', cocoa: 'cocoa powder',
  'semi sweet chocolate chip': 'chocolate chip',
  'creamy peanut butter': 'peanut butter', 'smooth peanut butter': 'peanut butter',
  'agave nectar': 'agave', 'corn starch': 'cornstarch',
  'long grain white rice': 'long grain rice', 'old fashioned oat': 'rolled oat',
  'elbow macaroni': 'macaroni', 'elbow pasta': 'macaroni',
  'lasagne sheet': 'lasagna noodle', 'lasagna sheet': 'lasagna noodle', 'lasagne noodle': 'lasagna noodle',
  'panko breadcrumb': 'panko',
  'flax seed': 'flaxseed', pepita: 'pumpkin seed', sultana: 'golden raisin',
  // dairy, meat, fish, sauces
  'heavy whipping cream': 'heavy cream', 'whipping cream': 'heavy cream',
  'parmesan cheese': 'parmesan', parmigiano: 'parmesan', 'parmigiano reggiano': 'parmesan',
  hamburger: 'ground beef', 'hamburger meat': 'ground beef', 'minced beef': 'ground beef',
  'beef mince': 'ground beef', 'minced pork': 'ground pork', 'pork mince': 'ground pork',
  'minced lamb': 'ground lamb', 'lamb mince': 'ground lamb', 'minced turkey': 'ground turkey',
  'turkey mince': 'ground turkey', 'minced chicken': 'ground chicken', 'chicken mince': 'ground chicken',
  prawn: 'shrimp', drumstick: 'chicken drumstick', 'stew meat': 'beef stew meat',
  mayo: 'mayonnaise', catsup: 'ketchup', 'bbq sauce': 'barbecue sauce', 'spaghetti sauce': 'pasta sauce',
  'ice cube': 'ice',
}
// A bare word that means the usual thing ("bell pepper" has its own words).
const BARE: Record<string, string> = { pepper: 'black pepper', vanilla: 'vanilla extract' }

const SALT = /^(?:(?:kosher|sea|table|fine|coarse|flaky|flake|iodized|pink|himalayan|rock|maldon|diamond|crystal|morton|mortons|celtic|gray|grey)\s+)+salt(?:\s+flake)?$/

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

/** Letters NFD does not take apart; left alone they would vanish and leave one-letter keys. */
const LETTERS: Record<string, string> = { ø: 'o', æ: 'ae', œ: 'oe', ł: 'l', ß: 'ss', đ: 'd' }

function fold(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[øæœłßđ]/g, (c) => LETTERS[c])
}

function tokens(t: string): string[] {
  return fold(t).replace(/[^a-z0-9%\s]/g, ' ').split(/\s+/).filter(Boolean)
}

function isUnit(w: string): boolean {
  const u = w.replace(/\.$/, '')
  return UNITS.has(u) || UNITS.has(singular(u))
}

function alias(p: string): string | undefined {
  if (SALT.test(p)) return 'salt'
  return ALIASES[p] ?? BARE[p]
}

/**
 * What follows the first comma, as words to put in front of the name. A single
 * word ("rice, brown") is a qualifier. Prep ("onion, chopped"), a note ("oil,
 * for frying", "butter, room temperature", "carrots, cut into rings") or an
 * amount or alternative ("butter, 1 stick", "butter, or margarine") is not.
 * An unknown single word is kept: a missed match is the safe error.
 */
function tailQualifiers(tail: string): string[] {
  if (!tail.trim() || /\d(?!%)|\b(?:or|and|plus)\b/.test(tail)) return []
  const t = tokens(tail)
  if (t.length === 0 || t.length > 3 || NOTE_START.has(t[0])) return []
  // "finely chopped", "stems removed": prep with company is all prep.
  if (t.length > 1 && t.some((w) => FILLER.has(w))) return []
  return t.filter((w) => !FILLER.has(w))
}

/**
 * The key two names are compared by. '' when nothing is left to compare (an
 * empty name, or only an amount), which callers must treat as "matches
 * nothing", not as "matches every other empty name".
 */
export function matchKey(name: string): string {
  // A name is a line of a list, not an essay: the cap keeps a pasted wall of text cheap.
  // "1,5 kg" is a European decimal, not a comma tail.
  let text = fold(name.slice(0, 500)).replace(/(?<=\d),(?=\d)/g, '.')
  // "sugar (brown)" is "sugar, brown": a lone word with one qualifier in brackets.
  const bracket = text.match(/^([^(,]*)\(([^)]*)\)\s*$/)
  if (bracket && tokens(bracket[1]).length === 1 && tailQualifiers(bracket[2]).length) text = `${bracket[1]},${bracket[2]}`
  const [head, tail = ''] = text.replace(/\([^)]*\)/g, ' ').split(',')
  const qualifiers = tailQualifiers(tail)
  let words = head
    .replace(/['’`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9%\s/.½¼¾⅓⅔⅛]/g, ' ')
    // A number that is part of the name, not an amount ("5 spice", "7 up").
    .replace(/\b(?:5|five) ?spice\b/g, 'fivespice')
    .replace(/\b7 ?up\b/g, '7up')
    .replace(/\b1000 island\b/g, 'thousand island')
    .replace(/\b(?:tipo )?00 flour\b/g, 'tipo00 flour')
    // (not inside a range or fraction, and not a count: "2-3 cheese slices", "1/4 cheese")
    .replace(/(?<![\d/.]\s?)\b(?:3|three|4|four) cheese\b(?! (?:slice|stick|piece))/g, 'mixed cheese')
    .replace(/(?<![\d/.]\s?)\b(?:3|three|4|four) bean\b/g, 'mixed bean')
    // "/" and "." belong to numbers only ("1/2", "1.5"): "lb." and "salt/pepper" lose them.
    .replace(/(?<![\d½¼¾⅓⅔⅛])[/.]|[/.](?![\d½¼¾⅓⅔⅛])/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  // The amount: numbers, ranges ("1 to 2"), then measure words, "a", "of".
  let hadQty = false
  for (let guard = 0; guard < 10 && words.length > 1; guard++) {
    const w = words[0].replace(/\.$/, '')
    const next = words[1]
    if (NUM.test(w) || NUM_WORD.has(w) || NUM_UNIT.test(w) || (w === 'half' && next !== 'and')) hadQty = true
    else if (w === 'to' && hadQty && NUM.test(next)) { /* "1 to 2" */ }
    else if (w === 'a' || w === 'an' || w === 'of' || SIZE.has(w)) { /* article or size */ }
    else if (hadQty && MEASURE_MOD.has(w)) { /* "2 heaping tablespoons" */ }
    else if (isUnit(w) && (hadQty || LOOSE_UNITS.has(w) || next === 'of')) { /* a measure */ }
    else break
    words.shift()
  }
  // Nothing but an amount ("2 cups") is not a name.
  if (hadQty && words.length === 1 && isUnit(words[0])) return ''

  let phrase = words.join(' ')
    .replace(/\bextra large\b/g, 'large')
    .replace(/\b(?:reduced|less|lower) sodium\b/g, 'low sodium')
    .replace(/\bskinless boneless\b/g, 'boneless skinless')
    .replace(/\bbread crumbs?\b/g, 'breadcrumbs')
    .replace(/^(juice|zest|peel) of (?:(?:about|approximately) )?(?:half (?:an? )?|an? |[\d½¼¾⅓⅔⅛/. ]+ )?(.+)$/, '$2 $1')
  words = phrase.split(/\s+/).filter(Boolean)
  // "olive oil for frying", "water as needed", "butter plus more".
  const cut = words.findIndex((w, i) => i > 0 && (w === 'for' || w === 'as' || w === 'plus'))
  if (cut > 0) words = words.slice(0, cut)

  // "peppers" are not the jar of black pepper.
  const plural = words.includes('peppers')
  const head1 = words.map((w) => SPELLING[w] ?? singular(w)).map((w) => SPELLING[w] ?? w)
  const quals = qualifiers.map((w) => SPELLING[w] ?? singular(w)).map((w) => SPELLING[w] ?? w)

  const keep = new Set<string>()
  for (const [filler, bases] of Object.entries(KEEP)) if (head1.some((w) => bases.has(w))) keep.add(filler)
  let out = [...quals, ...head1.filter((w) => keep.has(w) || !FILLER.has(w))]
  // "peeled and deveined shrimp" leaves "and shrimp".
  while (out.length > 1 && (out[0] === 'and' || out[0] === 'or')) out.shift()
  while (out.length > 1 && (out[out.length - 1] === 'and' || out[out.length - 1] === 'or')) out.pop()
  if (out.length === 0) return ''

  // "hot water", "ice water" are water.
  if (out.length > 1 && out[out.length - 1] === 'water' && out.slice(0, -1).every((w) => WATER_TEMP.has(w))) out = ['water']
  // "cheddar cheese", "penne pasta", "thyme sprig", "salmon fillet".
  if (out.length > 1 && REDUNDANT[out[out.length - 1]]?.has(out[out.length - 2])) out.pop()

  const p1 = out.join(' ')
  // "peppers" are the vegetable, with a key of their own: never the black pepper jar.
  if (plural && p1 === 'pepper') return 'peppers'
  const a1 = alias(p1)
  if (a1) return a1

  // "ground cumin" / "cumin powder": only when what is left is a dry spice.
  const base = out.filter((w) => w !== 'ground' && w !== 'powder' && w !== 'powdered').join(' ')
  if (base !== p1 && SPICES.has(base)) return alias(base) ?? base
  // A key with no letters or a single character is a leftover, not a name.
  return p1.length < 2 || !/[a-z]/.test(p1) ? '' : p1
}

/** Every key a stored row answers to: its parsed key as it was, plus the two
 *  matchKeys. The raw key stays so anything that merged before still merges. */
export function itemKeys(item: { displayName: string; canonicalKey?: string }): Set<string> {
  const out = new Set<string>()
  const add = (k: string) => k && out.add(k)
  const own = matchKey(item.displayName)
  add(own)
  // The vegetable's parser key is the same bare "pepper" as the jar's: its name decides.
  if (item.canonicalKey && own !== 'peppers') {
    const raw = item.canonicalKey.trim().toLowerCase()
    // A leftover like "1" (a key from before decimal commas were read) meets nothing.
    if (raw.length >= 2 && /[a-z]/.test(raw)) add(raw)
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
