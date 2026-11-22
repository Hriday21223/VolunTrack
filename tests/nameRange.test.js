// Counselor caseloads (#972): which students a co-admin limited to last-name
// ranges sees.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lastNameKey, inLastNameRange, inAnyRange, readRanges, rangesLabel } from '../server/nameRange.js'

test('the last name is the last word, letters only', () => {
  assert.equal(lastNameKey('Maya Chawla'), 'chawla')
  assert.equal(lastNameKey('María de la Cruz'), 'cruz')
  assert.equal(lastNameKey('Sam Lee-Chaw'), 'leechaw')
  assert.equal(lastNameKey('José Núñez'), 'nunez')
  assert.equal(lastNameKey(''), '')
})

test('range ends match the way counselors write them', () => {
  assert.equal(inLastNameRange('Maya Chawla', 'a', 'chaw'), true)
  assert.equal(inLastNameRange('Ann Chen', 'a', 'chaw'), false)
  assert.equal(inLastNameRange('Ann Chen', 'che', 'gun'), true)
  assert.equal(inLastNameRange('Bo Gunn', 'che', 'gun'), true)
  assert.equal(inLastNameRange('Li Guo', 'che', 'gun'), false)
  assert.equal(inLastNameRange('Li Guo', 'guo', 'kri'), true)
  assert.equal(inLastNameRange('Zed Zhou', 'm', ''), true)
  assert.equal(inLastNameRange('Al Adams', '', 'l'), true)
  assert.equal(inLastNameRange('', 'a', 'z'), false)
  assert.equal(inAnyRange('Ryan Ruiz', [{ from: 'a', to: 'chaw' }, { from: 'ro', to: 'ry' }]), true)
  assert.equal(inAnyRange('Ryan Smith', [{ from: 'a', to: 'chaw' }, { from: 'ro', to: 'ry' }]), false)
})

test('ranges from a request are checked and cleaned', () => {
  assert.deepEqual(readRanges([{ from: 'A', to: 'Chaw' }, { from: '', to: '' }]), { ranges: [{ from: 'a', to: 'chaw' }] })
  assert.deepEqual(readRanges(null), { ranges: [] })
  assert.ok(readRanges([{ from: 'Gun', to: 'Che' }]).error)
  assert.ok(readRanges([{ from: '123', to: 'B' }]).error)
  assert.ok(readRanges(Array.from({ length: 6 }, () => ({ from: 'a', to: 'b' }))).error)
  assert.ok(readRanges('a-z').error)
  assert.equal(rangesLabel([{ from: 'a', to: 'chaw' }, { from: 'ro', to: '' }]), 'A–Chaw, Ro–Z')
})

// A school's sign-up grades (#976) stand in for inherited grades.
test('sign-up grades apply unless the school set its own goals', async () => {
  const { resolvePolicy } = await import('../server/requirements.js')
  const org = { goals: { totalHours: 40, grades: [] } }
  const r = resolvePolicy({ orgPolicy: org, schoolGradesList: ['9th', '10'] })
  assert.deepEqual(r.policy.goals.grades, ['9', '10'])
  assert.equal(r.policy.goals.totalHours, 40) // the organization's goals still apply
  const own = resolvePolicy({ schoolPolicy: { goals: { grades: ['12'] } }, orgPolicy: org, schoolGradesList: ['9'] })
  assert.deepEqual(own.policy.goals.grades, ['12'])
  assert.deepEqual(resolvePolicy({}).policy.goals.grades, [])
})
