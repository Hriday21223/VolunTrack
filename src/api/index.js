import { keys, read, write } from '@/lib/storage.js'
import { uid } from '@/utils/id.js'

/* ---------- Users (local auth) ---------- */

export function getUsers() {
  const users = read(keys.users, [])
  if (users.length === 0) {
    const demoUser = {
      id: uid('usr'),
      name: 'Hriday Karnatam',
      email: 'karnatamhriday@gmail.com',
      school: 'Demo School',
      grade: '12',
      passwordHash: hashPassword('test123'),
      pinHash: null,
      resetPinCode: null,
      resetPinCodeExpiresAt: null,
      resetPasswordCode: null,
      resetPasswordCodeExpiresAt: null,
      createdAt: new Date().toISOString(),
    }
    write(keys.users, [demoUser])
    return [demoUser]
  }
  return users
}

export function findUserByEmail(email) {
  return getUsers().find((u) => u.email.toLowerCase() === email.toLowerCase()) || null
}

export function findUserBySyncPin(syncPin) {
  const users = getUsers()
  return users.find((u) => u.syncPin === syncPin) || null
}

export function updateSyncPin(userId, syncPin) {
  const users = getUsers()
  const idx = users.findIndex((u) => u.id === userId)
  if (idx === -1) return null
  
  // Validate PIN format
  if (!/^\d{5}$/.test(syncPin)) {
    throw new Error('Sync PIN must be exactly 5 digits.')
  }
  
  // Check if PIN is already taken by another user
  const existing = users.find((u) => u.syncPin === syncPin && u.id !== userId)
  if (existing) {
    throw new Error('This sync PIN is already in use.')
  }
  
  users[idx] = { ...users[idx], syncPin }
  write(keys.users, users)
  return users[idx]
}

export function createUser({ name, email, password, pin = '', school = '', grade = '', role = 'student' }) {
  const users = getUsers()
  if (findUserByEmail(email)) {
    throw new Error('An account with that email already exists.')
  }
  // NOTE: This is a demo. The password is hashed with a non-cryptographic
  // function — fine for an offline single-user app, NOT for anything real.
  const user = {
    id: uid('usr'),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    school: school.trim(),
    grade: grade.trim(),
    role: role.trim(),
    passwordHash: hashPassword(password),
    pinHash: pin ? hashPin(pin) : null,
    syncPin: null,
    resetPinCode: null,
    resetPinCodeExpiresAt: null,
    resetPasswordCode: null,
    resetPasswordCodeExpiresAt: null,
    createdAt: new Date().toISOString(),
  }
  users.push(user)
  write(keys.users, users)
  return user
}

export function verifyPassword(user, password) {
  return user && user.passwordHash === hashPassword(password)
}

export function hashPin(pin) {
  return `p${hashPassword(pin)}`
}

export function verifyPin(user, pin) {
  return user && user.pinHash && user.pinHash === hashPin(pin)
}

export function isResetPinCodeValid(user, code) {
  if (!user || !user.resetPinCode || !user.resetPinCodeExpiresAt) return false
  return user.resetPinCode === code && Date.now() <= user.resetPinCodeExpiresAt
}

export function isResetPasswordCodeValid(user, code) {
  if (!user || !user.resetPasswordCode || !user.resetPasswordCodeExpiresAt) return false
  return user.resetPasswordCode === code && Date.now() <= user.resetPasswordCodeExpiresAt
}

export function sendPasswordResetCode(email) {
  const user = findUserByEmail(email)
  if (!user) return null
  const code = String(Math.floor(100000 + Math.random() * 900000))
  const expiresAt = Date.now() + 1000 * 60 * 15
  return updateUser(user.id, { resetPasswordCode: code, resetPasswordCodeExpiresAt: expiresAt })
}

export function clearPasswordResetCode(id) {
  return updateUser(id, { resetPasswordCode: null, resetPasswordCodeExpiresAt: null })
}

export function updateUser(id, patch) {
  const users = getUsers()
  const idx = users.findIndex((u) => u.id === id)
  if (idx === -1) return null
  users[idx] = { ...users[idx], ...patch }
  write(keys.users, users)
  return users[idx]
}

export function sendPinResetCode(email) {
  const user = findUserByEmail(email)
  if (!user) return null
  const code = String(Math.floor(100000 + Math.random() * 900000))
  const expiresAt = Date.now() + 1000 * 60 * 15
  return updateUser(user.id, { resetPinCode: code, resetPinCodeExpiresAt: expiresAt })
}

export function clearPinResetCode(id) {
  return updateUser(id, { resetPinCode: null, resetPinCodeExpiresAt: null })
}

export function deleteUser(id) {
  write(keys.users, getUsers().filter((u) => u.id !== id))
}

export function clearUserData() {
  write(keys.logs, [])
  write(keys.goals, [])
  write(keys.achievements, [])
  write(keys.reminders, [])
  write(keys.fired, [])
}

/* ---------- VolunteerLog ---------- */

export function listLogs() {
  return read(keys.logs, [])
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1))
}

export function createLog(data) {
  const log = {
    id: uid('log'),
    createdAt: new Date().toISOString(),
    ...data,
  }
  const logs = listLogs()
  logs.push(log)
  write(keys.logs, logs)
  return log
}

export function updateLog(id, patch) {
  const logs = listLogs()
  const idx = logs.findIndex((l) => l.id === id)
  if (idx === -1) return null
  logs[idx] = { ...logs[idx], ...patch }
  write(keys.logs, logs)
  return logs[idx]
}

export function deleteLog(id) {
  const logs = listLogs().filter((l) => l.id !== id)
  write(keys.logs, logs)
}

/* ---------- Goals ---------- */

export function listGoals() {
  return read(keys.goals, [])
}

export function upsertGoal(goal) {
  const goals = listGoals()
  const existingIdx = goals.findIndex((g) => g.id === goal.id)
  let saved
  if (existingIdx === -1) {
    saved = { id: uid('goal'), createdAt: new Date().toISOString(), ...goal }
    goals.push(saved)
  } else {
    saved = { ...goals[existingIdx], ...goal }
    goals[existingIdx] = saved
  }
  write(keys.goals, goals)
  return saved
}

export function deleteGoal(id) {
  write(keys.goals, listGoals().filter((g) => g.id !== id))
}

/* ---------- Achievements (earned ids) ---------- */

export function getEarned() {
  return read(keys.achievements, [])
}

export function markEarned(badgeId) {
  const earned = getEarned()
  if (!earned.includes(badgeId)) {
    earned.push(badgeId)
    write(keys.achievements, earned)
  }
}

/* ---------- Reminders ---------- */

export function listReminders() {
  return read(keys.reminders, [])
    .slice()
    .sort((a, b) => (a.nextAt < b.nextAt ? -1 : 1))
}

export function createReminder(data) {
  const r = {
    id: uid('rem'),
    createdAt: new Date().toISOString(),
    enabled: true,
    ...data,
  }
  const all = listReminders()
  all.push(r)
  write(keys.reminders, all)
  return r
}

export function updateReminder(id, patch) {
  const all = listReminders()
  const idx = all.findIndex((r) => r.id === id)
  if (idx === -1) return null
  all[idx] = { ...all[idx], ...patch }
  write(keys.reminders, all)
  return all[idx]
}

export function deleteReminder(id) {
  write(keys.reminders, listReminders().filter((r) => r.id !== id))
}

export function getFired() {
  return read(keys.fired, [])
}

export function markFired(id) {
  const f = getFired()
  if (!f.includes(id)) {
    f.push(id)
    write(keys.fired, f)
  }
}

export function clearFired(id) {
  write(keys.fired, getFired().filter((x) => x !== id))
}

/* ---------- Reviews ---------- */

export function getReviews() {
  return read(keys.reviews, [])
}

export function saveReview(data) {
  const review = { id: uid('rev'), ...data, submittedAt: new Date().toISOString() }
  const reviews = getReviews()
  reviews.push(review)
  write(keys.reviews, reviews)
  return review
}

/* ---------- Demo-only password "hash" ---------- */
// djb2-style — not cryptographic. Documented as such above.
export function hashPassword(pw) {
  let h = 5381
  for (let i = 0; i < pw.length; i++) h = ((h << 5) + h) ^ pw.charCodeAt(i)
  return `h${(h >>> 0).toString(36)}`
}
