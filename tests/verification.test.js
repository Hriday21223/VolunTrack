// Verification and requirements: how far a student is from their requirement,
// which award level they've reached, and the sign-in gates. Pure functions.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const {
  requirementShortfall, awardFor, gradeAllowed, emailAllowedBySignIn,
} = await import('../server/requirements.js')

test('no requirement means no shortfall', () => {
  const r = requirementShortfall({}, '10', 5)
  assert.equal(r.target, null)
  assert.equal(r.remaining, null)
})

test('a plain hour requirement counts down to zero', () => {
  const policy = { goals: { totalHours: 40 } }
  assert.equal(requirementShortfall(policy, '10', 0).remaining, 40)
  assert.equal(requirementShortfall(policy, '10', 15).remaining, 25)
  assert.equal(requirementShortfall(policy, '10', 40).remaining, 0)
  assert.equal(requirementShortfall(policy, '10', 50).remaining, 0, 'over the target is not negative')
})

test('a per-category minimum can leave a student short even past the total', () => {
  // 40 total, of which at least 10 must be Tutoring. A student with 40 hours
  // but no Tutoring is still 10 short.
  const policy = { goals: { totalHours: 40, byCategory: { Tutoring: 10 } } }
  const none = requirementShortfall(policy, '10', 40, {})
  assert.equal(none.remaining, 10)
  const some = requirementShortfall(policy, '10', 40, { Tutoring: 10 })
  assert.equal(some.remaining, 0)
})

test('category matching ignores case', () => {
  const policy = { goals: { totalHours: 20, byCategory: { Environment: 5 } } }
  const r = requirementShortfall(policy, '10', 20, { environment: 5 })
  assert.equal(r.remaining, 0)
})

test('award level reflects hours reached and distance to the next', () => {
  const policy = { awards: { levels: [
    { name: 'Bronze', hours: 10 }, { name: 'Silver', hours: 25 }, { name: 'Gold', hours: 50 },
  ] } }
  assert.equal(awardFor(policy, 5).current, null)
  assert.equal(awardFor(policy, 5).next.name, 'Bronze')
  assert.equal(awardFor(policy, 30).current.name, 'Silver')
  assert.equal(awardFor(policy, 30).next.name, 'Gold')
  assert.equal(awardFor(policy, 30).toNext, 20)
  assert.equal(awardFor(policy, 60).current.name, 'Gold')
  assert.equal(awardFor(policy, 60).next, null)
})

test('a school with no grade list accepts any grade', () => {
  assert.equal(gradeAllowed({}, '7'), true)
  const policy = { goals: { grades: ['9', '10', '11', '12'] } }
  assert.equal(gradeAllowed(policy, '9'), true)
  assert.equal(gradeAllowed(policy, 'Grade 9'), true, 'grade labels are normalized')
  assert.equal(gradeAllowed(policy, '7'), false)
})

test('sign-in email-domain allowlist matches the domain and its subdomains', () => {
  assert.equal(emailAllowedBySignIn({}, 'anyone@anywhere.com'), true, 'no list means anyone')
  const policy = { signIn: { allowedEmailDomains: ['school.edu'] } }
  assert.equal(emailAllowedBySignIn(policy, 'maya@school.edu'), true)
  assert.equal(emailAllowedBySignIn(policy, 'maya@sub.school.edu'), true)
  assert.equal(emailAllowedBySignIn(policy, 'maya@gmail.com'), false)
  assert.equal(emailAllowedBySignIn(policy, 'not-an-email'), false)
})
