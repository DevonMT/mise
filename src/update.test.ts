/** A new build reloads the app, but never under someone mid-task (11/08). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
const { reloadWhenIdle } = await import('./update')

function harness(busy: boolean) {
  const s = { busy, reloads: 0, tick: () => {}, hide: () => {}, stopped: false }
  reloadWhenIdle({
    busy: () => s.busy,
    reload: () => void s.reloads++,
    onHidden: (fn) => void (s.hide = fn),
    every: (fn) => {
      s.tick = fn
      return () => void (s.stopped = true)
    },
  })
  return s
}

test('idle: reloads at once', () => {
  assert.equal(harness(false).reloads, 1)
})

test('busy: waits, then reloads once when the sheet closes', () => {
  const s = harness(true)
  assert.equal(s.reloads, 0)
  s.tick()
  assert.equal(s.reloads, 0)
  s.busy = false
  s.tick()
  assert.equal(s.reloads, 1)
  assert.ok(s.stopped)
  s.hide()
  s.tick()
  assert.equal(s.reloads, 1)
})

test('busy: going to the background reloads, where nobody sees it', () => {
  const s = harness(true)
  s.hide()
  assert.equal(s.reloads, 1)
  assert.ok(s.stopped)
})
