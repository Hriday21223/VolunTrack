import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isOwnEmail } from '../server/requirements.js'

test('a student can’t use their own email as the supervisor', () => {
  assert.equal(isOwnEmail('ana@school.org', 'ana@school.org'), true)
  assert.equal(isOwnEmail(' ANA@School.org ', 'ana@school.org'), true)
  assert.equal(isOwnEmail('ana+hours@school.org', 'ana@school.org'), true)
  assert.equal(isOwnEmail('a.n.a@gmail.com', 'ana@gmail.com'), true)
  assert.equal(isOwnEmail('ana@googlemail.com', 'ana@gmail.com'), true)
})

test('a real supervisor’s email is fine', () => {
  assert.equal(isOwnEmail('johnson@school.org', 'ana@school.org'), false)
  assert.equal(isOwnEmail('a.na@school.org', 'ana@school.org'), false) // dots only ignored for Gmail
  assert.equal(isOwnEmail('', 'ana@school.org'), false)
  assert.equal(isOwnEmail('ana@school.org', ''), false)
})
