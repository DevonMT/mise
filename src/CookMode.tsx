import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Recipe } from './db'
import { kitchenNumber } from './recipeText'
import { recipeAmount } from './buy'
import { Icon } from './Icon'
import { useDialog } from './ds/useDialog'
import { useBackLayer } from './back'
import { findDurations, formatLeft } from './cookTimer'
import { timerKey, useStepTimers } from './useStepTimers'

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
  onToggleOptional,
  onClose,
}: {
  recipe: Recipe
  factor: number
  /** Indices into recipe.ingredients of the optional ones chosen on the detail page. */
  includeOptional: Set<number>
  /** Flips one optional ingredient's include state. The set lives on the detail
   *  page, so a choice made here is still there when cooking ends (#1000). */
  onToggleOptional: (i: number) => void
  onClose: () => void
}) {
  const dialogRef = useDialog(onClose)
  useBackLayer(true, onClose)
  useWakeLock()
  const { timers, now, start, remove } = useStepTimers()

  const steps = splitSteps(recipe.instructions)
  const total = steps.length + 1 // step 0 is gathering
  const [at, setAt] = useState(0)
  const [got, setGot] = useState<Set<number>>(new Set())

  const indexed = recipe.ingredients.map((ing, i) => ({ ing, i }))
  const required = indexed.filter(({ ing }) => !ing.optional)
  const optional = indexed.filter(({ ing }) => ing.optional)

  // The recipe's own words, range and all: "2 to 3 soup cans" (#811).
  const amount = (q?: number, unit?: string, quantityMax?: number) =>
    q == null ? '' : recipeAmount({ quantity: q, quantityMax, unit }, factor)

  const ingredientCells = (ing: Recipe['ingredients'][number], ticked: boolean) => (
    <>
      <span className="opt-check">{ticked ? '✓' : ''}</span>
      <span className="cook-amt" title={ing.amountEstimated ? 'Estimated by Mise' : undefined}>
        {ing.amountEstimated && amount(ing.quantity, ing.unit) ? '≈ ' : ''}
        {amount(ing.quantity, ing.unit, ing.quantityMax)}
      </span>
      <span className="cook-name">{ing.displayName}</span>
    </>
  )

  const toggle = (i: number) =>
    setGot((s) => {
      const n = new Set(s)
      n.has(i) ? n.delete(i) : n.add(i)
      return n
    })

  // On the body, not inside the app: the estate bar is a sticky sibling above
  // everything in `.app`, and it sat over this view's close button (#999).
  return createPortal(
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

      {(() => {
        // Finished timers always show, wherever you are. A running one shows here
        // while you are on another step, so a step further on never hides it.
        const shown = timers.filter((t) => t.done || t.step !== at)
        if (!shown.length) return null
        return (
          <div className="cook-timers">
            {shown.map((t) =>
              t.done ? (
                <div key={t.key} className="cook-alarm" role="alert">
                  <span>
                    Timer done: step {t.step}, {t.label}
                  </span>
                  <button className="cook-timer-btn" onClick={() => remove(t.key)}>
                    Dismiss
                  </button>
                </div>
              ) : (
                <div key={t.key} className="cook-alarm running">
                  <button className="cook-timer-jump" onClick={() => setAt(t.step)}>
                    Step {t.step}: <b>{formatLeft(t.endsAt - now)}</b> left
                  </button>
                  <button className="cook-timer-btn" onClick={() => remove(t.key)}>
                    Cancel Timer
                  </button>
                </div>
              ),
            )}
          </div>
        )
      })()}

      <div className="fullview-body cook-body">
        {at === 0 ? (
          <>
            <p className="cook-lead">
              Get these out.{factor !== 1 ? ` Amounts are for ${recipe.servings ? kitchenNumber(recipe.servings * factor) + ' servings' : `×${kitchenNumber(factor)}`}.` : ''}
            </p>
            <div className="cook-gather">
              {required.map(({ ing, i }) => (
                <button key={i} className={got.has(i) ? 'cook-ing on' : 'cook-ing'} onClick={() => toggle(i)}>
                  {ingredientCells(ing, got.has(i))}
                </button>
              ))}
            </div>
            {optional.length > 0 && (
              <section className="cook-optional" aria-labelledby="cook-opt-head">
                <h3 className="cook-group" id="cook-opt-head">
                  Optional
                </h3>
                <p className="cook-lead">Tap to include. Included ones get ticked off like the rest.</p>
                <div className="cook-gather">
                  {optional.map(({ ing, i }) => {
                    const on = includeOptional.has(i)
                    return (
                      <div key={i} className="cook-wrap">
                        {on ? (
                          <button className={got.has(i) ? 'cook-ing on' : 'cook-ing'} onClick={() => toggle(i)}>
                            {ingredientCells(ing, got.has(i))}
                          </button>
                        ) : (
                          <button
                            className="cook-ing off"
                            aria-label={`Include ${ing.displayName}`}
                            onClick={() => onToggleOptional(i)}
                          >
                            {ingredientCells(ing, false)}
                            <span className="cook-include">Include</span>
                          </button>
                        )}
                        {on && (
                          <button
                            className="cook-leave"
                            aria-label={`Leave out ${ing.displayName}`}
                            onClick={() => onToggleOptional(i)}
                          >
                            Leave Out
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            )}
            {!steps.length && <p className="cook-lead">This recipe has no steps saved.</p>}
          </>
        ) : (
          <>
            <p className="cook-step">{steps[at - 1]}</p>
            {findDurations(steps[at - 1]).map((d) => {
              const t = timers.find((x) => x.key === timerKey(at, d) && !x.done)
              return t ? (
                <div key={t.key} className="cook-timer on">
                  <span className="cook-clock" role="timer">
                    {formatLeft(t.endsAt - now)}
                  </span>
                  <span className="cook-timer-note">left of {d.label}</span>
                  <button className="cook-timer-btn" onClick={() => remove(t.key)}>
                    Cancel Timer
                  </button>
                </div>
              ) : (
                <div key={d.ms} className="cook-timer">
                  <button className="cook-timer-start" onClick={() => start(at, d)}>
                    Start Timer
                  </button>
                  <span className="cook-timer-note">
                    {d.range ? `${d.label}, the low end of ${d.range}` : d.label}
                  </span>
                </div>
              )
            })}
          </>
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
    </div>,
    document.body,
  )
}
