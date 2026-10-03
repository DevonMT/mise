import { db, canonicalize, type Section } from './db'

/**
 * Paste a list with no model: split it, read an amount and unit off the front
 * of each line, and let the catalogue say what the rest of the app already
 * knows (the aisle, the name you use, the pack you refined, the usual unit).
 *
 * This is what Paste does when the AI is off for the account (Lite, a family
 * grant) or cannot be reached. It is plain code end to end, so it never makes a
 * request to /api/parse and costs nothing; the merge afterwards is addItem's.
 */

/** Units a line may open with. Plurals and abbreviations fold to one form so
 *  "3 cans" and "1 can" merge into one line. */
const UNIT_FORMS: Record<string, string> = {
  cup: 'cup', cups: 'cup', tbsp: 'tbsp', tbsps: 'tbsp', tsp: 'tsp', tsps: 'tsp',
  oz: 'oz', ounce: 'oz', ounces: 'oz', lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  g: 'g', kg: 'kg', ml: 'ml', l: 'l', clove: 'clove', cloves: 'clove',
  can: 'can', cans: 'can', jar: 'jar', jars: 'jar', bottle: 'bottle', bottles: 'bottle',
  bag: 'bag', bags: 'bag', box: 'box', boxes: 'box', bunch: 'bunch', bunches: 'bunch',
  pkg: 'pkg', pkgs: 'pkg', package: 'pkg', packages: 'pkg', stick: 'stick', sticks: 'stick',
  dozen: 'dozen', slice: 'slice', slices: 'slice', quart: 'quart', quarts: 'quart',
  pint: 'pint', pints: 'pint', gal: 'gal', gallon: 'gal', gallons: 'gal', loaf: 'loaf', loaves: 'loaf',
}

const VULGAR: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 }

export interface PlainLine {
  displayName: string
  canonicalKey: string
  quantity?: number
  unit?: string
}

/** "1 1/2", "3/4", "2.5", "½", "2" to a number, or undefined. */
function readNumber(s: string): number | undefined {
  const t = s.trim()
  if (VULGAR[t] != null) return VULGAR[t]
  const mixed = t.match(/^(\d+)\s+(\d+)\/(\d+)$/)
  if (mixed) return Number(mixed[3]) ? Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]) : undefined
  const frac = t.match(/^(\d+)\/(\d+)$/)
  if (frac) return Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : undefined
  const n = Number(t)
  return t && Number.isFinite(n) ? n : undefined
}

const NUM = String.raw`\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|[½¼¾⅓⅔]`
const LEAD = new RegExp(`^(${NUM})(\\s*)(.*)$`)

/** Split pasted text into entries: one per line, and also at " / ", ";" and ",". */
export function splitEntries(text: string): string[] {
  return text
    .split(/[\r\n;,]+|\s\/\s/)
    .map((s) => s.replace(/^\s*(?:[-*•–]|\d+[.)]|\[[ xX]?\])\s+/, '').trim())
    .filter(Boolean)
}

/** One entry to name, amount, unit. No amount is fine ("milk"). */
export function parseEntry(entry: string): PlainLine | null {
  let name = entry.trim()
  let quantity: number | undefined
  let unit: string | undefined
  const m = name.match(LEAD)
  if (m) {
    const rest = m[3]
    const first = rest.split(/\s+/)[0]?.toLowerCase().replace(/\.$/, '') ?? ''
    // "2lb beef" has no space, so only a real unit may follow a bare number;
    // otherwise "7up" would become 7 of "up".
    if (m[2] || UNIT_FORMS[first]) {
      quantity = readNumber(m[1])
      name = rest
      if (UNIT_FORMS[first] && rest.split(/\s+/).length > 1) {
        unit = UNIT_FORMS[first]
        name = rest.replace(/^\S+\s+/, '')
      }
      name = name.replace(/^of\s+/i, '')
    }
  }
  name = name.replace(/\s+/g, ' ').trim()
  if (!name) return null
  return { displayName: name, canonicalKey: canonicalize(name), quantity, unit }
}

export interface PlainRow extends PlainLine {
  section: Section
  buyCount?: number
  sizeAmount?: number
  sizeUnit?: string
  packaging?: string
}

/**
 * Parse pasted text and fill each line from the catalogue: the aisle and name
 * you used last time, the unit when you typed none, and the pack Refine chose.
 * Reads only; nothing is written until the rows are added.
 */
export async function planPlainPaste(text: string): Promise<PlainRow[]> {
  const rows: PlainRow[] = []
  for (const entry of splitEntries(text)) {
    const line = parseEntry(entry)
    if (!line) continue
    const cat = await db.catalog.where('canonicalKey').equals(line.canonicalKey).first()
    rows.push({
      ...line,
      displayName: cat?.displayName ?? line.displayName,
      unit: line.unit ?? cat?.unit,
      section: cat?.section ?? 'other',
      buyCount: cat?.buyCount,
      sizeAmount: cat?.sizeAmount,
      sizeUnit: cat?.sizeUnit,
      packaging: cat?.packaging,
    })
  }
  return rows
}
