import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paperLogColumns, paperLogLaterItems, paperLogExtraFields } from '../src/lib/paperLogForm.js'

test('no school rules: the basic columns', () => {
  assert.deepEqual(paperLogColumns({}), ['Date', 'Activity / Place', 'Hours', 'Supervisor', 'Supervisor signature'])
  assert.deepEqual(paperLogLaterItems({}), [])
})

test('a strict school: its rules and its own questions become columns', () => {
  const policy = {
    logRules: { orgNameRequired: true, locationRequired: true, supervisorRequired: true, notesMinLength: 20, proofRequired: true, allowedCategories: ['Education'] },
    customFields: [{ key: 'club', label: 'Club', type: 'select', required: true, options: ['NHS'] }, { key: 'paid', label: 'Paid?', type: 'checkbox' }],
    signatures: { mode: 'signature', signer: 'both' },
  }
  assert.deepEqual(paperLogColumns(policy), [
    'Date', 'Activity / Place', 'Hours', 'Category', 'Organization', 'Location', 'Supervisor', 'Supervisor email',
    'What you did', 'Club *', 'Paid? (yes/no)', 'Supervisor signature', 'Your signature',
  ])
  assert.deepEqual(paperLogLaterItems(policy), ['a proof file', 'your signature in the app'])
})

test('the scan review list asks for the school\'s extra fields', () => {
  assert.deepEqual(paperLogExtraFields({}), [])
  const policy = {
    logRules: { locationRequired: true, supervisorRequired: true, notesMinLength: 20, allowedCategories: ['Education'] },
    customFields: [{ key: 'club', label: 'Club', type: 'select', required: true, options: ['NHS'] }],
  }
  assert.deepEqual(paperLogExtraFields(policy).map((f) => f.key), ['category', 'location', 'supervisorEmail', 'description', 'custom:club'])
})
