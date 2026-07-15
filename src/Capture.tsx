import { useRef, useState } from 'react'
import type { ListKind, Section } from './db'
import { KINDS } from './kinds'
import { SECTIONS, SECTION_META } from './sections'
import { addItem } from './list'
import {
  parseCapture,
  getStapleKeys,
  fileToDataUrl,
  type ParsedItem,
  type ParseResult,
} from './parse'
import { saveRecipeFromParse } from './recipes'
import { defaultGroceryListId } from './lists'
import { Sheet } from './Sheet'
import { AI_ENABLED } from './edition'

type Stage = 'input' | 'loading' | 'review' | 'error'
export type CaptureMode = 'text' | 'url' | 'image'

interface Row {
  displayName: string
  canonicalKey: string
  quantityStr: string
  unit: string | null
  section: Section
  include: boolean
  isStaple: boolean
  optional: boolean
}

export function CaptureSheet({
  listId,
  mode,
  forRecipe = false,
  onClose,
}: {
  listId: number
  mode: CaptureMode
  /** Opened from the Recipes tab: the library is the goal, so lead with
   *  "Save recipe" and send any list items to a grocery list, not `listId`. */
  forRecipe?: boolean
  onClose: () => void
}) {
  const [stage, setStage] = useState<Stage>('input')
  const [content, setContent] = useState('') // text, url, or image data-URL
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const dataUrl = await fileToDataUrl(file)
    setContent(dataUrl)
    setPreview(dataUrl)
  }

  const run = async () => {
    if (!content.trim()) return
    setStage('loading')
    setError('')
    try {
      const [result, staples] = await Promise.all([
        parseCapture({ type: mode, content }),
        getStapleKeys(),
      ])
      const built: Row[] = result.items.map((it: ParsedItem) => {
        const isStaple = staples.has(it.canonicalKey)
        const optional = Boolean(it.optional)
        return {
          displayName: it.displayName,
          canonicalKey: it.canonicalKey,
          quantityStr: it.quantity != null ? String(it.quantity) : '',
          unit: it.unit,
          section: it.section,
          // Staples and recipe-optional items are pre-skipped but toggleable.
          include: !isStaple && !optional,
          isStaple,
          optional,
        }
      })
      setParsed(result)
      setRows(built)
      setStage(built.length ? 'review' : 'error')
      if (!built.length) setError('No grocery items found in that.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStage('error')
    }
  }

  const commit = async () => {
    // Recipe ingredients belong on a grocery list — when captured from the
    // Recipes tab the active list could be a pantry or task list.
    const target = forRecipe ? ((await defaultGroceryListId(listId)) ?? listId) : listId
    for (const r of rows) {
      if (!r.include) continue
      const qty = r.quantityStr.trim() ? Number(r.quantityStr) : undefined
      await addItem({
        listId: target,
        displayName: r.displayName,
        canonicalKey: r.canonicalKey,
        quantity: Number.isFinite(qty as number) ? qty : undefined,
        unit: r.unit ?? undefined,
        section: r.section,
      })
    }
    if (parsed) await saveRecipeFromParse(parsed)
    onClose()
  }

  const saveRecipeOnly = async () => {
    if (parsed) await saveRecipeFromParse(parsed)
    onClose()
  }

  const isRecipe = parsed?.sourceType === 'recipe'
  const includedCount = rows.filter((r) => r.include).length
  const patch = (i: number, next: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...next } : r)))

  const heading =
    mode === 'url'
      ? '🔗 Paste a recipe link'
      : mode === 'image'
        ? forRecipe
          ? '📷 Snap a recipe'
          : '📷 Snap a list or recipe'
        : forRecipe
          ? '📋 Paste a recipe'
          : '📋 Paste or type a list'

  return (
    <Sheet className="capture" onClose={onClose}>
        {(stage === 'input' || stage === 'error') && (
          <>
            <h3 className="sheet-title">{heading}</h3>

            {mode === 'url' && (
              <input
                className="field"
                placeholder="https://…"
                inputMode="url"
                autoFocus
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && run()}
              />
            )}

            {mode === 'text' && (
              <textarea
                className="field textarea"
                placeholder={'e.g.\n2 onions\nmilk\nchicken breast\n…or a whole recipe'}
                autoFocus
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            )}

            {mode === 'image' && (
              <div className="photo-pick">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  hidden
                  onChange={onPickFile}
                />
                {preview ? (
                  <img className="photo-preview" src={preview} alt="preview" />
                ) : (
                  <div className="photo-empty">No photo yet</div>
                )}
                <button className="ghost" onClick={() => fileRef.current?.click()}>
                  {preview ? '🔁 Retake / choose another' : '📷 Take or choose a photo'}
                </button>
              </div>
            )}

            {stage === 'error' && <p className="err-text">{error}</p>}
            <button className="primary" onClick={run} disabled={!content.trim()}>
              Parse it ✨
            </button>
          </>
        )}

        {stage === 'loading' && (
          <div className="loading">
            <div className="spinner" />
            <p>{mode === 'image' ? 'Reading your photo…' : 'Reading your list…'}</p>
          </div>
        )}

        {stage === 'review' && (
          <>
            <h3 className="sheet-title">
              {isRecipe && parsed?.recipeTitle ? `“${parsed.recipeTitle}”` : 'Review items'}
            </h3>
            <p className="review-hint">
              {includedCount} of {rows.length} will be added. Tap to toggle; staples and optional
              extras are pre-skipped.
              {isRecipe && ' · 📖 saved to your recipes'}
              {isRecipe && parsed?.tips && parsed.tips.length > 0 && (
                <> · 💡 {parsed.tips.length} tip{parsed.tips.length === 1 ? '' : 's'} saved</>
              )}
            </p>
            <div className="review-list">
              {rows.map((r, i) => (
                <div key={i} className={r.include ? 'rev-row on' : 'rev-row'}>
                  <button
                    className="rev-check"
                    aria-label="toggle"
                    onClick={() => patch(i, { include: !r.include })}
                  >
                    {r.include ? '✓' : ''}
                  </button>
                  <div className="rev-body">
                    <div className="rev-top">
                      <span className="rev-name">{r.displayName}</span>
                      {r.isStaple && <span className="rev-tag">staple</span>}
                      {r.optional && <span className="rev-tag optional">optional</span>}
                    </div>
                    <div className="rev-meta">
                      <input
                        className="rev-qty"
                        placeholder="qty"
                        inputMode="decimal"
                        value={r.quantityStr}
                        onChange={(e) => patch(i, { quantityStr: e.target.value })}
                      />
                      <input
                        className="rev-unit"
                        placeholder="unit"
                        value={r.unit ?? ''}
                        onChange={(e) => patch(i, { unit: e.target.value || null })}
                      />
                      <select
                        className="rev-sec"
                        value={r.section}
                        onChange={(e) => patch(i, { section: e.target.value as Section })}
                      >
                        {SECTIONS.map((s) => (
                          <option key={s.key} value={s.key}>
                            {SECTION_META[s.key].emoji} {s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {forRecipe && isRecipe ? (
              <>
                <button className="primary" onClick={saveRecipeOnly}>
                  📖 Save recipe
                </button>
                {includedCount > 0 && (
                  <button className="ghost" onClick={commit} style={{ marginTop: 10 }}>
                    Save &amp; add {includedCount} to your list
                  </button>
                )}
              </>
            ) : (
              <>
                <button className="primary" onClick={commit} disabled={!includedCount && !isRecipe}>
                  {includedCount ? `Add ${includedCount} to list` : 'Done'}
                </button>
                {isRecipe && includedCount > 0 && (
                  <button className="ghost" onClick={saveRecipeOnly} style={{ marginTop: 10 }}>
                    📖 Save to recipes only (don’t add to list)
                  </button>
                )}
              </>
            )}
          </>
        )}
    </Sheet>
  )
}

/** Small chooser shown when tapping the + FAB. What it offers depends on the
 *  kind of list you're on — a task list has no use for recipe parsing. */
export function AddMenu({
  kind,
  onPick,
  onClose,
}: {
  kind: ListKind
  onPick: (mode: 'one' | 'quick' | CaptureMode) => void
  onClose: () => void
}) {
  const meta = KINDS[kind]
  return (
    <Sheet className="menu" onClose={onClose}>
      {meta.kind !== 'tasks' && (
        <button className="menu-item" onClick={() => onPick('quick')}>
          ⭐ Quick add (favorites)
        </button>
      )}
      <button className="menu-item" onClick={() => onPick('one')}>
        ✏️ {meta.due ? 'Type a task' : 'Type one item'}
      </button>
      {AI_ENABLED && meta.recipes && (
        <>
          <button className="menu-item" onClick={() => onPick('image')}>
            📷 Snap a photo
          </button>
          <button className="menu-item" onClick={() => onPick('text')}>
            📋 Paste a list or recipe
          </button>
          <button className="menu-item" onClick={() => onPick('url')}>
            🔗 From a recipe link
          </button>
        </>
      )}
    </Sheet>
  )
}

/** Ways to add a recipe from the Recipes tab. Only shown when AI capture is on;
 *  in Lite there's just the manual form, opened directly. */
export function AddRecipeMenu({
  onPick,
  onClose,
}: {
  onPick: (mode: 'manual' | CaptureMode) => void
  onClose: () => void
}) {
  return (
    <Sheet className="menu" onClose={onClose}>
      <button className="menu-item" onClick={() => onPick('image')}>
        📷 Snap a recipe
      </button>
      <button className="menu-item" onClick={() => onPick('text')}>
        📋 Paste a recipe
      </button>
      <button className="menu-item" onClick={() => onPick('url')}>
        🔗 From a recipe link
      </button>
      <button className="menu-item" onClick={() => onPick('manual')}>
        ✏️ Enter it manually
      </button>
    </Sheet>
  )
}
