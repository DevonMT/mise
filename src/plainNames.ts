/**
 * Plain names for branded recipe lines (#818).
 *
 * Devon's rule (11/08): a recipe says what you need in plain words; brands are
 * Refine's job, where the store's real options are. Except household names
 * that ARE the product to him ("Velveeta", "Cheez Whiz", "Rotel"): those stay.
 *
 * Deterministic, three steps, in order:
 *   1. KEEP: a household name anywhere in the line, and nothing changes.
 *   2. SWAPS: a brand that names a product type ("Veg-All", "Bisquick") becomes
 *      that type.
 *   3. MAKERS: a maker's name in front of a plain product ("Hormel turkey
 *      chili", "Campbell's cream of chicken soup") is dropped.
 * Anything not listed is left alone: a guess that strips a word that mattered
 * is worse than a brand left on.
 */

/** Names Devon uses as the product itself. Never renamed. */
const KEEP = /\bvelveeta\b|\bche(e)?z[ -]?whiz\b|\bkraft singles\b|\bro-?tel\b|\bcool ?whip\b|\bdoritos?\b|\bfritos?\b|\bspam\b|\bjell-?o\b|\bnutella\b|\btater tots?\b|\bcheetos?\b|\boreos?\b/i

/**
 * A brand that stands for a product type, and the type. First match wins.
 * Each is narrowed to the product it names: Jiffy also makes peanut butter,
 * Crisco also sells oil, and "beef franks" are not Frank's RedHot. A brand's
 * other products fall through to MAKERS, where only the brand word goes.
 */
const SWAPS: Array<[RegExp, string]> = [
  [/\bveg-?all\b/i, 'canned mixed vegetables'],
  [/\bbisquick\b/i, 'baking mix'],
  [/\bjiffy\b.*\bcorn\b/i, 'corn muffin mix'],
  [/\bphiladelphia\b(\s+brand)?(\s+original)?(\s+cream)?\s+cheese\b/i, 'cream cheese'],
  [/^crisco$|\bcrisco\b.*\bshortening\b/i, 'shortening'],
  [/\bminute rice\b/i, 'instant rice'],
  [/\bfrank['’]s( red ?hot)?\b/i, 'hot sauce'],
  [/\bkraft\b.*\bmac(aroni)? (and|&) cheese\b/i, 'boxed mac and cheese'],
  [/\bpam\b/i, 'cooking spray'],
]

/** Makers whose name sits in front of a plain product. Longest first. */
const MAKERS = [
  'old el paso', 'hidden valley', 'betty crocker', 'oscar mayer', "land o'? ?lakes", 'green giant', 'del monte',
  'great value', 'store brand', 'best foods', "hellmann'?s", "campbell'?s", "hunt'?s", "french'?s",
  'hormel', 'kraft', 'swanson', 'pace', 'mccormick', 'lipton', 'heinz', 'pillsbury', 'barilla', 'ragu',
  'prego', 'kikkoman', 'tyson', 'daisy', 'tillamook', 'sargento', 'kroger', 'progresso', 'knorr',
  'jiffy', 'crisco',
]
const MAKER_SRC = `\\b(${MAKERS.join('|')})\\b(\\s+brand)?`
/** One test, one replace-all: a global regex used with test() carries state between calls. */
const HAS_MAKER = new RegExp(MAKER_SRC, 'i')
const ALL_MAKERS = new RegExp(MAKER_SRC, 'gi')

/** Tidy what is left: one space, no stray "original"/"brand", no leading
 *  article, no punctuation left hanging at either end ("hot dogs, Oscar Mayer"). */
function tidy(s: string): string {
  return s
    .replace(/\b(original|brand)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:/&+-]+|[\s,;:/&+-]+$/g, '')
    .replace(/^(the|a|an)\s+/i, '')
    .trim()
}

/** What is left must read as a product: "pace of life" leaves "of life". */
const DANGLING = /^(of|and|or|with|for|in|on|to|by|from|at)\b|\b(of|and|or|with|for|the|a|an)$/i

/**
 * The plain name for a line, or null when it has none: no brand found, a
 * household name, or nothing left after the maker is dropped.
 */
export function plainName(name: string): string | null {
  const n = name.trim()
  if (!n || KEEP.test(n)) return null
  for (const [brand, plain] of SWAPS) if (brand.test(n)) return plain
  if (!HAS_MAKER.test(n)) return null
  const left = tidy(n.replace(ALL_MAKERS, ' '))
  if (!left || DANGLING.test(left)) return null
  return left.toLowerCase() !== n.toLowerCase() ? left : null
}
