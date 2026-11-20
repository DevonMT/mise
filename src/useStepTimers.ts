import { useCallback, useEffect, useRef, useState } from 'react'
import type { StepDuration } from './cookTimer'

/**
 * Step timers for Cook Mode (#1001).
 *
 * A timer is an END TIME, not a count. A counting interval stops when the
 * screen sleeps and is throttled in a background tab, so a count would drift
 * behind the clock; the time left is always `endsAt - Date.now()`, and the
 * interval only makes the screen re-read it. When the page comes back from
 * sleep the next read is right and the timer is marked done if it passed.
 *
 * Cook Mode already holds the screen awake while it is open, which is what
 * keeps these running on the counter. State lives in the component, not
 * storage: closing Cook Mode ends its timers.
 */

export interface StepTimer {
  /** `${step}:${ms}`: one per time named in a step. Starting again replaces it. */
  key: string
  /** 1-based step number, as the screen shows it. */
  step: number
  label: string
  ms: number
  endsAt: number
  done: boolean
}

export const timerKey = (step: number, d: StepDuration) => `${step}:${d.ms}`

/** Three beeps and a buzz, where the browser lets a page make them. */
function alertDone(ctx: AudioContext | null) {
  try {
    navigator.vibrate?.([300, 150, 300, 150, 300])
  } catch {
    /* Not every browser vibrates. The banner is the alert that always shows. */
  }
  if (!ctx) return
  try {
    void ctx.resume()
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      const t = ctx.currentTime + i * 0.45
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.32)
    }
  } catch {
    /* Autoplay rules can refuse. Same answer: the banner. */
  }
}

export function useStepTimers() {
  const [timers, setTimers] = useState<StepTimer[]>([])
  const [now, setNow] = useState(() => Date.now())
  // Made inside the Start Timer tap: a browser only lets audio begin from one.
  const audio = useRef<AudioContext | null>(null)

  const running = timers.some((t) => !t.done)
  useEffect(() => {
    if (!running) return
    const tick = () => setNow(Date.now())
    tick()
    const id = setInterval(tick, 500)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [running])

  useEffect(() => {
    if (!timers.some((t) => !t.done && t.endsAt <= now)) return
    setTimers((ts) => ts.map((t) => (!t.done && t.endsAt <= now ? { ...t, done: true } : t)))
    alertDone(audio.current)
  }, [now, timers])

  useEffect(
    () => () => {
      void audio.current?.close().catch(() => {})
    },
    [],
  )

  const start = useCallback((step: number, d: StepDuration) => {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (Ctx) audio.current ??= new Ctx()
      void audio.current?.resume()
    } catch {
      /* No audio here. The banner still shows. */
    }
    const key = timerKey(step, d)
    const t = Date.now()
    setNow(t)
    setTimers((ts) => [
      ...ts.filter((x) => x.key !== key),
      { key, step, label: d.label, ms: d.ms, endsAt: t + d.ms, done: false },
    ])
  }, [])

  const remove = useCallback((key: string) => setTimers((ts) => ts.filter((t) => t.key !== key)), [])

  return { timers, now, start, remove }
}
