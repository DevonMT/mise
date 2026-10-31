/**
 * Ingredient matching (#702): what is one thing, and what must stay two.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchKey, sameIngredient, itemKeys } from './match'

const same = (a: string, b: string) =>
  assert.equal(matchKey(a), matchKey(b), `${a} (${matchKey(a)}) should match ${b} (${matchKey(b)})`)
const apart = (a: string, b: string) =>
  assert.notEqual(matchKey(a), matchKey(b), `${a} (${matchKey(a)}) must not match ${b} (${matchKey(b)})`)

test('cumin is cumin however it is written', () => {
  for (const n of ['ground cumin', 'cumin powder', 'Cumin', 'CUMIN', 'cumin, ground', '1 tsp ground cumin',
    '½ teaspoon cumin powder', 'Ground Cumin (optional)', 'cumin powder, to taste']) {
    assert.equal(matchKey(n), 'cumin', n)
  }
})

test('plurals fold', () => {
  same('tomatoes', 'tomato')
  same('Potatoes', 'potato')
  same('cloves', 'clove')
  same('berries', 'berry')
  same('peaches', 'peach')
  same('bay leaves', 'bay leaf')
  same('cookies', 'cookie')
  same('2 cups chickpeas', 'chickpea')
  same('kiwis', 'kiwi')
  same('cheeses', 'cheese')
  assert.equal(matchKey('hummus'), 'hummus')
  assert.equal(matchKey('molasses'), 'molasses')
  assert.equal(matchKey('asparagus'), 'asparagus')
})

test('filler, prep and amounts are ignored', () => {
  same('fresh chopped basil', 'basil')
  same('2 large yellow onions, diced', 'yellow onion')
  same('1 1/2 cups shredded cheddar', 'cheddar')
  same('a pinch of salt', 'salt')
  same('3 cloves garlic, minced', 'garlic')
  same('garlic clove', 'garlic')
  same('1 (14 oz) can chickpeas', 'chickpeas')
  same('8 fl oz milk', 'milk')
  same('2 tablespoons of butter', 'butter')
})

test('salt versus sea salt: plain salts are one thing, seasoned salts are not', () => {
  for (const n of ['sea salt', 'kosher salt', 'table salt', 'flaky sea salt', 'fine sea salt', 'Salt, to taste',
    'coarse kosher salt']) {
    assert.equal(matchKey(n), 'salt', n)
  }
  apart('garlic salt', 'salt')
  apart('celery salt', 'salt')
  apart('salted butter', 'salt')
  apart('salt pork', 'salt')
})

test('no false merges: a powder or a ground form that is its own product', () => {
  apart('chili powder', 'chili')
  apart('garlic powder', 'garlic')
  apart('onion powder', 'onion')
  apart('baking powder', 'baking soda')
  apart('baking powder', 'baking')
  apart('ground beef', 'beef')
  apart('ground turkey', 'turkey')
  apart('ground pork', 'pork')
  apart('powdered sugar', 'sugar')
  apart('curry powder', 'curry')
  apart('ground ginger', 'ginger')
  apart('milk powder', 'milk')
  apart('whole milk', 'milk')
  apart('2% milk', 'milk')
  apart('bell pepper', 'black pepper')
  apart('red onion', 'onion')
  apart('chicken breast', 'chicken thigh')
  apart('cilantro', 'coriander')
  apart('cumin seed', 'cumin')
  apart('tomato paste', 'tomato')
  apart('1 can diced tomatoes', 'tomato')
  apart('dried basil', 'basil')
})

test('chili spellings agree, and chili is still not chili powder', () => {
  same('chile powder', 'chili powder')
  same('chilli powder', 'chili powder')
  apart('chili powder', 'chili pepper')
})

test('fresh ginger is ginger; ground ginger is its own jar', () => {
  same('fresh ginger', 'ginger')
  same('ginger powder', 'ground ginger')
  apart('ground ginger', 'fresh ginger')
})

test('black pepper in its usual spellings', () => {
  for (const n of ['pepper', 'ground black pepper', 'freshly ground pepper', 'black pepper', 'Freshly Ground Black Pepper']) {
    assert.equal(matchKey(n), 'black pepper', n)
  }
})

test('aliases', () => {
  same('scallions', 'green onions')
  same('spring onion', 'green onion')
  same('garbanzo beans', 'chickpeas')
  same('confectioners’ sugar', 'powdered sugar')
  same('icing sugar', 'powdered sugar')
  same('all-purpose flour', 'flour')
  same('bicarbonate of soda', 'baking soda')
  same('extra-virgin olive oil', 'olive oil')
  same('heavy whipping cream', 'heavy cream')
  same('crushed red pepper', 'red pepper flakes')
  same('ground red pepper', 'cayenne')
  same('dried oregano', 'oregano')
  same('chicken stock', 'chicken broth')
  same('Jalapeño', 'jalapeno')
  same('unsweetened cocoa', 'cocoa powder')
  same('mustard powder', 'dry mustard')
})

test('empty and amount-only names match nothing', () => {
  assert.equal(matchKey(''), '')
  assert.equal(matchKey('  '), '')
  assert.equal(matchKey('2 cups'), '')
  assert.equal(sameIngredient({ displayName: '' }, { displayName: '' }), false)
})

test('a stored row also answers to its parsed canonicalKey', () => {
  // The parser's own key is coarser than the name; either side may meet.
  const stored = { displayName: 'Yellow onions', canonicalKey: 'onion' }
  assert.ok(sameIngredient(stored, { displayName: 'onion' }))
  assert.ok(sameIngredient(stored, { displayName: 'diced onions', canonicalKey: 'onion' }))
  assert.ok(!sameIngredient(stored, { displayName: 'red onion', canonicalKey: 'red onion' }))
  // The raw key is kept, so anything that merged by canonicalKey before still does.
  assert.ok(itemKeys({ displayName: 'x', canonicalKey: 'Whatever Key ' }).has('whatever key'))
})

test('a legacy canonicalize() key still lines up with the match key', () => {
  // canonicalize() was the only normalizer before this; its output must meet
  // the new key for the same name, or old rows would stop merging.
  for (const n of ['onions', 'tomatoes', 'berries', 'carrots', 'the eggs', 'olives']) {
    assert.ok(sameIngredient({ displayName: n }, { displayName: n.toLowerCase(), canonicalKey: legacy(n) }), n)
  }
})

function legacy(name: string): string {
  let k = name.trim().toLowerCase().replace(/^(a|an|the)\s+/, '')
  if (k.endsWith('ies')) k = k.slice(0, -3) + 'y'
  else if (k.endsWith('oes')) k = k.slice(0, -2)
  else if (k.endsWith('ses')) k = k.slice(0, -2)
  else if (k.endsWith('s') && !k.endsWith('ss')) k = k.slice(0, -1)
  return k
}

test('a word after a comma is a qualifier unless it is prep', () => {
  same('Rice, brown', 'brown rice')
  same('Pepper, red', 'red pepper')
  same('Beans, black', 'black beans')
  same('Cheese, Swiss', 'swiss cheese')
  same('Ginger, ground', 'ground ginger')
  same('onion, chopped', 'onion')
  same('butter, 1 stick', 'butter')
  same('butter, or margarine', 'butter')
  apart('Rice, brown', 'Rice, jasmine')
  apart('Sugar, brown', 'sugar')
  apart('Wine, red', 'wine')
  apart('Pepper, red', 'black pepper')
  apart('Ginger, ground', 'fresh ginger')
})

test('peppers are not the pepper jar', () => {
  apart('peppers', 'pepper')
  apart('2 peppers', 'black pepper')
  assert.equal(matchKey('pepper'), 'black pepper')
})

test('amounts and units in every common spelling', () => {
  const lines: [string, string][] = [
    ['2 lb. ground beef', 'ground beef'], ['1 tbsp. olive oil', 'olive oil'], ['2 tsp. salt', 'salt'],
    ['1 c. flour', 'flour'], ['4 oz. cream cheese', 'cream cheese'], ['1 T butter', 'butter'],
    ['1 t cumin', 'cumin'], ['1-2 cloves garlic', 'garlic'], ['2-3 tablespoons olive oil', 'olive oil'],
    ['1 to 2 cups flour', 'flour'], ['1 1/2 lbs chicken thighs', 'chicken thigh'], ['1.5 lb potatoes', 'potato'],
    ['1/2-inch piece ginger', 'ginger'], ['2 (8-oz) packages cream cheese', 'cream cheese'],
    ['a 14-ounce can chickpeas', 'chickpea'], ['1 15oz can black beans', 'black bean'],
    ['2 heaping tablespoons sugar', 'sugar'], ['2 celery stalks', 'celery'], ['2 ribs celery', 'celery'],
    ['head of garlic', 'garlic'], ['bunch of cilantro', 'cilantro'], ['1 can of tomatoes', 'tomato'],
    ['1 stick of butter', 'butter'], ['2 strips bacon', 'bacon'], ['4 links sausage', 'sausage'],
    ['1 loaf bread', 'bread'], ['2 fillets salmon', 'salmon'], ['two cloves garlic', 'garlic'],
    ['one onion', 'onion'], ['half an onion', 'onion'], ['1/2 onion', 'onion'], ['1 cup (240 ml) milk', 'milk'],
    ['pound of ground beef', 'ground beef'], ['teaspoon of salt', 'salt'], ['dash of hot sauce', 'hot sauce'],
    ['splash of milk', 'milk'], ['extra-large eggs', 'egg'], ['jumbo shrimp', 'shrimp'],
  ]
  for (const [line, key] of lines) assert.equal(matchKey(line), key, line)
  // "half and half" is a product, not an amount.
  assert.equal(matchKey('half & half'), matchKey('half and half'))
  assert.notEqual(matchKey('half and half'), matchKey('milk'))
})

test('a note after the comma never becomes part of the name', () => {
  const lines: [string, string][] = [
    ['onion, finely chopped', 'onion'], ['garlic, peeled and crushed', 'garlic'],
    ['butter, room temperature', 'butter'], ['eggs, room temperature', 'egg'],
    ['olive oil, for frying', 'olive oil'], ['olive oil, plus more for drizzling', 'olive oil'],
    ['flour, for dusting', 'flour'], ['water, as needed', 'water'], ['onion, cut into rings', 'onion'],
    ['carrots, cut into 1-inch pieces', 'carrot'], ['potatoes, scrubbed', 'potato'],
    ['parsley, stems removed', 'parsley'], ['tomatoes, seeded', 'tomato'], ['tomatoes, diced', 'tomato'],
    ['spinach, washed and dried', 'spinach'], ['2 eggs, beaten', 'egg'], ['1 lemon, juiced', 'lemon'],
    ['black beans, drained and rinsed', 'black bean'], ['black beans, rinsed', 'black bean'],
    ['parmesan, freshly grated', 'parmesan'], ['black pepper, freshly cracked', 'black pepper'],
    ['olive oil (extra virgin)', 'olive oil'], ['peeled and deveined shrimp', 'shrimp'],
    ['olive oil for frying', 'olive oil'], ['butter plus more for the pan', 'butter'],
  ]
  for (const [line, key] of lines) assert.equal(matchKey(line), key, line)
  // A real qualifier still counts, and is not mistaken for prep.
  assert.equal(matchKey('rice, long grain'), 'long grain rice')
})

test('juice, zest and peel "of" a fruit read as lemon juice, lemon zest', () => {
  same('juice of 1 lemon', 'lemon juice')
  same('juice of 2 limes', 'lime juice')
  same('zest of a lemon', 'lemon zest')
  same('zest of 1 orange', 'orange zest')
  same('lemon peel', 'lemon zest')
  apart('lemon juice', 'lemon')
  apart('lemon zest', 'lemon juice')
})

test('a form you buy separately is not its plain self', () => {
  apart('sliced almonds', 'almonds')
  apart('slivered almonds', 'sliced almonds')
  apart('shredded coconut', 'coconut')
  apart('fresh mozzarella', 'mozzarella')
  apart('shredded mozzarella', 'fresh mozzarella')
  apart('fresh turmeric', 'ground turmeric')
  apart('turmeric root', 'turmeric')
  apart('fresh coriander', 'ground coriander')
  apart('fresh pasta', 'pasta')
  apart('chopped tomatoes', 'tomatoes')
  apart('crushed tomatoes', 'diced tomatoes')
  apart('minced beef', 'beef')
  same('sliced mushrooms', 'mushrooms')
  same('chopped walnuts', 'walnuts')
  same('shredded cheddar', 'cheddar')
  same('grated parmesan', 'parmesan')
})

test('a last word that names the thing it already names', () => {
  same('cheddar cheese', 'cheddar')
  same('Ricotta cheese', 'ricotta')
  same('shredded cheddar cheese', 'cheddar')
  same('penne pasta', 'penne')
  same('thyme sprigs', 'thyme')
  same('6 sprigs thyme', 'thyme')
  same('fresh basil leaves', 'basil')
  same('salmon fillets', 'salmon')
  same('anchovy fillets', 'anchovies')
  same('hoisin sauce', 'hoisin')
  same('romaine lettuce', 'romaine')
  same('miso paste', 'miso')
  same('ranch dressing', 'ranch')
  // ...but not where it makes the product ("cream cheese" is not "cream").
  apart('cream cheese', 'cheese')
  apart('cream cheese', 'cream')
  apart('goat cheese', 'cheese')
  apart('cottage cheese', 'cheese')
  apart('bay leaf', 'bay')
  apart('curry leaf', 'curry')
  apart('tomato paste', 'tomato')
  apart('fish sauce', 'fish')
  apart('oyster sauce', 'oyster')
})

test('hot, cold and iced water are water', () => {
  for (const n of ['hot water', 'ice water', 'cold water', 'boiling water', 'warm water', 'lukewarm water']) {
    assert.equal(matchKey(n), 'water', n)
  }
  apart('coconut water', 'water')
  apart('tonic water', 'water')
  apart('ice', 'water')
  same('ice cubes', 'ice')
})

test('bare words mean the usual thing', () => {
  same('sugar', 'granulated sugar')
  same('white sugar', 'sugar')
  same('brown sugar', 'light brown sugar')
  apart('brown sugar', 'dark brown sugar')
  apart('sugar', 'brown sugar')
  apart('sugar', 'powdered sugar')
  same('vanilla', 'pure vanilla extract')
  apart('vanilla extract', 'vanilla bean')
  same('hamburger', 'ground beef')
  same('hamburger meat', 'ground beef')
  same('beef mince', 'ground beef')
  apart('ground beef', 'ground chuck')
  same('prawns', 'shrimp')
  same('plain yogurt', 'yogurt')
  apart('greek yogurt', 'yogurt')
  same('plain greek yogurt', 'greek yogurt')
  same('pure maple syrup', 'maple syrup')
  same('sweet paprika', 'paprika')
  apart('smoked paprika', 'paprika')
  same('italian parsley', 'flat leaf parsley')
  same('fennel bulb', 'fennel')
  apart('fennel seeds', 'fennel')
})

test('more plain salts, still not the seasoned ones', () => {
  for (const n of ['Maldon sea salt flakes', 'Diamond Crystal kosher salt', 'Morton kosher salt', 'fleur de sel',
    'flake sea salt', 'Celtic sea salt', 'grey sea salt']) {
    assert.equal(matchKey(n), 'salt', n)
  }
  same('seasoning salt', 'seasoned salt')
  apart('seasoned salt', 'salt')
  apart('smoked salt', 'salt')
  apart('truffle salt', 'salt')
})

test('pepper in its jars: ground, cracked and whole peppercorns', () => {
  same('cracked black pepper', 'black pepper')
  same('coarse black pepper', 'black pepper')
  same('black peppercorns', 'whole peppercorns')
  same('peppercorns', 'whole black peppercorns')
  apart('black peppercorns', 'black pepper')
  apart('white pepper', 'black pepper')
  apart('lemon pepper', 'black pepper')
  apart('pink peppercorns', 'peppercorns')
})

test('the same product under another name', () => {
  same('breadcrumbs', 'bread crumbs')
  same('panko breadcrumbs', 'panko')
  apart('panko', 'breadcrumbs')
  same('distilled white vinegar', 'white vinegar')
  same('cider vinegar', 'apple cider vinegar')
  same('rice wine vinegar', 'rice vinegar')
  same('reduced sodium soy sauce', 'low sodium soy sauce')
  apart('low sodium soy sauce', 'soy sauce')
  same('shoyu', 'soy sauce')
  same('veggie broth', 'vegetable broth')
  same('stock cube', 'bouillon cube')
  same('old fashioned oats', 'rolled oats')
  same('flax seeds', 'flaxseed')
  apart('ground flaxseed', 'flaxseed')
  same('semi-sweet chocolate chips', 'chocolate chips')
  same('creamy peanut butter', 'peanut butter')
  same('canned pumpkin', 'pumpkin puree')
  same('red kidney beans', 'kidney beans')
  same('string beans', 'green beans')
  same('sugar snap peas', 'snap peas')
  same('swiss chard', 'chard')
  same('beetroot', 'beets')
  same('button mushrooms', 'mushrooms')
  same('baby bella mushrooms', 'cremini mushrooms')
  same('plum tomatoes', 'roma tomatoes')
  same('elbow macaroni', 'macaroni')
  same('lasagne sheets', 'lasagna noodles')
  same('granulated garlic', 'garlic powder')
  same('dried minced onion', 'onion flakes')
  same('ear of corn', 'corn on the cob')
  same('worcestershire sauce', 'worcestershire')
  same('mayo', 'mayonnaise')
  same('bbq sauce', 'barbecue sauce')
  same('Dijon mustard', 'dijon')
  same('caster sugar', 'superfine sugar')
})

test('look-alikes that are different things stay different', () => {
  const pairs: [string, string][] = [
    ['coconut milk', 'coconut water'], ['coconut milk', 'milk'], ['almond milk', 'almond flour'],
    ['rice', 'rice vinegar'], ['rice', 'rice flour'], ['sour cream', 'cream'], ['sour cream', 'cream cheese'],
    ['peanut butter', 'butter'], ['bread flour', 'flour'], ['cake flour', 'flour'], ['corn syrup', 'corn'],
    ['cornmeal', 'cornstarch'], ['cornflour', 'cornstarch'], ['sweet potato', 'potato'], ['green onion', 'onion'],
    ['green bean', 'black bean'], ['hot sauce', 'sauce'], ['apple juice', 'apple cider'],
    ['apple cider', 'apple cider vinegar'], ['chicken broth', 'chicken bouillon'],
    ['tomato sauce', 'tomato paste'], ['white wine vinegar', 'white vinegar'],
    ['red wine vinegar', 'balsamic vinegar'], ['baking powder', 'cocoa powder'], ['chili powder', 'chipotle powder'],
    ['unsalted butter', 'salted butter'], ['egg whites', 'eggs'], ['egg yolks', 'egg whites'],
    ['whole wheat flour', 'flour'], ['canned tuna', 'tuna steak'], ['cooked rice', 'rice'],
    ['frozen peas', 'peas'], ['canned black beans', 'dried black beans'], ['dark chocolate', 'chocolate chips'],
    ['cumin seeds', 'ground cumin'], ['coriander seeds', 'coriander'], ['cinnamon sticks', 'cinnamon'],
    ['whole cloves', 'ground cloves'], ['cardamom pods', 'cardamom'], ['garlic', 'cloves'],
    ['ground sage', 'sage'], ['dried thyme', 'thyme'], ['dried basil', 'basil'], ['dried parsley', 'parsley'],
    ['thai basil', 'basil'], ['mexican oregano', 'oregano'], ['peppermint', 'mint'],
    ['ground pork', 'pork chops'], ['ground chicken', 'chicken breast'], ['chicken wings', 'chicken thighs'],
    ['black garlic', 'garlic'], ['pickled ginger', 'ginger'], ['crystallized ginger', 'ginger'],
    ['pumpkin puree', 'pumpkin'], ['artichoke hearts', 'artichoke'], ['sun dried tomatoes', 'tomatoes'],
    ['salsa', 'tomato sauce'], ['marinara', 'pasta sauce'], ['dark soy sauce', 'soy sauce'],
  ]
  for (const [a, b] of pairs) apart(a, b)
})
