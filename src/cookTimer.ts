/**
 * Durations in a Cook Mode step (#1001): "simmer 10 minutes", "chill 3 to 4
 * hours", "1 hour 30 minutes". Pure, so the matching is tested without a page.
 *
 * Only a stated number and a time unit count. "Overnight", "until golden" and
 * "a few minutes" name no length, so there is nothing to time. A range starts
 * at its low end (you can always let it run on, never un-cook), and the caller
 * says so on screen.
 */

export interface StepDuration {
  /** What to count down, in ms: the low end of a range. */
  ms: number
  /** `ms` in words: "3 hours", "1 hour 30 minutes". */
  label: string
  /** The range as the step wrote it ("3 to 4 hours"), when it was one. */
  range?: string
}

const FRACTIONS: Record<string, number> = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 }

// "1½", "1 1/2", "1/2", "2.5", "10", "½".
const NUM = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?[¼½¾⅓⅔]?|[¼½¾⅓⅔])`
const UNIT = String.raw`(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b`
const SEP = String.raw`(?:to|or|-|–|—)`

const SINGLE = new RegExp(String.raw`(?<![\d./])(${NUM})(?:\s*${SEP}\s*(${NUM}))?\s*-?\s*${UNIT}`, 'gi')
const WORDS = /\b(half an hour|an hour|a half hour)\b/gi
// "1 hour 30 minutes", "1 hour and 15 min": a minutes tail right after hours.
const TAIL = new RegExp(String.raw`^\s*(?:and\s+|,\s*)?(${NUM})\s*-?\s*(minutes?|mins?)\b`, 'i')

/** Anything under this is a technique ("dip for 2 seconds"), not a wait. */
const MIN_MS = 10_000

function value(s: string): number {
  const t = s.trim()
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t)
  if (mixed) return +mixed[1] + +mixed[2] / +mixed[3]
  const frac = /^(\d+)\/(\d+)$/.exec(t)
  if (frac) return +frac[1] / +frac[2]
  const last = t.slice(-1)
  if (last in FRACTIONS) return (t.length > 1 ? parseFloat(t.slice(0, -1)) : 0) + FRACTIONS[last]
  return parseFloat(t)
}

function unitMs(unit: string): number {
  const u = unit.toLowerCase()
  return u.startsWith('h') ? 3_600_000 : u.startsWith('m') ? 60_000 : 1000
}

/** "90 minutes" → "1 hour 30 minutes"; "45 seconds"; "3 hours". */
export function describeDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const part = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
  const out = [h && part(h, 'hour'), m && part(m, 'minute'), s && part(s, 'second')].filter(Boolean)
  return out.join(' ') || '0 seconds'
}

/** Time left as a clock: "2:41:10" over an hour, "9:05" under. */
export function formatLeft(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const two = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`
}

/** Every time the step names, in reading order, at most three. */
export function findDurations(step: string): StepDuration[] {
  const found: Array<StepDuration & { at: number }> = []
  // Where a folded "1 hour 30 minutes" ends, so its minutes aren't found twice.
  let foldedTo = 0

  for (const m of step.matchAll(SINGLE)) {
    if (m.index < foldedTo) continue
    const low = value(m[1]) * unitMs(m[3])
    const ranged = m[2] != null
    let ms = low
    let text = m[0]
    // "1 hour 30 minutes": fold the minutes into the hour, once.
    if (!ranged && unitMs(m[3]) === 3_600_000) {
      const tail = TAIL.exec(step.slice(m.index + m[0].length))
      if (tail) {
        ms += value(tail[1]) * 60_000
        text += tail[0]
        foldedTo = m.index + text.length
      }
    }
    if (ms < MIN_MS || !Number.isFinite(ms)) continue
    found.push({ ms, label: describeDuration(ms), range: ranged ? text.trim() : undefined, at: m.index })
  }

  for (const m of step.matchAll(WORDS)) {
    const ms = m[1].toLowerCase().startsWith('half') || m[1].toLowerCase().startsWith('a half') ? 1_800_000 : 3_600_000
    // "an hour" inside "1 hour" can't happen (SINGLE needs digits), so no overlap check.
    found.push({ ms, label: describeDuration(ms), at: m.index })
  }

  found.sort((a, b) => a.at - b.at)
  const seen = new Set<number>()
  const out: StepDuration[] = []
  for (const { at: _at, ...d } of found) {
    if (seen.has(d.ms)) continue
    seen.add(d.ms)
    out.push(d)
    if (out.length === 3) break
  }
  return out
}
