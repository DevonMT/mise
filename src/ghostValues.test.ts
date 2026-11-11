// No ghost values in fields (#837). Sample text inside an input reads as a
// value already filled in, so fields have a visible label (see `Field.tsx`) and
// an example, where one is needed, sits in a focus-only `.ds-hint` under it.
// The one allowed `placeholder=` is the recipe search box: an action prompt
// that says what the box does, never what to type.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const ALLOWED = new Map([['RecipesView.tsx', 1]])

test('placeholder= appears only on the allowed search box', () => {
  const dir = new URL('./', import.meta.url)
  const found = new Map<string, number>()
  for (const f of readdirSync(dir)) {
    if (!/\.tsx?$/.test(f) || /\.test\.tsx?$/.test(f)) continue
    // `placeholder=` as a JSX attribute, or `.placeholder =` set by a script.
    const n = (readFileSync(new URL(f, dir), 'utf8').match(/placeholder\s*=/g) ?? []).length
    if (n) found.set(f, n)
  }
  assert.deepEqual([...found].sort(), [...ALLOWED].sort())
})

test('the ds hint is used through Field, which links it to its input', () => {
  const src = readFileSync(new URL('./Field.tsx', import.meta.url), 'utf8')
  assert.match(src, /aria-describedby/)
  assert.match(src, /className="ds-hint"/)
})
