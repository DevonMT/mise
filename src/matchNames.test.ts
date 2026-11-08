/**
 * Match My Names (#812): which recipe lines get a card, which name they get,
 * and what an accepted card writes. A card that is never accepted writes
 * nothing.
 */
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
})
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {},
           matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) },
})
;(globalThis as unknown as { CustomEvent: unknown }).CustomEvent = class {}

const { db } = await import('./db')
// The stamping hooks live in sync.ts; loading it is what mints uids and stamps.
await import('./sync')
const { nameCards, closeness, renamed, loadNameSources, acceptCards } = await import('./matchNames')
type NameSource = import('./matchNames').NameSource
type RecipeIngredient = import('./db').RecipeIngredient

const src = (displayName: string, canonicalKey: string, section = 'pantry', from: NameSource['from'] = 'pantry'): NameSource =>
  ({ displayName, canonicalKey, section: section as NameSource['section'], from })
const line = (displayName: string, canonicalKey: string, extra: Partial<RecipeIngredient> = {}): RecipeIngredient =>
  ({ displayName, canonicalKey, section: 'other', ...extra })

test('close matches: the words left over only describe the same product', () => {
  assert.ok(closeness(line('Original Bisquick mix', 'original bisquick mix'), src('Bisquick', 'bisquick')) > 0)
  assert.ok(closeness(line('boneless skinless chicken breasts', 'boneless skinless chicken breast'), src('Chicken breast', 'chicken breast')) > 0)
  assert.ok(closeness(line('condensed cream of chicken soup', 'condensed cream of chicken soup'), src('Cream of chicken soup', 'cream of chicken soup')) > 0)
  assert.ok(closeness(line('taco seasoning mix', 'taco seasoning mix'), src('Taco seasoning', 'taco seasoning')) > 0)
  assert.ok(closeness(line('low sodium chicken broth', 'low sodium chicken broth'), src('Chicken broth', 'chicken broth')) > 0)
  // Either way round: the recipe can be the short one.
  assert.ok(closeness(line('Bisquick', 'bisquick'), src('Original Bisquick mix', 'original bisquick mix')) > 0)
})

test('must stay apart: a leftover word that names another product', () => {
  const apart: [string, string][] = [
    ['chicken broth', 'chicken'],
    ['cream cheese', 'cheese'],
    ['sour cream', 'cream'],
    ['brown sugar', 'sugar'],
    ['green onion', 'onion'],
    ['unsalted butter', 'butter'],
    ['cream of chicken soup', 'chicken'],
    ['ranch dressing mix', 'ranch dressing'],
    ['onion soup mix', 'onion soup'],
    ['cake mix', 'cake'],
    ['extra firm tofu', 'tofu'],
  ]
  for (const [a, b] of apart) assert.equal(closeness(line(a, a), src(b, b)), -1, `${a} vs ${b}`)
})

test('nameCards: one card per line, same beats close, pantry beats favorite', () => {
  const sources = [
    src('Green onions', 'green onion', 'produce'),
    src('Chicken breast', 'chicken breast', 'meat'),
    src('Bisquick', 'bisquick', 'baking', 'favorite'),
    src('Boneless chicken breast', 'boneless chicken breast', 'meat', 'favorite'),
  ]
  const cards = nameCards(
    [
      line('scallions', 'scallion'),
      line('boneless skinless chicken breasts', 'boneless skinless chicken breast'),
      line('Original Bisquick mix', 'original bisquick mix'),
      line('chicken broth', 'chicken broth'),
      line('Green Onions', 'green onion'),
    ],
    sources,
  )
  assert.deepEqual(
    cards.map((c) => [c.index, c.to.displayName, c.how]),
    [
      [0, 'Green onions', 'same'],
      // "Boneless chicken breast" is one word closer than "Chicken breast".
      [1, 'Boneless chicken breast', 'close'],
      [2, 'Bisquick', 'close'],
    ],
  )
})

test('a line keyed broadly by the parser is a same match', () => {
  const [card] = nameCards(
    [line('boneless skinless chicken breasts', 'chicken breast')],
    [src('Chicken breast', 'chicken breast', 'meat')],
  )
  assert.equal(card.how, 'same')
})

test('renamed: name, key and aisle change; amount, pack and flags stay', () => {
  const was = line('Original Bisquick mix', 'original bisquick mix', {
    quantity: 2, unit: 'cup', buyCount: 1, sizeAmount: 40, sizeUnit: 'oz', packaging: 'box',
    sizeEstimated: true, amountEstimated: true, estimateAsked: true, optional: true,
  })
  const now = renamed(was, src('Bisquick', 'bisquick', 'baking'))
  assert.deepEqual(now, {
    ...was, displayName: 'Bisquick', canonicalKey: 'bisquick', section: 'baking', estimateAsked: undefined,
  })
  // A source with no stored key gets one from its name.
  assert.equal(renamed(was, src('Bisquicks', '')).canonicalKey, 'bisquick')
})

beforeEach(async () => {
  await db.recipes.clear()
  await db.items.clear()
  await db.lists.clear()
  await db.catalog.clear()
})

async function seedRecipe(): Promise<number> {
  return db.recipes.add({
    title: 'Chicken and Dumplings',
    servings: 6,
    createdAt: 1,
    ingredients: [
      line('Original Bisquick mix', 'original bisquick mix', { quantity: 2, unit: 'cup', section: 'pantry' }),
      line('boneless skinless chicken breasts', 'boneless skinless chicken breast', { quantity: 1.5, unit: 'lb', section: 'meat' }),
      line('chicken broth', 'chicken broth', { quantity: 2, unit: 'can' }),
    ],
  })
}

test('loadNameSources: live pantry rows, then favorites, no repeats, no pending', async () => {
  const pantry = await db.lists.add({ name: 'Pantry', kind: 'pantry', createdAt: 1, uid: 'default:pantry' })
  const folded = await db.lists.add({ name: 'Pantry (moved)', kind: 'pantry', createdAt: 1, foldedInto: 'default:pantry' })
  const grocery = await db.lists.add({ name: 'My list', kind: 'grocery', createdAt: 1, uid: 'default:list' })
  const item = (listId: number, displayName: string, more = {}) =>
    db.items.add({ listId, displayName, canonicalKey: displayName.toLowerCase(), section: 'meat', checked: false, backlog: false, createdAt: 1, ...more })
  await item(pantry, 'Chicken breast', { checked: true }) // marked out is still a name he keeps
  await item(pantry, 'Saffron', { pending: true })
  await item(folded, 'Old thing')
  await item(grocery, 'Grocery thing')
  await db.catalog.bulkAdd([
    { canonicalKey: 'bisquick', displayName: 'Bisquick', section: 'baking', count: 3, favorite: true, lastAdded: 1 },
    { canonicalKey: 'chicken breast', displayName: 'chicken breast', section: 'meat', count: 3, favorite: true, lastAdded: 1 },
    { canonicalKey: 'milk', displayName: 'Milk', section: 'dairy', count: 9, favorite: false, lastAdded: 1 },
  ])
  const got = await loadNameSources()
  assert.deepEqual(got.map((s) => [s.displayName, s.from]), [['Chicken breast', 'pantry'], ['Bisquick', 'favorite']])
})

test('acceptCards: accepted lines change and get stamped; skipped lines do not', async () => {
  const id = await seedRecipe()
  const before = (await db.recipes.get(id))!
  const sources = [src('Bisquick', 'bisquick', 'baking', 'favorite'), src('Chicken breast', 'chicken breast', 'meat')]
  const cards = nameCards(before.ingredients, sources)
  assert.equal(cards.length, 2)
  // Accept the Bisquick card, skip the chicken one.
  const n = await acceptCards(id, cards.filter((c) => c.to.displayName === 'Bisquick'))
  assert.equal(n, 1)
  const after = (await db.recipes.get(id))!
  assert.equal(after.ingredients[0].displayName, 'Bisquick')
  assert.equal(after.ingredients[0].canonicalKey, 'bisquick')
  assert.equal(after.ingredients[0].section, 'baking')
  assert.equal(after.ingredients[0].quantity, 2)
  assert.equal(after.ingredients[0].unit, 'cup')
  assert.deepEqual(after.ingredients[1], before.ingredients[1])
  assert.deepEqual(after.ingredients[2], before.ingredients[2])
  // The sync hooks saw a real edit.
  assert.ok(after.uid && after.uid === before.uid)
  assert.ok((after.updatedAt ?? 0) >= (before.updatedAt ?? 0))
  // Now it says his name, so it gets no card the next time.
  assert.deepEqual(nameCards(after.ingredients, sources).map((c) => c.index), [1])
})

test('acceptCards: skipping everything writes nothing', async () => {
  const id = await seedRecipe()
  const before = (await db.recipes.get(id))!
  assert.equal(await acceptCards(id, []), 0)
  assert.deepEqual(await db.recipes.get(id), before)
})

test('acceptCards: a card for a line that changed since is dropped', async () => {
  const id = await seedRecipe()
  const recipe = (await db.recipes.get(id))!
  const cards = nameCards(recipe.ingredients, [src('Bisquick', 'bisquick', 'baking')])
  // An edit elsewhere renames the line before the card is accepted.
  const edited = [...recipe.ingredients]
  edited[0] = { ...edited[0], displayName: 'Self-rising flour', canonicalKey: 'self-rising flour' }
  await db.recipes.update(id, { ingredients: edited })
  assert.equal(await acceptCards(id, cards), 0)
  assert.equal((await db.recipes.get(id))!.ingredients[0].displayName, 'Self-rising flour')
})
