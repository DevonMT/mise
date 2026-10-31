/**
 * How a Refine size option compares to the amount a list line asks for (#704).
 *
 * Only like compares with like: volume↔volume, weight↔weight, count↔count.
 * A cup of salsa against a 16 oz jar is a guess (is that "oz" fluid or weight?),
 * so anything that can't be compared soundly yields null and the UI shows nothing.
 */

type Family = 'volume' | 'weight' | 'count'

interface UnitInfo {
  family: Family
  /** Size of one of this unit in the family's base (fl oz, oz, one). */
  factor: number
  /** Display name, singular and plural. */
  one: string
  many: string
}

const FL_OZ_ML = 29.5735295625
const OZ_G = 28.349523125

const unit = (family: Family, factor: number, one: string, many = one): UnitInfo => ({
  family, factor, one, many,
})

const TSP = unit('volume', 1 / 6, 'tsp')
const TBSP = unit('volume', 0.5, 'tbsp')
const FL_OZ = unit('volume', 1, 'fl oz')
const CUP = unit('volume', 8, 'cup', 'cups')
const PINT = unit('volume', 16, 'pint', 'pints')
const QUART = unit('volume', 32, 'quart', 'quarts')
const GALLON = unit('volume', 128, 'gallon', 'gallons')
const ML = unit('volume', 1 / FL_OZ_ML, 'ml')
const LITER = unit('volume', 1000 / FL_OZ_ML, 'L')
const OZ = unit('weight', 1, 'oz')
const LB = unit('weight', 16, 'lb')
const G = unit('weight', 1 / OZ_G, 'g')
const KG = unit('weight', 1000 / OZ_G, 'kg')
const COUNT = unit('count', 1, '')
const DOZEN = unit('count', 12, '')

const UNITS: Record<string, UnitInfo> = {
  tsp: TSP, tsps: TSP, teaspoon: TSP, teaspoons: TSP,
  tbsp: TBSP, tbsps: TBSP, tablespoon: TBSP, tablespoons: TBSP,
  'fl oz': FL_OZ, 'fl. oz': FL_OZ, 'fl. oz.': FL_OZ, floz: FL_OZ, 'fluid ounce': FL_OZ, 'fluid ounces': FL_OZ,
  cup: CUP, cups: CUP, c: CUP,
  pint: PINT, pints: PINT, pt: PINT,
  quart: QUART, quarts: QUART, qt: QUART,
  gallon: GALLON, gallons: GALLON, gal: GALLON,
  ml: ML, milliliter: ML, milliliters: ML, millilitre: ML, millilitres: ML,
  l: LITER, liter: LITER, liters: LITER, litre: LITER, litres: LITER,
  // A bare "oz" is weight: a recipe or package that means fluid ounces says "fl oz".
  oz: OZ, ounce: OZ, ounces: OZ,
  lb: LB, lbs: LB, pound: LB, pounds: LB,
  g: G, gram: G, grams: G,
  kg: KG, kilogram: KG, kilograms: KG,
  '': COUNT, whole: COUNT, each: COUNT, ea: COUNT, ct: COUNT, count: COUNT,
  pc: COUNT, pcs: COUNT, piece: COUNT, pieces: COUNT,
  dozen: DOZEN, doz: DOZEN,
}

function lookup(raw: string | null | undefined): UnitInfo | null {
  const key = (raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  return UNITS[key] ?? null
}

/** An option's per-package size, from sizeAmount + sizeUnit, or from a
 *  self-describing packaging noun (a dozen, a single lb, an each). */
function packageSize(o: SizeOption): { amount: number; info: UnitInfo } | null {
  if (o.sizeAmount != null && o.sizeAmount > 0) {
    const info = lookup(o.sizeUnit)
    return info ? { amount: o.sizeAmount, info } : null
  }
  if (o.sizeAmount != null || o.sizeUnit) return null
  const pk = (o.packaging ?? '').trim().toLowerCase()
  if (pk === 'dozen' || pk === 'doz') return { amount: 1, info: DOZEN }
  if (pk === 'lb' || pk === 'each' || pk === 'ea') return { amount: 1, info: lookup(pk)! }
  return null
}

export interface SizeOption {
  sizeAmount?: number | null
  sizeUnit?: string | null
  packaging?: string | null
}

export interface NeedLine {
  quantity?: number | null
  unit?: string | null
}

export type FitKind = 'exact' | 'over' | 'short'

export interface Fit {
  kind: FitKind
  /** One package reaches the amount asked for. */
  covers: boolean
  /** The closest size that covers it (or the closest of all, if none does). */
  best: boolean
  /** "+0.5 cup over", "0.5 cup short" or "exact". */
  text: string
  /** Set on the best size when no size covers the need alone: how many of it would. */
  packs?: number
  /** "2 × covers it", for the same case. */
  packsText?: string
}

/** Within half a percent counts as exact (4 fl oz vs 0.5 cup lands on it despite float noise). */
const EXACT_TOLERANCE = 0.005

function fmtNum(n: number): string {
  const r = Math.round(n * 100) / 100
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/\.?0+$/, '')
}

function amountText(n: number, u: UnitInfo): string {
  const num = fmtNum(n)
  const name = n > 1 ? u.many : u.one
  return name ? `${num} ${name}` : num
}

interface Measured {
  /** Package size less the need, in the need's own unit. */
  diff: number
  /** Packages of this size to reach the need. */
  packs: number
  kind: FitKind
}

/**
 * Compare one size to the need; null when the units can't be compared soundly
 * (volume vs weight, an unknown unit) or there is no amount asked for.
 */
function measure(need: NeedLine, opt: SizeOption): { m: Measured; needUnit: UnitInfo } | null {
  if (need.quantity == null || !(need.quantity > 0)) return null
  const needUnit = lookup(need.unit)
  const size = packageSize(opt)
  if (!needUnit || !size || needUnit.family !== size.info.family) return null
  const needBase = need.quantity * needUnit.factor
  const sizeBase = size.amount * size.info.factor
  const diff = (sizeBase - needBase) / needUnit.factor
  const exact = Math.abs(sizeBase - needBase) <= needBase * EXACT_TOLERANCE
  const kind: FitKind = exact ? 'exact' : diff > 0 ? 'over' : 'short'
  const packs = Math.max(1, Math.ceil(needBase / sizeBase - EXACT_TOLERANCE))
  return { m: { diff, packs, kind }, needUnit }
}

/**
 * One entry per option, in order: its Fit, or null when it can't be compared.
 * Comparison is per package (the size you read on the label), not count × size.
 * The best fit is the smallest size that covers the need; if none does, the
 * largest, along with how many of it you'd need.
 */
export function fitOptions(need: NeedLine, opts: SizeOption[]): Array<Fit | null> {
  const measured = opts.map((o) => measure(need, o))
  let bestIdx = -1
  measured.forEach((r, i) => {
    if (!r) return
    const cur = bestIdx < 0 ? null : measured[bestIdx]!.m
    const covers = r.m.kind !== 'short'
    if (!cur) bestIdx = i
    else if (cur.kind !== 'short') {
      // The best so far covers: only a covering, tighter size beats it.
      if (covers && r.m.diff < cur.diff) bestIdx = i
    } else if (covers || r.m.diff > cur.diff) {
      // The best so far falls short: any covering size, or a bigger short one, beats it.
      bestIdx = i
    }
  })
  return measured.map((r, i) => {
    if (!r) return null
    const { m, needUnit } = r
    const covers = m.kind !== 'short'
    const text =
      m.kind === 'exact'
        ? 'exact'
        : m.kind === 'over'
          ? `+${amountText(m.diff, needUnit)} over`
          : `${amountText(-m.diff, needUnit)} short`
    const fit: Fit = { kind: m.kind, covers, best: i === bestIdx, text }
    if (fit.best && !covers) {
      fit.packs = m.packs
      fit.packsText = `${m.packs} × covers it`
    }
    return fit
  })
}
