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

  /**
   * A checklist you reset instead of delete — travel, gym bag, the nappy bag.
   * The point is that it survives being finished: everything unticks and it is
   * ready for next time. No aisles, no prices, no parsing; that machinery is
   * about buying things, and this is about not forgetting them.
   */
  packing: {
    kind: 'packing',
    label: 'Packing',
    icon: 'basket',
    sections: false,
    quantities: true,
    prices: false,
    staples: false,
    recipes: false,
    due: false,
    backlog: false,
    backlogLabel: '',
    checkVerb: 'Pack',
    primaryLabel: 'list',
    emptyIcon: 'basket',
    emptyText: 'Nothing packed yet.',
    emptyHint: 'Add what you always take. Untick it all when you get home.',
  },

  /**
   * Things to buy eventually. Keeps prices and refine, because deciding what to
   * buy is exactly what those are for — but no aisles and no backlog, because
   * it is not a trip. It is the list you move things OFF, onto a real one.
   */
  wishlist: {
    kind: 'wishlist',
    label: 'Wishlist',
    icon: 'star',
    sections: false,
    quantities: true,
    prices: true,
    staples: false,
    recipes: false,
    due: false,
    backlog: false,
    backlogLabel: '',
    checkVerb: 'Mark as bought',
    primaryLabel: 'list',
    emptyIcon: 'star',
    emptyText: 'Nothing on the wishlist.',
    emptyHint: 'Things to buy one day. Prices are remembered, nothing is urgent.',
  },
}

/** The order the kind picker offers them in: the two people reach for most,
 *  then the rest. */
export const KIND_LIST: KindMeta[] = [
  KINDS.grocery,
  KINDS.tasks,
  KINDS.pantry,
  KINDS.packing,
  KINDS.wishlist,
]

/** The icon a list shows — its own override, or its kind's default. */
export function listIcon(list: Pick<List, 'kind' | 'icon'>): string {
  return list.icon || KINDS[list.kind].icon
}
