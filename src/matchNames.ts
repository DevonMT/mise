/**
 * Match My Names (#812): rename a saved recipe's lines to the names Devon
 * already keeps, his pantry items and his favorites, one approval card per
 * line.
 *
 * Why rename at all, when `sameIngredient` already merges "scallions" with
 * "Green onions"? Two reasons. A line the matcher only nearly knows
 * ("Original Bisquick mix" against a favorite "Bisquick", "boneless skinless
 * chicken breasts" against a pantry "Chicken breast") never merges and never
 * skips; after a rename it carries his own canonicalKey and takes the exact-key
 * path in `findMergeTarget`. And a recipe that says his names reads like his
 * list.
 *
 * Deterministic, no model. Two tiers:
 *   - same: `sameIngredient` already says yes, only the name differs.
 *   - close: one name's words are the other's plus words from DESCRIBES, which
 *     describe the same product rather than a different one. An allow-list on
 *     purpose, like match.ts's spice list: "chicken broth" is not "chicken",
 *     "cream cheese" is not "cheese", "unsalted butter" stays the baker's call.
 *
 * Nothing here writes until a card is accepted. An accepted card changes the
 * line's name, canonicalKey and aisle; the amount and the pack stay the
 * recipe's.
 */
import { canonicalize, db, isLive, type Recipe, type RecipeIngredient, type Section } from './db'
import { itemKeys, sameIngredient } from './match'

/** One of Devon's own names a recipe line can take. */
export interface NameSource {
  displayName: string
  canonicalKey: string
  section: Section
  /** Pantry rows first: they are what the recipe-add skip reads. */
  from: 'pantry' | 'favorite'
  quantity?: number
  unit?: string
}

export interface NameCard {
  /** Position in `recipe.ingredients`. */
  index: number
  /** The line's name when the card was made; a save checks it is still that. */
  was: string
  to: NameSource
  how: 'same' | 'close'
}

/** Words that describe the same product on the shelf. Compared after
 *  matchKey has singularized and dropped prep words. */
const DESCRIBES = new Set([
  'boneless', 'skinless', 'original', 'classic', 'regular', 'organic', 'natural',
  'condensed', 'homestyle', 'traditional', 'uncooked', 'brand', 'name', 'store', 'bought', 'storebought',
])
/** Two-word describers. Alone, "low", "reduced" or "extra" could mean
 *  anything ("reduced sugar", "extra firm"); only these pairs are safe. */
const DESCRIBE_PAIRS = ['low sodium', 'reduced sodium', 'extra lean']

/** "mix" is a different product by default: "rice mix" is not rice, "cocoa
 *  mix" is not cocoa, "ranch dressing mix" is not the bottle. It describes only
 *  after these: "taco seasoning mix", "Original Bisquick mix". */
const MIX_OK = new Set(['seasoning', 'bisquick', 'jiffy'])

/** Do the leftover words only describe? Pairs first, then single words, and
 *  "mix" only after a MIX_OK word. */
function onlyDescribes(extra: string[], small: string[]): boolean {
  let rest = ` ${extra.join(' ')} `
  for (const p of DESCRIBE_PAIRS) rest = rest.replace(` ${p} `, ' ')
  return rest
    .split(' ')
    .filter(Boolean)
    .every((w) => DESCRIBES.has(w) || (w === 'mix' && MIX_OK.has(small[small.length - 1])))
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

type Keyed = Pick<NameSource, 'displayName' | 'canonicalKey' | 'quantity' | 'unit'>

/** How many describing words separate the two names, or -1 when they are not
 *  the same product. 0 is never returned: an equal key is `sameIngredient`. */
export function closeness(a: Keyed, b: Keyed): number {
  let best = -1
  const bKeys = [...itemKeys(b)].map((k) => k.split(' '))
  for (const ka of itemKeys(a)) {
    const wa = ka.split(' ')
    for (const wb of bKeys) {
      const [small, big] = wa.length <= wb.length ? [wa, wb] : [wb, wa]
      if (small.length === big.length) continue
      const pool = [...big]
      let ok = true
      for (const w of small) {
        const at = pool.indexOf(w)
        if (at < 0) {
          ok = false
          break
        }
        pool.splice(at, 1)
      }
      if (!ok || !onlyDescribes(pool, small)) continue
      if (best < 0 || pool.length < best) best = pool.length
    }
  }
  return best
}

/**
 * The cards for one recipe: at most one per line, best source first (a same
 * match over a close one, then fewer extra words, then pantry over favorite).
 * A line that already says one of his names gets no card.
 */
export function nameCards(ingredients: RecipeIngredient[], sources: NameSource[]): NameCard[] {
  const usable = sources.filter((s) => s.displayName.trim())
  const known = new Set(usable.map((s) => norm(s.displayName)))
  const cards: NameCard[] = []
  ingredients.forEach((line, index) => {
    const name = norm(line.displayName)
    if (!name || known.has(name)) return
    const same = usable.find((s) => sameIngredient(line, s))
    if (same) {
      cards.push({ index, was: line.displayName, to: same, how: 'same' })
      return
    }
    let pick: NameSource | undefined
    let fewest = Infinity
    for (const s of usable) {
      const d = closeness(line, s)
      if (d > 0 && d < fewest) {
        pick = s
        fewest = d
      }
    }
    if (pick) cards.push({ index, was: line.displayName, to: pick, how: 'close' })
  })
  return cards
}

/** The line after an accepted card. Same rule as RecipeEditor's `fromRow` for
 *  a rename: the key follows the new name (here his own stored key), and the
 *  line becomes a new question for Standardize. */
export function renamed(line: RecipeIngredient, to: NameSource): RecipeIngredient {
  return {
    ...line,
    displayName: to.displayName.trim(),
    canonicalKey: to.canonicalKey.trim() || canonicalize(to.displayName),
    section: to.section,
    estimateAsked: undefined,
  }
}

/** Pantry rows (live pantry lists, not pending), then favorites, one per name. */
export async function loadNameSources(): Promise<NameSource[]> {
  const pantryIds = new Set(
    (await db.lists.filter((l) => l.kind === 'pantry' && isLive(l)).toArray()).map((l) => l.id!),
  )
  const pantry = pantryIds.size
    ? await db.items.filter((i) => pantryIds.has(i.listId) && !i.pending).toArray()
    : []
  const favorites = await db.catalog.filter((c) => c.favorite).toArray()
  const out: NameSource[] = []
  const seen = new Set<string>()
  const push = (s: NameSource) => {
    const k = norm(s.displayName)
    if (!k || seen.has(k)) return
    seen.add(k)
    out.push(s)
  }
  for (const i of pantry) {
    push({ displayName: i.displayName, canonicalKey: i.canonicalKey, section: i.section, from: 'pantry', quantity: i.quantity, unit: i.unit })
  }
  for (const c of favorites) {
    push({ displayName: c.displayName, canonicalKey: c.canonicalKey, section: c.section, from: 'favorite', unit: c.unit })
  }
  return out
}

/**
 * Save accepted cards onto the recipe. Reads the recipe fresh and skips any
 * card whose line has changed since (an edit or a sync moved it), so a stale
 * card never renames the wrong line. A plain update, so the sync hooks stamp
 * it and it travels like any other edit. Returns how many lines changed.
 */
export async function acceptCards(recipeId: number, cards: NameCard[]): Promise<number> {
  return db.transaction('rw', db.recipes, async () => {
    const recipe: Recipe | undefined = await db.recipes.get(recipeId)
    if (!recipe) return 0
    const ingredients = [...recipe.ingredients]
    let n = 0
    for (const c of cards) {
      const line = ingredients[c.index]
      if (!line || line.displayName !== c.was) continue
      ingredients[c.index] = renamed(line, c.to)
      n++
    }
    if (n) await db.recipes.update(recipeId, { ingredients })
    return n
  })
}
