import type { RecipeIngredient } from './db'
import { packCount } from './list'

/**
 * Standard amounts and pack sizes for a recipe (#774).
 *
 * A recipe that says "1 can Rotel" or just "Velveeta" leaves you guessing in
 * the aisle. Since 2026-11-04 Mise fills that gap with the standard US pack
 * (a 10 oz can, a 32 oz block) and marks it as an estimate, reversing the
 * 2026-08-11 rule that a pack size was never invented. Spices and herbs with
 * no amount get an estimated tsp/tbsp the same way.
 *
 * ORDER. This table first, the model second. The table is a short list of
 * products whose standard size is well known, so where it has an answer it
 * beats a guess, including the parse model's own estimate. The model fills
 * what the table does not know (at parse time, and via /api/standardize when
 * Standardize is tapped with AI on). Without AI it is the table alone.
 *
 * RULES THAT MATTER.
 * - Only gaps are filled. A stated size, a stated amount, or an estimate
 *   already saved is never changed (Standardize can be tapped twice).
 * - A pack size goes only on a line counted in containers or whole things
 *   ("1 can", "2 blocks", "1 Velveeta", a bare "Velveeta"), never on a cooking
 *   measure: "8 oz Velveeta" is an amount, and "1 cup salsa" is the buy math's job (buy.ts, #811).
 * - Every filled field is flagged (`sizeEstimated`, `amountEstimated`) so the
 *   UI can mark it, and so editing the amount by hand can clear the mark.
 */

export interface PackSize {
  /** One package: 10 + "oz" in a "can". */
  size: number
  unit: string
  packaging: string
}

interface PackRule extends PackSize {
  match: RegExp
  /** Tested on the DISPLAY NAME only: a word there that means another product
   *  ("fresh tuna", "spaghetti squash"), whatever the merge key says. */
  not?: RegExp
  /** A different size when the line names another container ("1 can broth" is 14.5 oz, a carton is 32). */
  alt?: Record<string, number>
  /** Every common size it is sold in, as [size, packaging] in `unit` (#811).
   *  The buy math picks the least left over from these. Absent: `size` plus any `alt`. */
  sold?: Array<[number, string]>
  /** Weight in `unit` of one cup, for a dry good bought by weight and measured
   *  by the cup ("2 cups Bisquick" against a 40 oz box). */
  perCup?: number
  /** Sizes for the buy math only: lookupPack (Standardize, parse) skips the
   *  rule, so "1 egg" on a recipe never gets a carton written onto it. */
  buyOnly?: boolean
}

/**
 * Ordered: the first match wins, so the specific spelling goes above the
 * general one (Rotel above diced tomatoes, refried above beans, sweetened
 * condensed milk above the condensed soups).
 */
const PACKS: PackRule[] = [
  // Tomatoes
  { match: /\brotel\b|diced tomatoes (and|&|with) (green )?chil/, size: 10, unit: 'oz', packaging: 'can' },
  { match: /\btomato paste\b/, size: 6, unit: 'oz', packaging: 'can' },
  { match: /\btomato sauce\b/, size: 15, unit: 'oz', packaging: 'can', alt: { can: 15 }, sold: [[8, 'can'], [15, 'can'], [29, 'can']] },
  { match: /\b(crushed|whole peeled|whole|peeled|san marzano) tomatoes\b/, size: 28, unit: 'oz', packaging: 'can', sold: [[14.5, 'can'], [28, 'can']] },
  { match: /\b(diced|stewed|petite diced|fire roasted) tomatoes\b|\bcanned tomatoes\b/, size: 14.5, unit: 'oz', packaging: 'can', sold: [[14.5, 'can'], [28, 'can']] },
  // Cheese
  { match: /\bvelveeta\b|\bprocess(ed)? cheese( product)?\b/, size: 32, unit: 'oz', packaging: 'block', sold: [[16, 'block'], [32, 'block']] },
  { match: /\bcream cheese\b/, size: 8, unit: 'oz', packaging: 'block' },
  { match: /\bshredded\b.*\bcheese\b|\bcheese\b.*\bshredded\b/, size: 8, unit: 'oz', packaging: 'bag', sold: [[8, 'bag'], [16, 'bag']], perCup: 4 },
  // Milk in cans (above the soups, which also say "condensed")
  { match: /\bsweetened condensed milk\b/, size: 14, unit: 'oz', packaging: 'can' },
  { match: /\bevaporated milk\b/, size: 12, unit: 'oz', packaging: 'can', sold: [[5, 'can'], [12, 'can']] },
  { match: /\bcoconut milk\b/, size: 13.5, unit: 'oz', packaging: 'can' },
  // Plain milk, sold by volume. Below the canned milks, which also say "milk".
  { match: /\bmilk\b/, not: /\b(almond|oat|soy|rice|chocolate|powdered|dry|goat|cashew)\b|\bmilk (chocolate|chips|bread)\b/, size: 64, unit: 'fl oz', packaging: 'carton', sold: [[32, 'carton'], [64, 'carton'], [128, 'jug']] },
  // Condensed soups. The 10.5 oz can is also the "soup can" a recipe measures with (buy.ts).
  { match: /\bcream of (mushroom|chicken|celery|potato|onion|shrimp)\b|\bcondensed\b.*\bsoup\b|\bcheddar cheese soup\b/, size: 10.5, unit: 'oz', packaging: 'can', sold: [[10.5, 'can'], [22.6, 'can']] },
  { match: /\bveg-?all\b|\bcanned mixed vegetables\b/, size: 15, unit: 'oz', packaging: 'can', sold: [[15, 'can'], [29, 'can']] },
  // Beans and other cans
  { match: /\brefried beans\b/, size: 16, unit: 'oz', packaging: 'can', perCup: 9 },
  { match: /\b(black|pinto|kidney|cannellini|navy|great northern|white|garbanzo|butter|chili|baked|ranch style|red) beans\b|\bchickpeas\b/, size: 15, unit: 'oz', packaging: 'can' },
  { match: /\bcream(ed|-style)? corn\b/, size: 14.75, unit: 'oz', packaging: 'can' },
  { match: /\b(whole kernel|canned|sweet) corn\b/, size: 15.25, unit: 'oz', packaging: 'can' },
  { match: /\bchipotles?\b.*\badobo\b/, size: 7, unit: 'oz', packaging: 'can' },
  { match: /\benchilada sauce\b/, size: 10, unit: 'oz', packaging: 'can' },
  { match: /\bpumpkin puree\b|\b(canned|pure) pumpkin\b/, size: 15, unit: 'oz', packaging: 'can' },
  { match: /\btuna\b/, not: /\b(fresh|ahi|yellowfin|sushi|sashimi|seared|steaks?|fillets?|loin|tartare|poke)\b/, size: 5, unit: 'oz', packaging: 'can' },
  { match: /\b(chicken|beef|vegetable|veggie|bone) (broth|stock)\b|^(broth|stock)$/, size: 32, unit: 'oz', packaging: 'carton', alt: { can: 14.5 }, sold: [[14.5, 'can'], [32, 'carton'], [48, 'carton']] },
  // Jars and tubs
  { match: /\bsalsa\b|\bqueso dip\b/, size: 16, unit: 'oz', packaging: 'jar', sold: [[16, 'jar'], [24, 'jar']], perCup: 8.5 },
  { match: /\b(marinara|pasta sauce|spaghetti sauce)\b/, size: 24, unit: 'oz', packaging: 'jar', sold: [[24, 'jar'], [45, 'jar']], perCup: 8.8 },
  { match: /\bsour cream\b/, size: 16, unit: 'oz', packaging: 'tub', sold: [[8, 'tub'], [16, 'tub'], [24, 'tub']], perCup: 8.5 },
  { match: /\b(cool whip|whipped topping)\b/, size: 8, unit: 'oz', packaging: 'tub' },
  // Below enchilada sauce and salsa, which often say "green chile" too. A
  // fresh chile is produce, and the section gate in lookupPack keeps it loose.
  { match: /\b(diced |chopped )?green chil(e|i|ies|es)\b/, not: /\b(fresh|sauce|salsa|enchilada)\b/, size: 4, unit: 'oz', packaging: 'can' },
  // Refrigerated dough
  { match: /\bcrescent( roll)?s?\b/, size: 8, unit: 'oz', packaging: 'can' },
  { match: /\b(refrigerated )?biscuit dough\b|\bcanned biscuits\b/, size: 16.3, unit: 'oz', packaging: 'can' },
  // Boxes, bags and packets
  { match: /\bfrozen (chopped )?spinach\b/, size: 10, unit: 'oz', packaging: 'box' },
  { match: /\bcake mix\b/, size: 15.25, unit: 'oz', packaging: 'box' },
  { match: /\b(instant )?pudding mix\b|\binstant pudding\b/, size: 3.4, unit: 'oz', packaging: 'box' },
  { match: /\bchocolate chips\b/, size: 12, unit: 'oz', packaging: 'bag', sold: [[12, 'bag'], [24, 'bag']] },
  // Counted things, for the buy math only (#811): "2 eggs" is bought as a dozen.
  { match: /\beggs?\b/, not: /\begg ?(noodles?|nog|rolls?|whites?|substitute)\b|\beggplant\b|\begg beaters\b/, size: 12, unit: 'ct', packaging: 'carton', sold: [[12, 'carton'], [18, 'carton']], buyOnly: true },
  { match: /\b(flour|corn) tortillas?\b|^tortillas?$/, not: /\bchips?\b/, size: 10, unit: 'ct', packaging: 'pack', sold: [[10, 'pack'], [20, 'pack']], buyOnly: true },
  // Dry goods measured by the cup and sold by weight (#811). One cup of each, in oz.
  { match: /\bbisquick\b|\bbaking mix\b|\bpancake (and|&) baking mix\b/, size: 40, unit: 'oz', packaging: 'box', sold: [[20, 'box'], [40, 'box'], [60, 'box']], perCup: 4.2 },
  { match: /\b(all[- ]purpose|bread|self[- ]rising|plain|wheat) flour\b|^flour$/, size: 80, unit: 'oz', packaging: 'bag', sold: [[32, 'bag'], [80, 'bag']], perCup: 4.25 },
  { match: /\b(granulated |white |cane )?sugar\b/, not: /\b(brown|powdered|confectioners|icing|snap|cookies?|free|substitute)\b/, size: 64, unit: 'oz', packaging: 'bag', sold: [[32, 'bag'], [64, 'bag']], perCup: 7.05 },
  { match: /\b(light |dark )?brown sugar\b/, size: 32, unit: 'oz', packaging: 'bag', perCup: 7.5 },
  { match: /\b(powdered|confectioners'?|icing) sugar\b/, size: 32, unit: 'oz', packaging: 'bag', perCup: 4.2 },
  { match: /\b(long grain |white |jasmine |basmati )?rice\b/, not: /\b(vinegar|noodles?|paper|wine|krispies|cakes?|milk|flour|cooked|instant|minute|cauliflower|pasta)\b/, size: 32, unit: 'oz', packaging: 'bag', sold: [[32, 'bag'], [80, 'bag']], perCup: 6.5 },
  { match: /\btortilla chips\b/, size: 13, unit: 'oz', packaging: 'bag' },
  { match: /\b(taco|ranch|fajita|chili|onion soup|italian dressing|gravy) (seasoning|mix|dressing mix|soup mix)\b/, size: 1, unit: 'oz', packaging: 'packet' },
  { match: /\b(spaghetti|penne|rigatoni|elbow macaroni|macaroni|fettuccine|linguine|rotini|ziti|egg noodles|lasagna noodles|pasta)\b/, not: /\b(squash|sauce|salad|cheese|zucchini)\b/, size: 16, unit: 'oz', packaging: 'box' },
]

/** Container words a recipe counts in. "1 block Velveeta", "2 cans". */
const CONTAINERS: Record<string, string> = {
  can: 'can', cans: 'can', jar: 'jar', jars: 'jar', block: 'block', blocks: 'block',
  package: 'package', packages: 'package', pkg: 'package', pkgs: 'package', pack: 'package',
  box: 'box', boxes: 'box', bag: 'bag', bags: 'bag', bottle: 'bottle', bottles: 'bottle',
  carton: 'carton', cartons: 'carton', tub: 'tub', tubs: 'tub', packet: 'packet', packets: 'packet',
  envelope: 'packet', envelopes: 'packet', container: 'container', containers: 'container',
  pouch: 'pouch', pouches: 'pouch', tube: 'tube', tubes: 'tube', brick: 'block', loaf: 'block',
}
/** A count of whole things, the same as no unit ("1 Velveeta"). */
const COUNTS = new Set(['', 'whole', 'each', 'ea', 'ct', 'count', 'piece', 'pieces', 'item', 'items'])

/**
 * Amounts for a spice or herb the recipe names without one. Deliberately
 * modest: an estimate that is a little low is tasted and adjusted; one that is
 * high has already gone in. Ordered, first match wins.
 */
const AMOUNTS: Array<{ match: RegExp; quantity: number; unit: string; fresh?: boolean }> = [
  { match: /\bred pepper flakes\b|\bcrushed red pepper\b|\bchil(e|i) flakes\b/, quantity: 0.5, unit: 'tsp' },
  { match: /\bcayenne\b/, quantity: 0.25, unit: 'tsp' },
  { match: /\bchil(i|e) powder\b|\bcurry powder\b|\btaco seasoning\b/, quantity: 1, unit: 'tbsp' },
  { match: /\b(smoked )?paprika\b/, quantity: 1, unit: 'tsp' },
  { match: /\b(ground )?cumin\b/, quantity: 1, unit: 'tsp' },
  { match: /\bgarlic powder\b|\bonion powder\b|\bgarlic salt\b|\bmustard powder\b|\bdry mustard\b/, quantity: 1, unit: 'tsp' },
  { match: /\b(ground )?(cinnamon|ginger|turmeric|coriander)\b/, quantity: 1, unit: 'tsp' },
  { match: /\b(ground )?(nutmeg|cloves|allspice|cardamom)\b/, quantity: 0.25, unit: 'tsp' },
  { match: /\bitalian seasoning\b|\bcajun seasoning\b|\bcreole seasoning\b|\bold bay\b|\bseasoning salt\b|\bseasoned salt\b|\bherbes de provence\b/, quantity: 1, unit: 'tsp' },
  { match: /\bbay lea(f|ves)\b/, quantity: 2, unit: 'whole' },
  // One line for both, above either alone, so the salt is not lost.
  { match: /\bsalt (and|&) (black )?pepper\b/, quantity: 0.5, unit: 'tsp' },
  { match: /\b(black |white )?pepper(corns)?\b/, quantity: 0.25, unit: 'tsp' },
  { match: /\b(kosher |sea |table )?salt\b/, quantity: 0.5, unit: 'tsp' },
  // Herbs: fresh ones are chopped by the tablespoon, dried by the teaspoon.
  { match: /\b(cilantro|parsley|basil|dill|mint|chives|thyme|oregano|rosemary|sage|tarragon|marjoram)\b/, quantity: 1, unit: 'tsp', fresh: true },
]

/** Words that mean the line is not the spice itself: "bell pepper", "garlic cloves". */
const NOT_A_SPICE = /\b(jalape\w*|poblano|serrano|habanero|anaheim|fresno|scotch bonnet)\b|\b(bell|banana|sweet|hot|chipotle|roasted red|chil(i|e)|thai|cherry) peppers?\b(?! flakes)|\bthai chil(i|e)s?\b|(?<!crushed )\b(green|red|yellow|orange) pepper\b(?! flakes)|\bpeppers\b|\bgarlic cloves?\b|\bcloves? (of )?garlic\b|\bpeppercorn sauce\b|\bpepper jack\b|\bsalted butter\b|\bsalt pork\b|\bpickles?\b|\bsausages?\b|\bginger (ale|beer)\b|\bgingersnaps?\b|\b(cinnamon|sweet) rolls?\b|\bcinnamon (sticks?|sugar|toast|bread)\b|\bmint (chocolate|chips|ice cream)\b|\bbasil pesto\b|\bpesto\b/

/** Lowercase, accents and trademarks gone, "Ro-Tel" as "rotel". */
function norm(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[®™©]/g, '')
    .toLowerCase()
    .replace(/\bro-?tel\b/g, 'rotel')
    .replace(/\s+/g, ' ')
    .trim()
}

type Line = Pick<RecipeIngredient, 'displayName' | 'canonicalKey' | 'section'> &
  Partial<Pick<RecipeIngredient, 'quantity' | 'unit' | 'buyCount' | 'sizeAmount' | 'sizeUnit' | 'packaging' | 'sizeEstimated' | 'amountEstimated' | 'estimateAsked'>>

/**
 * Whether a rule claims this line. It may match the display name or, failing
 * that, the merge key ("Ro-Tel Original" is keyed "diced tomatoes and green
 * chiles"). The exclusion always runs on the name, which is what the recipe
 * said; when only the key matched it runs on the key as well, because the key
 * is where the match came from ("jalapeño" keyed "jalapeno pepper" must not
 * become a pepper spice). Exported for the tests.
 */
export function claims(l: Pick<Line, 'displayName' | 'canonicalKey'>, match: RegExp, not?: RegExp): boolean {
  const name = norm(l.displayName)
  if (not?.test(name)) return false
  if (match.test(name)) return true
  const key = norm(l.canonicalKey ?? '')
  return !!key && match.test(key) && !not?.test(key)
}

/** Produce and meat are sold loose: a line filed there takes a pack only when its own unit names a container. */
function soldLoose(l: Pick<Line, 'section' | 'unit'>): boolean {
  return (l.section === 'produce' || l.section === 'meat') && !CONTAINERS[unitOf(l)]
}
const unitOf = (l: Pick<Line, 'unit'>) => norm(l.unit ?? '')

/**
 * The line counts containers ("2 cans"), or is one bare thing ("Velveeta",
 * "1 Velveeta"): a pack size can go on it. A count of more than one with no
 * container ("12 lasagna noodles", "8 crescent rolls") counts PIECES, not
 * packages, so it gets none: 12 noodles is not 12 boxes.
 */
export function countedLine(l: Pick<Line, 'unit' | 'quantity'>): boolean {
  const u = unitOf(l)
  if (u in CONTAINERS) return true
  return COUNTS.has(u) && (l.quantity == null || l.quantity <= 1)
}

/** No package chosen: no count, no size, no container. */
export function hasPack(l: Pick<Line, 'buyCount' | 'sizeAmount' | 'packaging'>): boolean {
  return l.buyCount != null || l.sizeAmount != null || !!l.packaging?.trim()
}

/** A line that could carry a standard pack size but has none. */
export function needsSize(l: Line): boolean {
  return !hasPack(l) && countedLine(l)
}

/** A line with no amount at all. */
export function needsAmount(l: Line): boolean {
  return l.quantity == null
}

/**
 * The table's standard pack for this line, or null. The container the line
 * names picks an `alt` size. Produce and meat are sold loose, so a line filed
 * there gets a pack only when its own unit names a container ("1 can green
 * chiles"): "1 green chile" or "fresh tuna" stays as it is.
 */
export function lookupPack(l: Line): PackSize | null {
  const said = CONTAINERS[unitOf(l)]
  if (soldLoose(l)) return null
  for (const r of PACKS) {
    if (r.buyOnly || !claims(l, r.match, r.not)) continue
    const size = (said ? r.alt?.[said] : undefined) ?? r.size
    return { size, unit: r.unit, packaging: said && said !== 'container' ? said : r.packaging }
  }
  return null
}

/** What the table knows about buying a product: every size it is sold in, and its weight per cup. */
export interface SoldInfo {
  sizes: PackSize[]
  perCup?: number
}

/**
 * The sizes this line's product is sold in, for the buy math (#811), or null
 * when the table doesn't know it. Unlike lookupPack this ignores the container
 * the recipe counts in: a recipe that says "2 cans broth" can still be bought
 * as a carton. Produce and meat sold loose stay null, as in lookupPack.
 */
export function soldSizes(l: Line): SoldInfo | null {
  if (soldLoose(l)) return null
  for (const r of PACKS) {
    if (!claims(l, r.match, r.not)) continue
    const pairs: Array<[number, string]> = r.sold ?? [
      [r.size, r.packaging],
      ...Object.entries(r.alt ?? {}).map(([pk, size]) => [size, pk] as [number, string]),
    ]
    return { sizes: pairs.map(([size, packaging]) => ({ size, unit: r.unit, packaging })), perCup: r.perCup }
  }
  return null
}

/** The table's estimated amount for a spice or herb with none, or null. */
export function lookupAmount(l: Line): { quantity: number; unit: string } | null {
  for (const a of AMOUNTS) {
    if (!claims(l, a.match, NOT_A_SPICE)) continue
    // A fresh herb (filed with produce) is chopped by the tablespoon.
    if (a.fresh && l.section === 'produce') return { quantity: 2, unit: 'tbsp' }
    return { quantity: a.quantity, unit: a.unit }
  }
  return null
}

/** What a model estimated for one line. Anything can be null or nonsense: it is checked before use. */
export interface Estimate {
  quantity?: number | null
  unit?: string | null
  buyCount?: number | null
  sizeAmount?: number | null
  sizeUnit?: string | null
  packaging?: string | null
}

const goodNum = (n: unknown, max: number): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= max
const goodWord = (s: unknown): s is string =>
  typeof s === 'string' && s.trim().length > 0 && s.trim().length <= 20 && !/[\p{Cc}<>{}]/u.test(s)

/** Put a pack on a line that has none: the count follows the line's own count of containers. */
function withPack<T extends Line>(l: T, p: PackSize, buyCount?: number | null): T {
  const n = buyCount ?? (l.quantity != null && l.quantity > 0 ? packCount(l.quantity) : 1)
  const out: T = { ...l, buyCount: n, sizeAmount: p.size, sizeUnit: p.unit, packaging: p.packaging, sizeEstimated: true }
  // A bare "Velveeta" is one of them, counted in its package. A unit the line
  // already has ("can Rotel") is kept; only the number is filled.
  if (l.quantity == null) Object.assign(out, { quantity: 1, unit: l.unit?.trim() || p.packaging, amountEstimated: true })
  return out
}

/**
 * An estimated amount fitted to a unit the line already states ("a pinch of
 * salt", "cumin, to taste" with unit "tsp"): the line's unit is kept and only
 * the number is filled. tsp and tbsp convert; any other stated unit (pinch,
 * dash, sprig, bunch) is one of it. No stated unit: the estimate's own.
 */
const MEASURE_SPELLINGS: Record<string, string> = {
  teaspoon: 'tsp', teaspoons: 'tsp', tsps: 'tsp', t: 'tsp',
  tablespoon: 'tbsp', tablespoons: 'tbsp', tbsps: 'tbsp', tbs: 'tbsp', tbl: 'tbsp', T: 'tbsp',
}
/** One spelling per measure, so "teaspoons" and "tsp" compare equal. */
function measure(u: string): string {
  const t = u.trim().replace(/\.$/, '')
  return MEASURE_SPELLINGS[t] ?? MEASURE_SPELLINGS[t.toLowerCase()] ?? norm(t).replace(/s$/, '')
}

/** Small units a cook counts in: "1 pinch" is a fair estimate for any of them. */
const SMALL_COUNTS = new Set(['pinch', 'dash', 'sprinkle', 'sprig', 'bunch', 'handful', 'leaf', 'whole', 'clove', 'stick', 'piece', 'drop', 'smidgen'])

function fitAmount(stated: string | undefined, quantity: number, unit: string | undefined): { quantity: number; unit?: string } | null {
  const s = stated?.trim()
  if (!s) return { quantity, unit }
  const k = measure(s)
  const u = unit ? measure(unit) : ''
  if (!u || k === u) return { quantity, unit: s }
  if (u === 'tsp' && k === 'tbsp') return { quantity: Math.round((quantity / 3) * 100) / 100, unit: s }
  if (u === 'tbsp' && k === 'tsp') return { quantity: quantity * 3, unit: s }
  // Anything else ("cup", "oz" on a spice line) cannot be guessed from a
  // teaspoon estimate: leave the amount empty rather than say "1 cup cumin".
  return SMALL_COUNTS.has(k) ? { quantity: 1, unit: s } : null
}

/**
 * Fill a line's gaps from the table. Never changes a field that is set.
 * Returns the line unchanged (same object) when there was nothing to fill.
 */
export function fillFromTable<T extends Line>(l: T): T {
  let out = l
  if (needsSize(out)) {
    const p = lookupPack(out)
    if (p) out = withPack(out, p)
  }
  if (needsAmount(out)) {
    const a = lookupAmount(out)
    const f = a && fitAmount(out.unit, a.quantity, a.unit)
    if (f) out = { ...out, ...f, amountEstimated: true }
  }
  return out
}

/**
 * Fill a line's remaining gaps from a model's estimate, gaps only, after the
 * table. Each value is checked: a size needs a number and a unit, an amount a
 * positive number; anything else is dropped rather than trusted.
 */
export function mergeEstimate<T extends Line>(l: T, e: Estimate | undefined): T {
  if (!e) return l
  let out = l
  if (needsAmount(out) && goodNum(e.quantity, 1000)) {
    // A unit the model sends must be a plain word; with none, the line keeps its own.
    const unit = e.unit == null ? undefined : goodWord(e.unit) ? e.unit.trim() : null
    const f = unit === null ? null : fitAmount(out.unit, e.quantity, unit)
    if (f) out = { ...out, ...f, amountEstimated: true }
  }
  if (needsSize(out) && goodNum(e.sizeAmount, 1000) && goodWord(e.sizeUnit)) {
    const packaging = goodWord(e.packaging) ? e.packaging.trim().toLowerCase() : CONTAINERS[unitOf(out)] ?? 'package'
    const count = goodNum(e.buyCount, 50) ? Math.ceil(e.buyCount) : null
    out = withPack(out, { size: e.sizeAmount, unit: e.sizeUnit.trim(), packaging }, count)
  }
  return out
}

/**
 * At parse time: the model has already estimated (flagged) where it could. The
 * table still goes first, so a table hit replaces the model's estimated size;
 * a size the source stated (not flagged) is kept, and an estimated pack on a
 * produce or meat line with no container unit is dropped. Amounts the model estimated
 * stay, because it saw the recipe's yield and the table did not.
 */
export function standardizeParsed<T extends Line>(l: T): T {
  // The model guessed a pack for something sold loose ("1 green chile"): drop it.
  if (l.sizeEstimated && (soldLoose(l) || lookupPack(l))) {
    l = { ...l, buyCount: undefined, sizeAmount: undefined, sizeUnit: undefined, packaging: undefined, sizeEstimated: undefined }
  }
  return fillFromTable(l)
}

/**
 * The lines a model is asked about on Standardize, after the table: no amount
 * at all, or counted in a named container ("1 jar harissa") with no size. A
 * line counted in whole things ("2 onions") is not asked about: it is almost
 * always loose produce, and only the table claims the exceptions ("1 Velveeta").
 * A line the model was already asked about (estimateAsked) is never asked again.
 */
export function openGaps(lines: Line[]): number[] {
  const out: number[] = []
  lines.forEach((l, i) => {
    if (l.estimateAsked) return
    if (needsAmount(l) || (needsSize(l) && unitOf(l) in CONTAINERS)) out.push(i)
  })
  return out
}

/** Whether Standardize has anything to do: the table would fill a line, or (with AI) a gap is left for the model. */
export function canStandardize(lines: Line[], ai: boolean): boolean {
  if (lines.some((l) => fillFromTable(l) !== l)) return true
  return ai && openGaps(lines).length > 0
}

/** How many lines gained an estimate between two versions of the same list (Standardize's toast). */
export function filledCount(before: Line[], after: Line[]): number {
  let n = 0
  for (let i = 0; i < Math.min(before.length, after.length); i++) {
    const b = before[i]
    const a = after[i]
    if ((a.sizeEstimated && !b.sizeEstimated) || (a.amountEstimated && !b.amountEstimated)) n++
  }
  return n
}

/** How many lines differ between two versions of the same list (by identity: fillFromTable returns the same object when nothing changed). */
export function changedCount(before: Line[], after: Line[]): number {
  let n = 0
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) n++
  return n
}

/**
 * The amount a recipe line puts on a shopping list, scaled. An estimated amount
 * is left off: a list line merges only with one in the same unit, so "1 tsp
 * cumin" Mise made up would sit beside the "cumin" already on the list instead
 * of merging into it. The pack (an estimated size included) still goes.
 */
export function listAmount(
  l: Pick<Line, 'quantity' | 'unit' | 'amountEstimated'>,
  factor = 1,
): { quantity?: number; unit?: string } {
  if (l.amountEstimated) return { quantity: undefined, unit: undefined }
  return { quantity: l.quantity != null ? Math.round(l.quantity * factor * 100) / 100 : undefined, unit: l.unit }
}
