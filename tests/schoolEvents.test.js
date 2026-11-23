// Events for schools and organizations (#995): the admin form's checks, time
// zones, and "only while an event is coming up".
import test from 'node:test'
import assert from 'node:assert/strict'
import { zonedTimeToUtc, utcToZoned, readEvent, isUpcoming, agendaLines } from '../server/schoolEvents.js'

test('wall-clock time in a zone becomes the right UTC instant', () => {
  assert.equal(zonedTimeToUtc('2026-12-01', '16:00', 'America/Chicago').toISOString(), '2026-12-01T22:00:00.000Z') // CST, UTC-6
  assert.equal(zonedTimeToUtc('2026-07-01', '16:00', 'America/Chicago').toISOString(), '2026-07-01T21:00:00.000Z') // CDT, UTC-5
  assert.equal(zonedTimeToUtc('2026-12-01', '09:30', 'America/New_York').toISOString(), '2026-12-01T14:30:00.000Z')
  assert.equal(zonedTimeToUtc('2026-12-01', '09:30', 'America/Phoenix').toISOString(), '2026-12-01T16:30:00.000Z')
  assert.equal(zonedTimeToUtc('2026-02-31', '09:00', 'America/Chicago'), null)
  assert.equal(zonedTimeToUtc('2026-12-01', '25:00', 'America/Chicago'), null)
  assert.equal(zonedTimeToUtc('12/01/2026', '09:00', 'America/Chicago'), null)
})

test('and back again for the admin form', () => {
  const at = zonedTimeToUtc('2026-11-30', '18:45', 'America/Los_Angeles')
  assert.deepEqual(utcToZoned(at, 'America/Los_Angeles'), { date: '2026-11-30', time: '18:45' })
})

test('reading what the admin typed', () => {
  const ok = readEvent({ title: ' VolunTrack for schools ', date: '2026-12-01', time: '16:00', timeZone: 'America/Chicago', durationMinutes: 30, mode: 'online', offerCode: 'givetuesday', rsvpUrl: 'https://www.eventbrite.com/e/123' })
  assert.equal(ok.error, undefined)
  assert.equal(ok.event.title, 'VolunTrack for schools')
  assert.equal(ok.event.offerCode, 'GIVETUESDAY')
  assert.equal(ok.event.place, null)
  assert.equal(ok.event.published, true)
  const base = { title: 'X', date: '2026-12-01', time: '16:00', durationMinutes: 30, mode: 'online' }
  assert.match(readEvent({ ...base, title: '' }).error, /name/)
  assert.match(readEvent({ ...base, mode: 'in_person' }).error, /address/)
  assert.match(readEvent({ ...base, mode: 'party' }).error, /in person or online/)
  assert.match(readEvent({ ...base, durationMinutes: 5 }).error, /length/)
  assert.match(readEvent({ ...base, rsvpUrl: 'http://example.com' }).error, /https/)
  assert.match(readEvent({ ...base, rsvpUrl: 'javascript:alert(1)' }).error, /https/)
  assert.match(readEvent({ ...base, offerCode: 'NO SPACES' }).error, /letters, numbers/)
  assert.match(readEvent({ ...base, timeZone: 'Mars/Base' }).error, /time zone/)
  assert.equal(readEvent({ ...base, published: false }).event.published, false)
})

test('shown only while coming up or under way', () => {
  const ev = { startsAt: '2026-12-01T22:00:00Z', durationMinutes: 30, published: true }
  assert.equal(isUpcoming(ev, new Date('2026-11-23T12:00:00Z')), true)
  assert.equal(isUpcoming(ev, new Date('2026-12-01T22:15:00Z')), true) // under way
  assert.equal(isUpcoming(ev, new Date('2026-12-01T22:31:00Z')), false) // over
  assert.equal(isUpcoming({ ...ev, published: false }, new Date('2026-11-23T12:00:00Z')), false)
  assert.equal(isUpcoming(null), false)
})

test('agenda lines', () => {
  assert.deepEqual(agendaLines('0:00 Why paper logs break\n\n0:05 The student side\nQuestions'), [
    { time: '0:00', text: 'Why paper logs break' },
    { time: '0:05', text: 'The student side' },
    { time: null, text: 'Questions' },
  ])
})
