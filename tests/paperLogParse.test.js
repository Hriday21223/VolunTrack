import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePaperLog, parseServiceRecord } from '../src/lib/paperLogParse.js'

// The text pdf.js reads from server/serviceRecordPdf.js's PDF (label and
// value on one line, as ScanPaperLog's textToLines joins them).
const RECORD = `Volunteer Service Record   VolunTrack
Volunteer   Ana Guest
Event   Food Bank Sorting
Organizer   Test Organizer
Date   December 1, 2026
Location   Austin Central Library, 710 W Cesar Chavez St, Austin
Time in   9:00 AM
Time out   11:30 AM
Total hours   2.5
Test Organizer   VolunTrack Org
Organizer   VolunTrack
Signed electronically by the organizer through VolunTrack on November 27, 2026. The times and hours are as the organizer
recorded them.
Record esu_test_sample`

test('VolunTrack\'s own service record becomes one entry with its times', () => {
  const today = new Date(2026, 11, 5)
  assert.deepEqual(parsePaperLog(RECORD, today), [{
    date: '2026-12-01', activity: 'Food Bank Sorting', orgName: 'Test Organizer', supervisorName: 'Test Organizer',
    hours: 2.5, location: 'Austin Central Library, 710 W Cesar Chavez St, Austin', startTime: '09:00', endTime: '11:30',
  }])
})

test('hours come from the times when Total hours is unreadable', () => {
  const [e] = parseServiceRecord(RECORD.replace('Total hours   2.5', 'Total hours   ?'), new Date(2026, 11, 5))
  assert.equal(e.hours, 2.5)
})

test('an ordinary log table is still read row by row', () => {
  const rows = parsePaperLog('Date Activity Hours\n11/20/2026 Food bank sorting 2 hrs\n11/22/2026 Park cleanup 1.5 hrs', new Date(2026, 11, 5))
  assert.equal(rows.length, 2)
  assert.equal(parseServiceRecord('11/20/2026 Food bank 2 hrs'), null)
})
