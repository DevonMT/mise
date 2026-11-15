import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeSync } from './syncText'

const ok = { ok: true as const, added: 0, updated: 0, removed: 0, sent: 40 }

test('Sync Now reports records it could not save instead of saying up to date', () => {
  assert.equal(describeSync(ok), 'Up to date. Checked 40 records.')
  assert.equal(describeSync({ ...ok, failed: 1 }), "1 record couldn't be saved on this device. Mise tries again next sync.")
  assert.equal(describeSync({ ...ok, added: 2, failed: 3 }), "Synced: 2 added. 3 records couldn't be saved on this device. Mise tries again next sync.")
  assert.equal(describeSync({ ...ok, updated: 1, removed: 1 }), 'Synced: 1 updated, 1 removed.')
})
