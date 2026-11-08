import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Recipe } from './db'
import { SECTIONS } from './sections'
import { Sheet } from './Sheet'
import { Icon } from './Icon'
import { useBackLayer } from './back'
import { acceptCards, loadNameSources, nameCards, type NameCard, type NameSource } from './matchNames'

/**
 * Match My Names (#812), recipe detail: a row under the ingredients that shows
 * only when some line could take one of Devon's own names, and the sheet of
 * approval cards it opens. The logic is in matchNames.ts; this is the screen.
 *
 * Cards come from the live recipe, so a renamed line drops out by itself.
 * Skip is for this sheet only: nothing is stored, and the card is back the
 * next time it opens.
 */
const EMPTY: NameSource[] = []
const cardId = (c: NameCard) => `${c.index}:${c.was}`
const aisle = (key: string) => SECTIONS.find((s) => s.key === key)?.label ?? key
const lines = (n: number) => `${n} ${n === 1 ? 'line' : 'lines'}`

export function MatchNames({ recipe, onToast }: { recipe: Recipe; onToast: (msg: string) => void }) {
  const sources = useLiveQuery(loadNameSources, [], EMPTY)
  const cards = useMemo(() => nameCards(recipe.ingredients, sources), [recipe.ingredients, sources])
  const [open, setOpen] = useState(false)
  useBackLayer(open, () => setOpen(false))

  if (!open && cards.length === 0) return null
  return (
    <>
      {cards.length > 0 && (
        <div className="std-row">
          <p className="std-note">
            {lines(cards.length)} can use a name from your pantry or favorites.
          </p>
          <button className="ghost std-btn" onClick={() => setOpen(true)}>
            Match My Names
          </button>
        </div>
      )}
      {open && recipe.id != null && (
        <MatchNamesSheet
          recipe={recipe}
          cards={cards}
          onClose={() => setOpen(false)}
          onToast={onToast}
        />
      )}
    </>
  )
}

function MatchNamesSheet({
  recipe,
  cards,
  onClose,
  onToast,
}: {
  recipe: Recipe
  cards: NameCard[]
  onClose: () => void
  onToast: (msg: string) => void
}) {
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const renamedCount = useRef(0)
  const shown = cards.filter((c) => !skipped.has(cardId(c)))

  // The parent passes fresh closures each render; the close effect reads them
  // through refs so it runs once, when the last card goes.
  const closeRef = useRef(onClose)
  const toastRef = useRef(onToast)
  useEffect(() => {
    closeRef.current = onClose
    toastRef.current = onToast
  })

  const accept = async (picked: NameCard[]) => {
    setBusy(true)
    try {
      const n = await acceptCards(recipe.id!, picked)
      renamedCount.current += n
      // A line edited since the sheet opened is not renamed: its card goes too.
      if (n < picked.length) {
        setSkipped((s) => {
          const next = new Set(s)
          for (const c of picked) next.add(cardId(c))
          return next
        })
        toastRef.current('A recipe line changed since this opened, so it kept its name. Open Match My Names again to check it.')
      }
    } finally {
      setBusy(false)
    }
  }

  // Every card renamed or skipped: close and say what changed. Not while a
  // save is running, so the count includes it.
  const done = shown.length === 0 && !busy
  useEffect(() => {
    if (!done) return
    const n = renamedCount.current
    if (n) toastRef.current(`Renamed ${lines(n)}.`)
    closeRef.current()
  }, [done])

  return (
    <Sheet className="match-names" label="Match My Names" onClose={onClose}>
      <h3 className="sheet-title">
        <Icon name="pantry" size={20} /> Match My Names
      </h3>
      <p className="mn-sub">Rename recipe lines to what you already keep. Amounts stay the same.</p>
      <ul className="mn-cards">
        {shown.map((c) => {
          const moves = recipe.ingredients[c.index]?.section !== c.to.section
          return (
            <li key={cardId(c)} className="mn-card">
              <p className="mn-was">
                <span className="mn-label">Recipe says</span> {c.was}
              </p>
              <p className="mn-to">
                <Icon name="chevronRight" size={16} /> {c.to.displayName}
              </p>
              <div className="rev-meta">
                <span className="rev-tag">{c.to.from === 'pantry' ? 'In Pantry' : 'Favorite'}</span>
                {c.how === 'close' && <span className="rev-tag">Close Match</span>}
                {moves && <span className="rev-tag">Moves to {aisle(c.to.section)}</span>}
              </div>
              <div className="mn-actions">
                <button className="ghost" disabled={busy} onClick={() => setSkipped((s) => new Set(s).add(cardId(c)))}>
                  Skip
                </button>
                <button className="ghost mn-yes" disabled={busy} onClick={() => void accept([c])}>
                  <Icon name="check" size={18} /> Rename
                </button>
              </div>
            </li>
          )
        })}
      </ul>
      {shown.length > 1 && (
        <button className="primary" disabled={busy} onClick={() => void accept(shown)}>
          Rename All {shown.length}
        </button>
      )}
    </Sheet>
  )
}
