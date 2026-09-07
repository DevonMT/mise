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
import { EDITION, grantedEdition, setGrantedVariant } from './edition'

/**
 * Sync is a devondoes.dev feature: it needs the platform session cookie, which
 * a page can only receive on that domain. The copy served from
 * devontroedel.com is a different registrable domain and can never sync — it
 * stays a purely local app, which is what Mise Lite is anyway.
 */
const ENDPOINT = 'https://id.devondoes.dev/api/mise'

const ENABLED_KEY = 'mise.sync.enabled'
const LAST_KEY = 'mise.sync.last'
const DEVICE_KEY = 'mise.sync.device'

/**
 * This browser's identity, so the server can avoid waking the device that just
 * pushed with news of its own change. Not a security boundary — forging it
 * costs one redundant sync — and not tied to the account, so signing out and
 * back in on the same device does not create a second one.
 */
function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    id = newUid()
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}

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

/**
 * Set by startAutoSync while the app is running. The hooks call it on every
 * local write so a change is pushed within a couple of seconds rather than
 * waiting for the next time you open the app.
 *
 * Indirect on purpose: sync must not become a thing the database layer depends
 * on. When nothing is listening — sync off, Lite build, a unit test — this is
 * null and every write behaves exactly as it did before any of this existed.
 */
function touched(): void {
  scheduleLocalSync?.()
}

// ---------------------------------------------------------------------------
// Stamping
// ---------------------------------------------------------------------------

for (const { kind, table } of TABLES) {
  table.hook('creating', (_pk, obj) => {
    if (applyingRemote) return
    if (!obj.uid) obj.uid = newUid()
    obj.updatedAt = Date.now()
    touched()
  })

  table.hook('updating', (_mods, _pk, obj) => {
    if (applyingRemote) return
    touched()
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
      touched()
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

export type WireRecord = { kind: Kind; uid: string; updatedAt: number; body: Record<string, unknown> }
export type WireTombstone = { kind: Kind; uid: string; deletedAt: number }
export type State = {
  records: WireRecord[]
  tombstones: WireTombstone[]
  /** The tier this account holds, per the platform. Absent means none. */
  variant?: string | null
}

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
 * Exported for the tests. This is the function that writes to a database of
 * real groceries, and the bug that matters here is not an exception but a row
 * that quietly vanishes or quietly comes back, so it is exercised directly
 * rather than only through a live sync.
 *
 * The server has already merged this device's push into its own copy, so what
 * comes back is the agreed state; the job here is only to make local match it
 * without disturbing rows the server has not heard about yet.
 */
export async function applyRemote(
  state: State,
): Promise<{ added: number; updated: number; removed: number }> {
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
  | {
      ok: true; added: number; updated: number; removed: number; sent: number
      /** True on the one sync where the account's tier changed, so the app can
       *  say so once rather than silently growing or losing three buttons. */
      editionChanged?: boolean
    }
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

/**
 * Whether this browser could sync, and if not, why.
 *
 * The distinction matters for what Settings says. A page served from the wrong
 * origin can never sync and should be told so plainly; a signed-out or expired
 * session on the right origin is one sign-in away, and telling that person to
 * "use the copy at mise.devondoes.dev" when they are already looking at it is
 * the kind of wrong advice that sends someone hunting for a second install.
 */
export type Availability = 'ok' | 'signin' | 'unavailable'

export async function syncAvailable(): Promise<Availability> {
  if (EDITION !== 'personal') return 'unavailable'
  try {
    const res = await fetch(`${ENDPOINT}/health`, { credentials: 'include' })
    if (res.ok) {
      // The health check knows the tier, so learn it here as well as from a
      // sync. Otherwise the tier is only discoverable by syncing, and anything
      // that depends on it stays wrong for a device that has not turned sync on
      // — which is every device on its first visit.
      const body = (await res.json().catch(() => null)) as { variant?: string | null } | null
      setGrantedVariant(body?.variant)
      return 'ok'
    }
    // The request reached the platform and was answered, so the origin is
    // allowed and CORS is fine — this is only about who is signed in.
    if (res.status === 401 || res.status === 403) return 'signin'
    return 'unavailable'
  } catch {
    // A network failure, or a CORS rejection because this origin is not on the
    // allow-list. Indistinguishable from here, and both mean "not from here".
    return 'unavailable'
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
      body: JSON.stringify({ ...payload, deviceId: deviceId() }),
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

  // The tier rides home on every sync, so a change made in admin applies here
  // within seconds — no sign-out, no reinstall, no second app to move to. That
  // is the whole reason the edition stopped being a build flag.
  const before = grantedEdition()
  setGrantedVariant(state.variant)
  const editionChanged = grantedEdition() !== before

  const counts = await applyRemote(state)
  localStorage.setItem(LAST_KEY, String(Date.now()))
  return { ok: true, ...counts, sent: payload.records.length, editionChanged }
}

/**
 * Keep this device in step, in both directions, without anyone pressing
 * anything.
 *
 * OUTBOUND: local writes are already visible to this file through the Dexie
 * hooks above, so a change schedules a push. Debounced, because ticking four
 * things off in an aisle is four writes in as many seconds and they belong in
 * one request — but short enough that the other device sees it while you are
 * still standing there.
 *
 * INBOUND: an SSE stream that says only "something changed"; this device then
 * does an ordinary sync. Keeping the data out of the stream means the merge
 * stays the single path that writes to the database, and a dropped event costs
 * one stale minute rather than a divergence.
 *
 * The fallbacks matter more than the stream. EventSource is not available
 * everywhere, connections die quietly, and phones suspend them on lock — so the
 * old triggers stay exactly as they were, and a poll runs whenever the stream is
 * NOT confirmed open. Live updates are an improvement on the floor, not the
 * floor itself.
 */
const PUSH_DEBOUNCE_MS = 1_200
const POLL_MS = 20_000

let scheduleLocalSync: (() => void) | null = null

export function startAutoSync(onResult?: (r: SyncResult) => void): () => void {
  // Lite has no account to sync to, and App mounts this unconditionally. Bail
  // before starting a timer that can only ever decide to do nothing.
  if (EDITION !== 'personal') return () => {}

  let running = false
  let stopped = false
  let live = false
  let debounce: ReturnType<typeof setTimeout> | undefined
  let poll: ReturnType<typeof setInterval> | undefined
  let es: EventSource | null = null
  let retry = 0

  const run = async () => {
    if (stopped || running || !syncEnabled()) return
    running = true
    try {
      onResult?.(await sync())
    } finally {
      running = false
    }
  }

  // Called by the Dexie hooks on any local write.
  scheduleLocalSync = () => {
    if (stopped || !syncEnabled()) return
    clearTimeout(debounce)
    debounce = setTimeout(() => void run(), PUSH_DEBOUNCE_MS)
  }

  // Poll only while the stream is not carrying the load, and only while the tab
  // is visible — a backgrounded tab polling a grocery list helps nobody.
  const startPoll = () => {
    if (poll) return
    poll = setInterval(() => {
      if (!live && document.visibilityState === 'visible') void run()
    }, POLL_MS)
  }
  const stopPoll = () => {
    clearInterval(poll)
    poll = undefined
  }

  const connect = () => {
    if (stopped || !syncEnabled() || typeof EventSource === 'undefined') return
    try {
      es = new EventSource(`${ENDPOINT}/events?device=${encodeURIComponent(deviceId())}`, {
        withCredentials: true,
      })
    } catch {
      startPoll()
      return
    }
    es.addEventListener('ready', () => {
      live = true
      retry = 0
    })
    es.addEventListener('changed', () => void run())
    es.onerror = () => {
      // EventSource retries on its own, but not after the server closes the
      // stream cleanly, and never with a backoff. Take it over: back off to a
      // minute so a signed-out or restarting server is not hammered, and lean
      // on the poll in the meantime.
      live = false
      es?.close()
      es = null
      if (stopped) return
      retry = Math.min(retry + 1, 6)
      setTimeout(connect, Math.min(1_000 * 2 ** retry, 60_000))
    }
  }

  const onVisible = () => {
    if (document.visibilityState !== 'visible') return
    void run()
    if (!live && !es) connect()
  }

  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', run)
  startPoll()
  connect()
  void run()

  return () => {
    stopped = true
    scheduleLocalSync = null
    clearTimeout(debounce)
    stopPoll()
    es?.close()
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', run)
  }
}
