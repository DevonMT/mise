import { useEffect, useMemo, useState } from 'react'
import { db, type Recipe, type RecipeIngredient, type Section } from './db'
import { addItem, formatBuy, type NewItem } from './list'
import { getInStockKeys } from './lists'
import { getStapleKeys, isStaple, refineItems, type RefineOption } from './parse'
import { buyLine, buyQuantity, recipeAmount, soupCanToggle } from './buy'
import { recipeListLine } from './recipes'
import type { PackSize } from './packSizes'
import { readSetting } from './prefs'
import { useAiEnabled } from './edition'
import { Icon } from './Icon'
import { Sheet } from './Sheet'

/**
 * The step between a recipe and a list (#811). Each line shows what the recipe
 * says and what to buy for it, worked out by buy.ts (least left over, the top
 * of a range). The size chips change the pick; an unclear can is asked about;
 * a product the table doesn't know can be refined by the model, one line at a
 * time or all at once with Refine and Add. Nothing is written until Add.
 */

type Pack = Pick<NewItem, 'buyCount' | 'sizeAmount' | 'sizeUnit' | 'packaging'>

interface Row {
  /** Index into recipe.ingredients. */
  i: number
  /** The line as the review sees it: the recipe's, or rewritten by a can answer. */
  ing: RecipeIngredient
  include: boolean
  inPantry: boolean
  /** A size chip the person tapped. */
  chosen?: PackSize
  /** The Soup Can chip changed the line, so the recipe is saved with it on Add. */
  answered?: boolean
  /** Options the model gave, and the one picked. */
  options?: RefineOption[]
  picked?: RefineOption
  refining?: boolean
}

const fromOption = (o: RefineOption): Pack => ({
  buyCount: o.count > 0 ? o.count : 1,
  sizeAmount: o.sizeAmount ?? undefined,
  sizeUnit: o.sizeUnit ?? undefined,
  packaging: o.packaging ?? undefined,
})

const sameSize = (a: PackSize | undefined, p: Pack | null) =>
  !!a && !!p && a.size === p.sizeAmount && a.unit === p.sizeUnit && a.packaging === p.packaging

export function AddRecipeSheet({
  recipe,
  factor,
  includeOptional,
  listId,
  listName,
  onClose,
  onDone,
}: {
  recipe: Recipe
  factor: number
  includeOptional: Set<number>
  listId: number
  listName: string
  onClose: () => void
  onDone: (msg: string) => void
}) {
  const ai = useAiEnabled()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // Always-on-hand pantry items are left off silently, as before; an ordinary
  // in-stock pantry item shows, unchecked, so it can be added anyway.
  useEffect(() => {
    let live = true
    void Promise.all([getStapleKeys(), getInStockKeys()]).then(([staples, stocked]) => {
      if (!live) return
      const out: Row[] = []
      recipe.ingredients.forEach((ing, i) => {
        if (isStaple(staples, ing)) return
        if (ing.optional && !includeOptional.has(i)) return
        const inPantry = isStaple(stocked, ing)
        out.push({ i, ing, include: !inPantry, inPantry })
      })
      setRows(out)
    })
    return () => {
      live = false
    }
  }, [recipe, includeOptional])

  const patch = (i: number, p: Partial<Row>) =>
    setRows((rs) => rs && rs.map((r) => (r.i === i ? { ...r, ...p } : r)))

  /** What each row will put on the list right now. */
  const plans = useMemo(
    () =>
      (rows ?? []).map((r) => {
        const b = buyLine(r.ing, factor, r.chosen)
        const pack: Pack | null = r.picked ? fromOption(r.picked) : b.plan
        return { b, pack }
      }),
    [rows, factor],
  )

  const included = (rows ?? []).filter((r) => r.include)
  const open = (rows ?? []).filter((r, k) => r.include && !r.picked && plans[k].b.open === 'refine')

  const store = (readSetting('mise.store') ?? '').trim()
  const area = (readSetting('mise.area') ?? '').trim()

  /** Ask the model about these rows; returns the first option for each, by recipe index. */
  const refine = async (targets: Row[]): Promise<Map<number, RefineOption[]>> => {
    const items = targets.map((r) => ({
      canonicalKey: r.ing.canonicalKey,
      displayName: r.ing.displayName,
      unit: r.ing.unit,
      quantity: buyQuantity(r.ing, factor) ?? undefined,
    }))
    const res = await refineItems(store, items, area)
    const byKey = new Map(res.map((x) => [x.canonicalKey, x.options]))
    const out = new Map<number, RefineOption[]>()
    for (const r of targets) {
      const opts = byKey.get(r.ing.canonicalKey)
      if (opts?.length) out.set(r.i, opts)
    }
    return out
  }

  const refineOne = async (r: Row) => {
    patch(r.i, { refining: true })
    setErr('')
    try {
      const got = (await refine([r])).get(r.i)
      patch(r.i, { refining: false, options: got, picked: got?.[0] })
      if (!got) setErr(`No options came back for ${r.ing.displayName}.`)
    } catch (e) {
      patch(r.i, { refining: false })
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const commit = async (refined?: Map<number, RefineOption[]>) => {
    if (!rows) return
    let n = 0
    for (let k = 0; k < rows.length; k++) {
      const r = rows[k]
      if (!r.include) continue
      const picked = r.picked ?? refined?.get(r.i)?.[0]
      const pack = picked ? fromOption(picked) : plans[k].pack
      const extra = picked ? { detail: picked.label, section: picked.section as Section } : undefined
      await addItem(recipeListLine(r.ing, factor, listId, pack, extra))
      n++
    }
    // A Soup Can answer is the recipe's too: save it so it is set next time.
    const answers = rows.filter((r) => r.answered)
    if (answers.length && recipe.id != null) {
      const ingredients = recipe.ingredients.map((ing, i) => answers.find((a) => a.i === i)?.ing ?? ing)
      await db.recipes.update(recipe.id, { ingredients })
    }
    onDone(`Added ${n} to ${listName}`)
  }

  const add = async () => {
    setBusy(true)
    try {
      await commit()
    } finally {
      setBusy(false)
    }
  }

  const refineAndAdd = async () => {
    setBusy(true)
    setErr('')
    try {
      const got = await refine(open)
      await commit(got)
    } catch (e) {
      setErr(`${e instanceof Error ? e.message : String(e)} Nothing was added.`)
      setBusy(false)
    }
  }

  return (
    <Sheet className="add-recipe" label="Add to list" onClose={onClose}>
      <h3 className="sheet-title">Add to {listName}</h3>
      <p className="review-hint">
        {included.length} of {rows?.length ?? 0} will be added. Sizes are picked for the least left over.
      </p>
      <div className="review-list">
        {(rows ?? []).map((r, k) => {
          const { b, pack } = plans[k]
          const recipeSays = recipeAmount(r.ing, factor)
          const soup = soupCanToggle(r.ing)
          return (
            <div key={r.i} className={r.include ? 'rev-row on' : 'rev-row'}>
              <button
                className="rev-check"
                aria-label={r.include ? `Leave out ${r.ing.displayName}` : `Include ${r.ing.displayName}`}
                onClick={() => patch(r.i, { include: !r.include })}
              >
                {r.include && <Icon name="check" size={15} strokeWidth={3} />}
              </button>
              <div className="rev-body">
                <div className="rev-top">
                  <span className="rev-name">{r.ing.displayName}</span>
                  {r.inPantry && <span className="rev-tag">in pantry</span>}
                </div>
                <div className="buy-lines">
                  {recipeSays && (
                    <span className="buy-line">
                      <span className="buy-label">Recipe</span> {recipeSays}
                    </span>
                  )}
                  <span className="buy-line">
                    <span className="buy-label">Buy</span>{' '}
                    {r.picked ? (
                      r.picked.label
                    ) : pack && formatBuy(pack) ? (
                      formatBuy(pack)
                    ) : (
                      // No pack: buy the amount itself, at the top of a range.
                      recipeAmount({ quantity: r.ing.quantityMax ?? r.ing.quantity, unit: r.ing.unit }, factor) || 'as listed'
                    )}
                  </span>
                </div>

                {!r.picked && ((b.sizes.length > 1 && pack) || soup) && (
                  <div className="buy-chips">
                    {soup && (
                      <button
                        className={soup.on ? 'chip on' : 'chip'}
                        aria-pressed={soup.on}
                        title="The recipe measures with the condensed soup's can"
                        onClick={() => patch(r.i, { ing: soup.line, answered: true, chosen: undefined })}
                      >
                        Soup Can
                      </button>
                    )}
                    {b.sizes.length > 1 && pack && b.sizes.map((s) => {
                      const on = sameSize(s, pack)
                      return (
                        <button
                          key={`${s.size}${s.unit}${s.packaging}`}
                          className={on ? 'chip on' : 'chip'}
                          aria-pressed={on}
                          onClick={() => patch(r.i, { chosen: s })}
                        >
                          {formatBuy({ sizeAmount: s.size, sizeUnit: s.unit, packaging: s.packaging })}
                        </button>
                      )
                    })}
                  </div>
                )}

                {r.options && r.options.length > 1 && (
                  <div className="buy-chips">
                    {r.options.map((o) => (
                      <button
                        key={o.label}
                        className={o === r.picked ? 'chip on' : 'chip'}
                        aria-pressed={o === r.picked}
                        onClick={() => patch(r.i, { picked: o })}
                      >
                        {o.count > 1 ? `${o.count} × ` : ''}
                        {o.label}
                      </button>
                    ))}
                  </div>
                )}

                {ai && b.open === 'refine' && !r.options && (
                  <button className="buy-refine" onClick={() => void refineOne(r)} disabled={r.refining || busy}>
                    {r.refining ? 'Refining…' : 'Refine'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {err && <p className="err-text">{err}</p>}
      <button className="primary" onClick={() => void add()} disabled={busy || !rows || !included.length}>
        {busy ? 'Adding…' : `Add ${included.length} to List`}
      </button>
      {ai && open.length > 0 && (
        <button className="ghost" style={{ marginTop: 10 }} onClick={() => void refineAndAdd()} disabled={busy}>
          Refine {open.length} and Add
        </button>
      )}
    </Sheet>
  )
}
