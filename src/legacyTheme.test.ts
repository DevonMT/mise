import test from 'node:test'
import assert from 'node:assert/strict'
import { legacyThemeOnce } from './legacyTheme'

const flagStore = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}

test('the old pick is handed over once, then never again', () => {
  const flag = flagStore()
  assert.equal(legacyThemeOnce(() => 'dark', flag), 'dark')
  assert.equal(legacyThemeOnce(() => 'dark', flag), null)
})

test('no old pick yet: nothing is consumed, a later synced one still migrates', () => {
  const flag = flagStore()
  assert.equal(legacyThemeOnce(() => null, flag), null)
  assert.equal(legacyThemeOnce(() => 'light', flag), 'light')
})

test('"system" was a choice and migrates', () => {
  assert.equal(legacyThemeOnce(() => 'system', flagStore()), 'system')
})

test('an invalid stored value is ignored and does not end the migration', () => {
  const flag = flagStore()
  assert.equal(legacyThemeOnce(() => 'neon', flag), null)
  assert.equal(legacyThemeOnce(() => 'dark', flag), 'dark')
})

test('blocked storage never throws', () => {
  const blocked = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  assert.equal(legacyThemeOnce(() => 'dark', blocked), null)
  const readOnly = { getItem: () => null, setItem: () => { throw new Error('blocked') } }
  assert.equal(legacyThemeOnce(() => 'dark', readOnly), 'dark')
})
