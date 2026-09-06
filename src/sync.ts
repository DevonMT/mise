/**
 * Cross-device sync.
 *
 * Mise has always been local-first: everything lives in this browser's
 * IndexedDB and nothing leaves it. That is still true when you are signed out —
 * this file does nothing at all until you sign in. What it adds is a shared
 * copy on the platform, so the phone in the shop and the laptop that planned
 * the meals are the same list.
 *
 * THE THREE THINGS THAT MAKE IT SAFE
 *
 * 1. Identity is a `uid`, not the local id. Dexie's `++id` is a per-device
 *    counter, so item 5 here is a different grocery from item 5 on the phone.
 *    Every row carries a uid minted where it was created, and that is what a
 *    merge keys on.
 * 2. A delete leaves a tombstone. Otherwise the next pull from a device that
 *    still has the row puts it straight back — the classic local-first bug
 *    where ticked-off groceries rise from the dead.
 * 3. Absence never deletes. A push says what this device knows, not what
 *    exists. A phone that has been offline for a week is missing everything the
 *    laptop did; if absence meant deletion its first sync would wipe the
 *    account. Deletion is only ever explicit.
 *
 * HOW THE STAMPING WORKS. Nothing in the rest of the app calls into this file.
 * `uid` and `updatedAt` are applied by Dexie table hooks, so every existing
 * write — `db.items.add`, `.update`, `.put`, `bulkPut`, a Refine pass, an
 * import — is stamped without its call site knowing sync exists. That is
 * deliberate: a scheme where each mutation has to remember to set a timestamp
 * is a scheme where one of them eventually does not, and the symptom is a row
 * that silently stops syncing.
 *
 * WHAT IS SENT. The whole local store, every time. For a grocery list that is
 * a few hundred small rows, and the server's merge is idempotent, so a re-push
 * of unchanged rows changes nothing. The alternative — tracking which rows
 * changed since the last successful sync — is where sync bugs live, and it
 * would buy nothing at this size.
 */
import Dexie from 'dexie'
import { db, newUid, type SyncKind, type Item, type List } from './db'
import { EDITION } from './edition'

/**
 * Sync is a devondoes.dev feature: it needs the platform session cookie, which
 * a page can only receive on that domain. The copy served from
 * devontroedel.com is a different registrable domain and can never sync — it
 * stays a purely local app, which is what Mise Lite is anyway.
 */
const ENDPOINT = 'https://id.devondoes.dev/api/mise'

const ENABLED_KEY = 'mise.sync.enabled'
const LAST_KEY = 'mise.sync.last'

/** How long a local tombstone is kept before it is assumed to have reached
 *  every device. Matches the server's window; keeping it longer would only
 *  grow the payload. */
const TOMBSTONE_DAYS = 90

type Kind = SyncKind
type AnyRow = Record<string, unknown> & { id?: number; uid?: string; updatedAt?: number }

/** The tables that sync, in the order a merge must apply them: a list has to
 *  exist before an item can point at it. */
const TABLES: Array<{ kind: Kind; table: Dexie.Table<AnyRow, number> }> = [
  { kind: 'list', table: db.lists as unknown as Dexie.Table<AnyRow, number> },
  { kind: 'item', table: db.items as unknown as Dexie.Table<AnyRow, number> },
  { kind: 'recipe', table: db.recipes as unknown as Dexie.Table<AnyRow, number> },
  { kind: 'staple', table: db.staples as unknown as Dexie.Table<AnyRow, number> },
  { kind: 'catalog', table: db.catalog as unknown as Dexie.Table<AnyRow, number> },
]

/**
 * True while a merge is writing rows that came FROM the server.
 *
 * Without this the hooks below would stamp incoming rows with this device's
 * clock, so every pull would look like a local edit, every device would think
 * it had the newest copy of everything, and the two would push their versions
 * back and forth forever.
 */
let applyingRemote = false

// ---------------------------------------------------------------------------
// Stamping
// ---------------------------------------------------------------------------

for (const { kind, table } of TABLES) {
  table.hook('creating', (_pk, obj) => {
    if (applyingRemote) return
    if (!obj.uid) obj.uid = newUid()
    obj.updatedAt = Date.now()
  })

  table.hook('updating', (_mods, _pk, obj) => {
    if (applyingRemote) return
    // Returning a patch merges it into the update Dexie is already doing, so
    // this costs no extra write.
    return obj.uid ? { updatedAt: Date.now() } : { uid: newUid(), updatedAt: Date.now() }
  })

  table.hook('deleting', function (_pk, obj) {
    if (applyingRemote) return
    const uid = (obj as AnyRow | undefined)?.uid
    if (typeof uid !== 'string' || !uid) return
    // Only once the delete has actually committed. Writing the tombstone here
    // rather than immediately means an aborted transaction cannot leave behind
    // a record of a deletion that did not happen — which would delete the row
    // on every other device.
    this.onsuccess = () => {
      // A new transaction, because the one being committed is scoped to this
      // table alone and cannot touch `tombstones`.
      void Dexie.ignoreTransaction(() =>
        db.tombstones.put({ kind, uid, deletedAt: Date.now() }),
      ).catch(() => {
        /* The row is gone locally either way; worst case it returns on the
           next pull and is deleted again. Never break a delete over this. */
      })
    }
  })
}

// ---------------------------------------------------------------------------
// The wire format
// ---------------------------------------------------------------------------

type WireRecord = { kind: Kind; uid: string; updatedAt: number; body: Record<string, unknown> }
type WireTombstone = { kind: Kind; uid: string; deletedAt: number }
type State = { records: WireRecord[]; tombstones: WireTombstone[] }

/**
 * Strip the row down to what is portable.
 *
 * `id` is dropped — it is this device's counter and means nothing anywhere
 * else. `listId` is the one cross-row reference in the schema, and it is a
 * local id too, so it travels as the list's uid and is resolved back on
 * arrival. An item whose list has no uid yet is held back rather than sent
 * orphaned; the next sync, after the list has one, takes it.
 */
function toWire(kind: Kind, row: AnyRow, listUidById: Map<number, string>): WireRecord | null {
  if (!row.uid || row.updatedAt == null) return null
  const { id: _id, ...body } = row
  if (kind === 'item') {
    const listId = (row as unknown as Item).listId
    const listUid = listUidById.get(listId)
    if (!listUid) return null
    delete (body as Record<string, unknown>).listId
    ;(body as Record<string, unknown>).listUid = listUid
  }
  return { kind, uid: row.uid, updatedAt: row.updatedAt, body: body as Record<string, unknown> }
}

/** The reverse. Returns null when an item names a list this device has not
 *  seen — which resolves itself once the list arrives, so it is skipped rather
 *  than dropped into a list it does not belong to. */
function fromWire(rec: WireRecord, listIdByUid: Map<string, number>): AnyRow | null {
  const body = { ...(rec.body ?? {}) } as AnyRow
  if (rec.kind === 'item') {
    const listUid = body.listUid as string | undefined
    delete body.listUid
    const listId = listUid ? listIdByUid.get(listUid) : undefined
    if (listId == null) return null
    ;(body as unknown as Item).listId = listId
  }
  body.uid = rec.uid
  body.updatedAt = rec.updatedAt
  return body
}

// ---------------------------------------------------------------------------
// Reading and merging
// ---------------------------------------------------------------------------

async function localState(): Promise<State> {
  const lists = (await db.lists.toArray()) as unknown as Array<List & AnyRow>
  const listUidById = new Map<number, string>()
  for (const l of lists) if (l.id != null && l.uid) listUidById.set(l.id, l.uid)

  const records: WireRecord[] = []
  for (const { kind, table } of TABLES) {
    for (const row of await table.toArray()) {
      const w = toWire(kind, row, listUidById)
      if (w) records.push(w)
    }
  }

  const cutoff = Date.now() - TOMBSTONE_DAYS * 86_400_000
  const tombstones = (await db.tombstones.toArray())
    .filter((t) => t.deletedAt >= cutoff)
    .map((t) => ({ kind: t.kind, uid: t.uid, deletedAt: t.deletedAt }))

  return { records, tombstones }
}

/**
 * Fold the server's answer into the local database.
 *
 * The server has already merged this device's push into its own copy, so what
 * comes back is the agreed state; the job here is only to make local match it
 * without disturbing rows the server has not heard about yet.
 */
async function applyRemote(state: State): Promise<{ added: number; updated: number; removed: number }> {
  let added = 0
  let updated = 0
  let removed = 0

  applyingRemote = true
  try {
    // Tombstones first, so a row that was deleted elsewhere does not briefly
    // reappear and then vanish.
    const tombByKind = new Map<Kind, Map<string, number>>()
    for (const t of state.tombstones) {
      if (!tombByKind.has(t.kind)) tombByKind.set(t.kind, new Map())
      tombByKind.get(t.kind)!.set(t.uid, t.deletedAt)
    }
    for (const { kind, table } of TABLES) {
      const tombs = tombByKind.get(kind)
      if (!tombs) continue
      for (const row of await table.toArray()) {
        if (!row.uid || row.id == null) continue
        const deletedAt = tombs.get(row.uid)
        // Same rule the server applies: a delete beats an edit it is at least
        // as new as, and loses to one that came after it.
        if (deletedAt != null && deletedAt >= (row.updatedAt ?? 0)) {
          await table.delete(row.id)
          removed++
        }
      }
    }

    // Lists before items, so an item's list exists by the time it lands.
    for (const { kind, table } of TABLES) {
      const incoming = state.records.filter((r) => r.kind === kind)
      if (!incoming.length) continue

      // Rebuilt per kind: applying the lists above may have created new ones.
      const listIdByUid = new Map<string, number>()
      if (kind === 'item') {
        for (const l of await db.lists.toArray()) {
          if (l.id != null && l.uid) listIdByUid.set(l.uid, l.id)
        }
      }

      const localByUid = new Map<string, AnyRow>()
      for (const row of await table.toArray()) if (row.uid) localByUid.set(row.uid, row)

      for (const rec of incoming) {
        const local = localByUid.get(rec.uid)
        if (local && (local.updatedAt ?? 0) >= rec.updatedAt) continue // ours is newer or the same
        const row = fromWire(rec, listIdByUid)
        if (!row) continue
        if (local?.id != null) {
          // put, not update: the server's copy is the whole row, and a partial
          // update would leave fields the other device cleared still set here.
          await table.put({ ...row, id: local.id })
          updated++
        } else {
          await table.add(row)
          added++
        }
      }
    }

    // Local tombstones the server has now taken responsibility for. Pruned on
    // the same window the server uses, so both sides forget together.
    const cutoff = Date.now() - TOMBSTONE_DAYS * 86_400_000
    const stale = await db.tombstones.filter((t) => t.deletedAt < cutoff).toArray()
    for (const t of stale) if (t.id != null) await db.tombstones.delete(t.id)
  } finally {
    applyingRemote = false
  }

  return { added, updated, removed }
}

// ---------------------------------------------------------------------------
// The public surface
// ---------------------------------------------------------------------------

export type SyncResult =
  | { ok: true; added: number; updated: number; removed: number; sent: number }
  | { ok: false; reason: 'off' | 'signin' | 'forbidden' | 'offline' | 'error'; message: string }

export function syncEnabled(): boolean {
  return EDITION === 'personal' && localStorage.getItem(ENABLED_KEY) === '1'
}

export function setSyncEnabled(on: boolean): void {
  if (on) localStorage.setItem(ENABLED_KEY, '1')
  else localStorage.removeItem(ENABLED_KEY)
}

export function lastSyncedAt(): number | null {
  const raw = localStorage.getItem(LAST_KEY)
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) ? n : null
}

/** Whether this browser could sync at all: the right edition, and a session. */
export async function syncAvailable(): Promise<boolean> {
  if (EDITION !== 'personal') return false
  try {
    const res = await fetch(`${ENDPOINT}/health`, { credentials: 'include' })
    return res.ok
  } catch {
    return false
  }
}

/**
 * One round trip: push everything, receive the merged state, apply it.
 *
 * Deliberately not two calls. A pull-then-push leaves a window where the
 * device has applied someone else's changes but not yet sent its own, and a
 * crash in that window loses the local edits.
 */
export async function sync(): Promise<SyncResult> {
  if (!syncEnabled()) return { ok: false, reason: 'off', message: 'Sync is off.' }
  if (!navigator.onLine) {
    return { ok: false, reason: 'offline', message: 'No connection — your list is safe on this device.' }
  }

  let payload: State
  try {
    payload = await localState()
  } catch {
    return { ok: false, reason: 'error', message: 'Could not read the local database.' }
  }

  let res: Response
  try {
    res = await fetch(`${ENDPOINT}/state`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    return { ok: false, reason: 'offline', message: 'Could not reach the server.' }
  }

  if (res.status === 401) {
    return { ok: false, reason: 'signin', message: 'Signed out. Sign in at id.devondoes.dev, then sync again.' }
  }
  if (res.status === 403) {
    return { ok: false, reason: 'forbidden', message: 'This account does not have access to Mise.' }
  }
  if (!res.ok) {
    return { ok: false, reason: 'error', message: `Server said ${res.status}.` }
  }

  let state: State
  try {
    state = (await res.json()) as State
  } catch {
    return { ok: false, reason: 'error', message: 'The server sent something unreadable.' }
  }
  if (!Array.isArray(state?.records) || !Array.isArray(state?.tombstones)) {
    return { ok: false, reason: 'error', message: 'The server sent an unexpected shape.' }
  }

  const counts = await applyRemote(state)
  localStorage.setItem(LAST_KEY, String(Date.now()))
  return { ok: true, ...counts, sent: payload.records.length }
}

/**
 * Sync when it is worth syncing: on open, when the app comes back to the
 * foreground, and when the network returns.
 *
 * Not on every keystroke. A grocery list is edited in bursts while you stand in
 * an aisle, and a request per tick would be mostly noise; coming back to the
 * app is the moment the other device's changes actually matter.
 */
export function startAutoSync(onResult?: (r: SyncResult) => void): () => void {
  let running = false
  const run = async () => {
    if (running || !syncEnabled()) return
    running = true
    try {
      onResult?.(await sync())
    } finally {
      running = false
    }
  }

  const onVisible = () => {
    if (document.visibilityState === 'visible') void run()
  }
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', run)
  void run()

  return () => {
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', run)
  }
}
