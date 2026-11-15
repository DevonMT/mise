import type { SyncResult } from './sync'

/**
 * The line Settings shows after Sync Now. Records this device could not save
 * (sync.ts logs which) are still on the server, so the next sync tries them
 * again; they are reported rather than hidden behind "Up to date".
 */
export function describeSync(r: SyncResult): string {
  if (!r.ok) return r.message
  const { added, updated, removed, sent, failed = 0 } = r
  const missed = failed ? ` ${failed} couldn't be saved on this device. Mise tries again next sync.` : ''
  if (!added && !updated && !removed) return failed ? `Synced.${missed}` : `Up to date. Checked ${sent} records.`
  const parts = []
  if (added) parts.push(`${added} added`)
  if (updated) parts.push(`${updated} updated`)
  if (removed) parts.push(`${removed} removed`)
  return `Synced: ${parts.join(', ')}.${missed}`
}
