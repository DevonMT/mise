import type { Section } from './db'

interface SectionMeta {
  key: Section
  label: string
  emoji: string
}

/** Ordered the way you'd walk a store: perimeter first, then center aisles,
 *  then non-food. Adding/reordering here reorders the on-list grouping and the
 *  manual-add chip picker; keep it in sync with the Section union in db.ts. */
export const SECTIONS: SectionMeta[] = [
  { key: 'produce', label: 'Produce', emoji: '🥬' },
  { key: 'bakery', label: 'Bakery', emoji: '🍞' },
  { key: 'deli', label: 'Deli', emoji: '🧀' },
  { key: 'meat', label: 'Meat & Seafood', emoji: '🥩' },
  { key: 'dairy', label: 'Dairy & Eggs', emoji: '🥛' },
  { key: 'frozen', label: 'Frozen', emoji: '🧊' },
  { key: 'pantry', label: 'Pantry', emoji: '🥫' },
  { key: 'baking', label: 'Baking', emoji: '🧁' },
  { key: 'condiments', label: 'Condiments & Sauces', emoji: '🫙' },
  { key: 'snacks', label: 'Snacks', emoji: '🍿' },
  { key: 'beverages', label: 'Beverages', emoji: '🥤' },
  { key: 'household', label: 'Household', emoji: '🧻' },
  { key: 'personal', label: 'Personal Care', emoji: '🧴' },
  { key: 'other', label: 'Other', emoji: '🛒' },
]

export const SECTION_ORDER: Record<Section, number> = Object.fromEntries(
  SECTIONS.map((s, i) => [s.key, i]),
) as Record<Section, number>

export const SECTION_META: Record<Section, SectionMeta> = Object.fromEntries(
  SECTIONS.map((s) => [s.key, s]),
) as Record<Section, SectionMeta>
