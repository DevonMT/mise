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
  /**
   * Items carry a recurrence and are grouped by WHEN they happen rather than by
   * aisle. That is what distinguishes a plan from a list: the same entries come
   * back every week instead of being consumed.
   */
  schedule: boolean
  /** A scheduled entry can stand for a saved recipe, so its ingredients can be
   *  sent to a shopping list in one action. */
  fromRecipes: boolean
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
    schedule: false,
    fromRecipes: false,
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
    schedule: false,
    fromRecipes: false,
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
    schedule: false,
    fromRecipes: false,
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
    schedule: false,
    fromRecipes: false,
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
    schedule: false,
    fromRecipes: false,
  },

  /**
   * The week's meals. Entries are placed on days and stay put — a plan is not
   * consumed by being looked at — and an entry standing for a saved recipe can
   * send its ingredients to a shopping list.
   *
   * The one kind that closes Mise's loop: it already parses recipes and already
   * builds shopping lists, and this is the bit in between that was being done
   * in somebody's head.
   */
  mealplan: {
    kind: 'mealplan',
    label: 'Meal plan',
    icon: 'calendar',
    sections: false,
    quantities: false,
    prices: false,
    staples: false,
    recipes: false,
    due: false,
    backlog: false,
    backlogLabel: '',
    schedule: true,
    fromRecipes: true,
    checkVerb: 'Mark as cooked',
    primaryLabel: 'plan',
    emptyIcon: 'calendar',
    emptyText: 'Nothing planned yet.',
    emptyHint: 'Put meals on days, then send the ingredients to a shopping list.',
  },

  /**
   * Anything done on a cadence: training, chores, watering things. Entries
   * recur rather than being ticked off for good, and support "every other day"
   * as well as fixed weekdays — see Schedule for why those are two shapes.
   */
  routine: {
    kind: 'routine',
    label: 'Routine',
    icon: 'tasks',
    sections: false,
    quantities: false,
    prices: false,
    staples: false,
    recipes: false,
    due: false,
    backlog: false,
    backlogLabel: '',
    schedule: true,
    fromRecipes: false,
    checkVerb: 'Mark as done',
    primaryLabel: 'routine',
    emptyIcon: 'tasks',
    emptyText: 'No routine yet.',
    emptyHint: 'What you do, and how often. Push day on Mondays; a walk every other day.',
  },
}

/** The order the kind picker offers them in: the two people reach for most,
 *  then the rest. */
export const KIND_LIST: KindMeta[] = [
  KINDS.grocery,
  KINDS.tasks,
  KINDS.pantry,
  KINDS.mealplan,
  KINDS.routine,
  KINDS.packing,
  KINDS.wishlist,
]

/** The icon a list shows — its own override, or its kind's default. */
export function listIcon(list: Pick<List, 'kind' | 'icon'>): string {
  return list.icon || KINDS[list.kind].icon
}
