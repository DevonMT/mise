import { useState } from 'react'
import { canonicalize, db, type Recipe, type RecipeIngredient, type Section } from './db'
import { SECTIONS } from './sections'
import { Icon } from './Icon'
import { useDialog } from './ds/useDialog'
import { useBackLayer } from './back'

/**
 * Edit a saved recipe in place.
 *
 * Structured, one row per ingredient, not a textarea. An ingredient is more
 * than its line of text — it carries an aisle, a merge key, whether it is
 * optional, and sometimes the pack to buy — and round-tripping it through
 * "2 cup flour" would throw all of that away. Before this there was no edit at
 * all: a bad parse meant capturing the whole recipe again.
 *
 * A full-screen view rather than a sheet, for the same reason Refine is one: a
 * tall bottom sheet in the installed app left its lower controls untappable.
 */
type Row = RecipeIngredient & { key: number; qtyText: string; origName: string }

let nextKey = 1
const toRow = (i: RecipeIngredient): Row => ({
  ...i,
  key: nextKey++,
  qtyText: i.quantity != null ? String(i.quantity) : '',
  origName: i.displayName,
})

/** A row back into an ingredient. Exported for the tests.
 *
 * The merge key follows the name only when the name changed: renaming
 * "3 pepper blend cheese" to "Monterey Jack" makes it a different grocery, but
 * an untouched row keeps the key it had, which is often broader than its name
 * ("chicken breast" for "boneless skinless chicken breasts") and is what lets
 * two recipes' chicken merge on one line. */
export function fromRow(r: Row): RecipeIngredient | null {
  const { key: _k, qtyText, origName, ...rest } = r
  const name = rest.displayName.trim()
  if (!name) return null
  const q = qtyText.trim() === '' ? undefined : Number(qtyText.trim().replace(',', '.'))
  return {
    ...rest,
    displayName: name,
    canonicalKey: name === origName.trim() && rest.canonicalKey ? rest.canonicalKey : canonicalize(name),
    quantity: q != null && Number.isFinite(q) && q > 0 ? q : undefined,
    unit: rest.unit?.trim() || undefined,
    optional: rest.optional || undefined,
  }
}

export type { Row as EditorRow }
export { toRow }

export function RecipeEditor({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  const dialogRef = useDialog(onClose)
  useBackLayer(true, onClose)
  const [title, setTitle] = useState(recipe.title)
  const [servings, setServings] = useState(recipe.servings ? String(recipe.servings) : '')
  const [rows, setRows] = useState<Row[]>(() => recipe.ingredients.map(toRow))
  const [instructions, setInstructions] = useState(recipe.instructions ?? '')
  const [tips, setTips] = useState((recipe.tips ?? []).join('\n'))
  const [saving, setSaving] = useState(false)

  const patch = (key: number, p: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)))

  const addRow = (optional: boolean) =>
    setRows((rs) => [
      ...rs,
      toRow({ displayName: '', canonicalKey: '', section: 'other' as Section, optional: optional || undefined }),
    ])

  const canSave = title.trim().length > 0 && rows.some((r) => r.displayName.trim())

  const save = async () => {
    if (!canSave || recipe.id == null) return
    setSaving(true)
    const ingredients = rows.map(fromRow).filter((i): i is RecipeIngredient => i !== null)
    await db.recipes.update(recipe.id, {
      title: title.trim(),
      servings: servings.trim() ? Number(servings) || 0 : 0,
      ingredients,
      instructions: instructions.trim() || undefined,
      tips: tips.split('\n').map((t) => t.trim()).filter(Boolean),
    })
    onClose()
  }

  const required = rows.filter((r) => !r.optional)
  const optional = rows.filter((r) => r.optional)

  const rowEditor = (r: Row) => (
    <div key={r.key} className="ed-row">
      <input
        className="field ed-qty"
        inputMode="decimal"
        placeholder="qty"
        aria-label="Amount"
        value={r.qtyText}
        onChange={(e) => patch(r.key, { qtyText: e.target.value })}
      />
      <input
        className="field ed-unit"
        placeholder="unit"
        aria-label="Unit"
        value={r.unit ?? ''}
        onChange={(e) => patch(r.key, { unit: e.target.value })}
      />
      <input
        className="field ed-name"
        placeholder="ingredient"
        aria-label="Ingredient"
        value={r.displayName}
        onChange={(e) => patch(r.key, { displayName: e.target.value })}
      />
      <select
        className="field ed-section"
        aria-label="Aisle"
        value={r.section}
        onChange={(e) => patch(r.key, { section: e.target.value as Section })}
      >
        {SECTIONS.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
      <button
        className={r.optional ? 'ed-opt on' : 'ed-opt'}
        onClick={() => patch(r.key, { optional: !r.optional || undefined })}
        aria-pressed={!!r.optional}
        title={r.optional ? 'Optional — move to main ingredients' : 'Main — make optional'}
      >
        {r.optional ? 'optional' : 'main'}
      </button>
      <button
        className="ed-del"
        onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
        aria-label={`Remove ${r.displayName || 'ingredient'}`}
      >
        <Icon name="x" size={16} />
      </button>
    </div>
  )

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="editor-title"
      tabIndex={-1}
      className="fullview recipe-editor"
    >
      <div className="fullview-head">
        <button className="icon-back" onClick={onClose} aria-label="Cancel editing">
          <Icon name="back" size={22} />
        </button>
        <h2 className="detail-title" id="editor-title">
          Edit recipe
        </h2>
      </div>

      <div className="fullview-body">
        <label className="form-label">Name</label>
        <input className="field name-field" value={title} onChange={(e) => setTitle(e.target.value)} />
        <label className="form-label">Servings</label>
        <input
          className="field"
          inputMode="numeric"
          placeholder="optional"
          value={servings}
          onChange={(e) => setServings(e.target.value)}
        />

        <label className="form-label">Ingredients</label>
        {required.map(rowEditor)}
        <button className="ghost ed-add" onClick={() => addRow(false)}>
          <Icon name="plus" size={16} /> Add ingredient
        </button>

        <label className="form-label">Optional — by taste</label>
        {optional.map(rowEditor)}
        <button className="ghost ed-add" onClick={() => addRow(true)}>
          <Icon name="plus" size={16} /> Add optional
        </button>

        <label className="form-label">Steps — one per line</label>
        <textarea
          className="field textarea ed-steps"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
        <label className="form-label">Tips — one per line</label>
        <textarea className="field textarea" value={tips} onChange={(e) => setTips(e.target.value)} />
      </div>

      <div className="fullview-foot">
        <button className="primary" onClick={save} disabled={!canSave || saving}>
          Save changes
        </button>
      </div>
    </div>
  )
}
