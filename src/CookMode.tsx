import { useEffect, useState } from 'react'
import type { Recipe } from './db'
import { kitchenNumber } from './recipeText'
import { Icon } from './Icon'
import { useDialog } from './ds/useDialog'
import { useBackLayer } from './back'

/**
 * Cook mode: one step at a time, big, with the screen kept awake.
 *
 * Reading a recipe off a phone propped on the counter fails in three ways: the
 * screen sleeps with floury hands, the whole method is one block of text so
 * the place is lost between glances, and the amounts are the recipe's, not the
 * servings chosen. This fixes all three. The first step is gathering — every
 * ingredient at the chosen scale, ticked off as it comes out of the cupboard —
 * because "do I have everything" is a question for before the pan is hot.
 */

/** Split the method into steps. Captured instructions are one string, usually
 *  "1. … \n2. …", sometimes one paragraph with the numbers inline. */
export function splitSteps(text: string | undefined): string[] {
  if (!text?.trim()) return []
  let parts = text.split(/\n+/)
  if (parts.length === 1) parts = text.split(/\s(?=\d{1,2}[.)]\s)/)
  return parts.map((p) => p.replace(/^\s*\d{1,2}[.)]\s*/, '').trim()).filter(Boolean)
}

type Wake = { release: () => Promise<void> }

function useWakeLock() {
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Wake> } }
    if (!nav.wakeLock) return
    let lock: Wake | null = null
    let alive = true
    const take = () => {
      nav.wakeLock!.request('screen').then(
        (l) => (alive ? (lock = l) : void l.release()),
        () => {},
      )
    }
    // The browser drops the lock whenever the page is hidden, so take it again
    // on the way back — otherwise a glance at a text ends cook mode's point.
    const onVisible = () => document.visibilityState === 'visible' && take()
    take()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release().catch(() => {})
    }
  }, [])
}

export function CookMode({
  recipe,
  factor,
  includeOptional,
  onClose,
}: {
  recipe: Recipe
  factor: number
  /** Indices into recipe.ingredients of the optional ones chosen on the detail page. */
  includeOptional: Set<number>
  onClose: () => void
}) {
  const dialogRef = useDialog(onClose)
  useBackLayer(true, onClose)
  useWakeLock()

  const steps = splitSteps(recipe.instructions)
  const total = steps.length + 1 // step 0 is gathering
  const [at, setAt] = useState(0)
  const [got, setGot] = useState<Set<number>>(new Set())

  const using = recipe.ingredients
    .map((ing, i) => ({ ing, i }))
    .filter(({ ing, i }) => !ing.optional || includeOptional.has(i))

  const amount = (q?: number, unit?: string) => {
    if (q == null) return ''
    const u = unit && unit !== 'whole' ? ` ${unit}` : ''
    return kitchenNumber(q * factor) + u
  }

  const toggle = (i: number) =>
    setGot((s) => {
      const n = new Set(s)
      n.has(i) ? n.delete(i) : n.add(i)
      return n
    })

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cook-title"
      tabIndex={-1}
      className="fullview cook-mode"
    >
      <div className="fullview-head">
        <button className="icon-back" onClick={onClose} aria-label="Leave cook mode">
          <Icon name="x" size={22} />
        </button>
        <h2 className="detail-title" id="cook-title">
          {recipe.title}
        </h2>
        <span className="cook-count">
          {at === 0 ? 'Gather' : `Step ${at} of ${steps.length}`}
        </span>
      </div>

      <div className="fullview-body cook-body">
        {at === 0 ? (
          <>
            <p className="cook-lead">
              Get these out{factor !== 1 ? ` — amounts are for ${recipe.servings ? kitchenNumber(recipe.servings * factor) + ' servings' : `×${kitchenNumber(factor)}`}` : ''}.
            </p>
            <div className="cook-gather">
              {using.map(({ ing, i }) => (
                <button key={i} className={got.has(i) ? 'cook-ing on' : 'cook-ing'} onClick={() => toggle(i)}>
                  <span className="opt-check">{got.has(i) ? '✓' : ''}</span>
                  <span className="cook-amt">{amount(ing.quantity, ing.unit)}</span>
                  <span className="cook-name">{ing.displayName}</span>
                </button>
              ))}
            </div>
            {!steps.length && <p className="cook-lead">This recipe has no steps saved.</p>}
          </>
        ) : (
          <p className="cook-step">{steps[at - 1]}</p>
        )}
      </div>

      <div className="fullview-foot cook-foot">
        <button className="ghost" onClick={() => setAt((a) => a - 1)} disabled={at === 0}>
          Back
        </button>
        {at < total - 1 ? (
          <button className="primary" onClick={() => setAt((a) => a + 1)}>
            {at === 0 ? 'Start cooking' : 'Next step'}
          </button>
        ) : (
          <button className="primary" onClick={onClose}>
            Done
          </button>
        )}
      </div>
    </div>
  )
}
