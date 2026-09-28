// The public recipe reader. See the note in index.html; the rule that matters
// is that nothing from the fragment is ever parsed as markup.
;(async () => {
  const $ = (id) => document.getElementById(id)
  const body = location.hash.slice(1)

  const b64urlToBytes = (s) => {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }

  // Same wire format as the app's share links (src/share.ts): "g." gzip or
  // "r." raw, then base64url JSON.
  const decode = async (b) => {
    const dot = b.indexOf('.')
    if (dot < 0) return null
    const mode = b.slice(0, dot)
    const bytes = b64urlToBytes(b.slice(dot + 1))
    const json =
      mode === 'g'
        ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
        : new TextDecoder().decode(bytes)
    const p = JSON.parse(json)
    return p && p.v === 1 && p.t === 'recipe' && Array.isArray(p.ingredients) ? p : null
  }

  let recipe = null
  try {
    recipe = await decode(body)
  } catch {
    recipe = null
  }
  if (!recipe) {
    $('broken').hidden = false
    return
  }

  const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v))
  const FRACTIONS = [[1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'],
    [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞']]
  const kitchen = (n) => {
    const whole = Math.floor(n)
    const rest = n - whole
    if (rest < 0.02) return String(whole)
    if (rest > 0.98) return String(whole + 1)
    const hit = FRACTIONS.find(([v]) => Math.abs(v - rest) < 0.02)
    if (!hit) return String(Math.round(n * 100) / 100)
    return whole ? whole + hit[1] : hit[1]
  }
  const amount = (i) => {
    if (typeof i.q !== 'number') return ''
    const unit = i.u && i.u !== 'whole' ? ' ' + str(i.u) : ''
    return kitchen(i.q) + unit
  }

  const fill = (listId, items) => {
    const ul = $(listId)
    for (const i of items) {
      const li = document.createElement('li')
      const a = amount(i)
      if (a) {
        const q = document.createElement('span')
        q.className = 'qty'
        q.textContent = a
        li.append(q)
      }
      li.append(document.createTextNode(str(i.n)))
      ul.append(li)
    }
  }

  const title = str(recipe.title) || 'A recipe'
  document.title = title
  $('title').textContent = title
  if (recipe.servings) $('serves').textContent = 'Serves ' + kitchen(Number(recipe.servings))

  const required = recipe.ingredients.filter((i) => !i.x)
  const optional = recipe.ingredients.filter((i) => i.x)
  fill('ingredients', required)
  if (optional.length) {
    fill('optional', optional)
    $('optional-block').hidden = false
  }

  // Steps were captured as one block of text, usually numbered "1. …" per
  // line. Split on lines and drop the numbers the <ol> supplies itself.
  const steps = str(recipe.instructions)
    .split(/\n+/)
    .map((s) => s.replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter(Boolean)
  if (steps.length) {
    const ol = $('steps')
    for (const s of steps) {
      const li = document.createElement('li')
      li.textContent = s
      ol.append(li)
    }
    $('steps-block').hidden = false
  }

  const tips = Array.isArray(recipe.tips) ? recipe.tips.map(str).filter(Boolean) : []
  if (tips.length) {
    fill('tips', tips.map((t) => ({ n: t })))
    $('tips-block').hidden = false
  }

  // Into the app's own import flow. Signed-out people get the sign-in page,
  // which is the right answer for them anyway.
  $('import').href = '/#i=' + body

  const asText = () => {
    const line = (i) => '• ' + (amount(i) ? amount(i) + ' ' : '') + str(i.n)
    const out = [title]
    if (recipe.servings) out.push('Serves ' + kitchen(Number(recipe.servings)))
    out.push('', 'INGREDIENTS', ...required.map(line))
    if (optional.length) out.push('', 'OPTIONAL', ...optional.map(line))
    if (steps.length) out.push('', 'STEPS', ...steps.map((s, n) => n + 1 + '. ' + s))
    if (tips.length) out.push('', 'TIPS', ...tips.map((t) => '• ' + t))
    return out.join('\n')
  }
  $('copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(asText())
      $('status').textContent = 'Copied.'
    } catch {
      $('status').textContent = 'Could not copy. Select the text instead.'
    }
  })

  $('recipe').hidden = false
})()
