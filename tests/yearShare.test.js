import { test } from 'node:test'
import assert from 'node:assert/strict'
import { yearShareSummary, firstNameOf, longestWeekStreak } from '../server/yearShare.js'

const log = (date, hours, extra = {}) => ({ date, hours, category: 'Community Service', verification_status: 'none', place: 'Food Bank', ...extra })

test('first name only', () => {
  assert.equal(firstNameOf('Maria del Carmen Lopez'), 'Maria')
  assert.equal(firstNameOf('  '), '')
  assert.equal(firstNameOf(null), '')
})

test('no counted hours in the year → null', () => {
  assert.equal(yearShareSummary([], 2026), null)
  assert.equal(yearShareSummary([log('2025-05-01', 2)], 2026), null)
  assert.equal(yearShareSummary([log('2026-05-01', 2, { verification_status: 'rejected' })], 2026), null)
})

test('totals leave out rejected hours and other years, and report approved', () => {
  const s = yearShareSummary([
    log('2026-03-02', 2, { verification_status: 'approved' }),
    log('2026-03-09', 1.5, { place: ' food  bank ' }),
    log('2026-10-01', 3, { category: 'Education', place: 'Library' }),
    log('2026-10-02', 5, { verification_status: 'rejected' }),
    log('2025-12-31', 9),
  ], 2026)
  assert.equal(s.totalHours, 6.5)
  assert.equal(s.sessions, 3)
  assert.equal(s.approvedHours, 2)
  assert.equal(s.places, 2)
  assert.deepEqual(s.categories.map((c) => c.category), ['Community Service', 'Education'])
  assert.equal(s.busiestMonth.month, 2) // March, 3.5h
  assert.equal(s.longestWeekStreak, 2)
})

test('only counts leave: no place names or activities in the output', () => {
  const s = yearShareSummary([log('2026-01-05', 1, { activity: 'Secret thing', place: 'Somewhere private' })], 2026)
  const json = JSON.stringify(s)
  assert.ok(!json.includes('Secret thing'))
  assert.ok(!json.includes('Somewhere private'))
})

test('week streak counts Monday–Sunday weeks in a row', () => {
  assert.equal(longestWeekStreak(['2026-01-05', '2026-01-11', '2026-01-12', '2026-01-26']), 2)
})
