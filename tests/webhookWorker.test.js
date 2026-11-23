// The webhook worker leaves the database alone while nothing is waiting, so
// Neon's compute can suspend (Nov 23: a query every minute used up the free
// plan's monthly allowance).
import test from 'node:test'
import assert from 'node:assert/strict'
import { workerShouldRun } from '../server/webhooks.js'

const HOUR = 60 * 60 * 1000

test('idle: no query until a retry is due or the 6-hour sweep', () => {
  const now = 1_800_000_000_000
  assert.equal(workerShouldRun(now, null, now - HOUR), false) // nothing pending
  assert.equal(workerShouldRun(now, now + 10 * 60_000, now - HOUR), false) // a retry later
  assert.equal(workerShouldRun(now, now - 1000, now - HOUR), true) // a retry is due
  assert.equal(workerShouldRun(now, null, now - 6 * HOUR), true) // periodic sweep
})
