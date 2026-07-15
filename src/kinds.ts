import type { List, ListKind } from './db'

/**
 * A list's kind decides which of Mise's smarts wake up. Everything is off by
 * default and switched on deliberately — that's what keeps grocery sharp
 * instead of Mise drifting into a generic list app.
 */
export interface KindMeta {
  kind: ListKind
  label: string
  /** Icon key (Icon.tsx) — the kind's default when a list has no custom icon. */
  icon: string
  /** Group rows by store section (aisle walk order). */
  sections: boolean
  /** Quantity + unit fields on items. */
  quantities: boolean
  /** Remembered prices + the subtotal estimate. */
  prices: boolean
  /** Skip staples when adding from a recipe or capture. */
  staples: boolean
  /** Can receive a recipe's ingredients, and can be AI-captured into. */
  recipes: boolean
  /** Due dates + notes on items. */
  due: boolean
  /** Has a "parked for later" second view. */
  backlog: boolean
  backlogLabel: string
  /** What checking a row means, in this kind's language. */
  checkVerb: string
  primaryLabel: string
  emptyIcon: string
  emptyText: string
  emptyHint: string
}

export const KINDS: Record<ListKind, KindMeta> = {
  grocery: {
    kind: 'grocery',
    label: 'Grocery',
    icon: 'cart',
    sections: true,
    quantities: true,
    prices: true,
    staples: true,
    recipes: true,
    due: false,
    backlog: true,
    backlogLabel: 'Next time',
    checkVerb: 'Check off',
    primaryLabel: 'list',
    emptyIcon: 'basket',
    emptyText: 'Nothing on this list yet.',
    emptyHint: 'Tap ＋ to snap, paste, or type what you need.',
  },
  tasks: {
    kind: 'tasks',
    label: 'Tasks',
    icon: 'tasks',
    sections: false,
    quantities: false,
    prices: false,
    staples: false,
    recipes: false,
    due: true,
    backlog: true,
    backlogLabel: 'Someday',
    checkVerb: 'Mark done',
    primaryLabel: 'tasks',
    emptyIcon: 'tasks',
    emptyText: 'Nothing to do.',
    emptyHint: 'Tap ＋ to add a task. A due date is optional.',
  },
  pantry: {
    kind: 'pantry',
    label: 'Pantry',
    icon: 'pantry',
    sections: true,
    quantities: true,
    prices: false,
    staples: false,
    recipes: false,
    due: false,
    backlog: false,
    backlogLabel: '',
    checkVerb: 'Mark as out',
    primaryLabel: 'pantry',
    emptyIcon: 'pantry',
    emptyText: 'Your pantry is empty.',
    emptyHint: 'Add what you keep on hand. Mark things out to restock them.',
  },
}

export const KIND_LIST: KindMeta[] = [KINDS.grocery, KINDS.tasks, KINDS.pantry]

/** The icon a list shows — its own override, or its kind's default. */
export function listIcon(list: Pick<List, 'kind' | 'icon'>): string {
  return list.icon || KINDS[list.kind].icon
}
