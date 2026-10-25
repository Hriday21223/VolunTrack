import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { listLogs, createLog, updateLog, deleteLog,
         listGoals, upsertGoal, deleteGoal,
         getEarned, markEarned, getReviews, saveReview,
         isReviewDismissed, dismissReview as dismissReviewApi } from '@/api/index.js'
import { evaluateAchievements, countedLogs } from '@/lib/achievements.js'
import { getVerificationStatus } from '@/lib/supervisorNotify.js'
import { createLogOnServer, syncUpdateLog, syncDeleteLog, syncPullLogs, flushLogOutbox } from '@/lib/logSync.js'
import { useAuth } from '@/hooks/useAuth.jsx'
import { updateWidget } from '@/lib/widget.js'
import { hoursForGoal } from '@/lib/goalProgress.js'
import { pushGoals, syncGoals } from '@/lib/goalSync.js'

const DataContext = createContext(null)

const apiUrl = import.meta.env.VITE_API_URL || '/api'

// The facts a supervisor's approval actually attests to. Editing anything else
// (location, org contact details, proof) leaves the sign-off meaningful.
const VERIFIED_FACTS = ['date', 'activity', 'category', 'hours', 'notes']

function changesVerifiedFacts(before, patch) {
  if (!before || before.verificationStatus === 'none' || !before.verificationStatus) return false
  return VERIFIED_FACTS.some((k) => {
    if (!(k in patch)) return false
    if (k === 'hours') return Number(patch[k]) !== Number(before[k])
    return (patch[k] ?? '') !== (before[k] ?? '')
  })
}

export function DataProvider({ children }) {
  const { user } = useAuth()
  // Client-only (no-account) users have no `role` at all — only
  // server-linked accounts do. The review prompt is meant for students
  // logging their own hours, not school/parent/org/admin accounts that
  // only ever view others' hours.
  const isStudentLike = !user?.role || user.role === 'student'
  const [logs, setLogs] = useState(() => listLogs())
  const [goals, setGoals] = useState(() => listGoals())
  const [earned, setEarned] = useState(() => getEarned())
  const [pendingBadges, setPendingBadges] = useState([])
  // Invite a friend (#493): { code, joined } from the server, or null for an
  // account that can't invite (no account, under 13, not a student/volunteer).
  const [invite, setInvite] = useState(null)
  const friendsInvited = invite?.joined || 0
  const inviteSeenRef = useRef(null)
  const [showReview, setShowReview] = useState(false)
  const [reviewSubmitted, setReviewSubmitted] = useState(() => getReviews().length > 0)

  const totalHours = useMemo(() => countedLogs(logs).reduce((s, l) => s + (Number(l.hours) || 0), 0), [logs])

  // Local logs/goals/achievements live under one global localStorage key,
  // not scoped per account (see clearUserData() in useAuth.jsx's logout).
  // Since this provider doesn't unmount across a logout/login in the same
  // SPA session, its state must be re-read here whenever the signed-in
  // account changes — otherwise the previous account's in-memory logs stay
  // on screen after switching to a different account in the same browser.
  //
  // Sign-in pulls the account's server-side logs before setting the user, so
  // the history arrives here all at once. Badges it already earns are marked
  // silently: they were earned on another device, and toasting each one
  // buried a freshly installed app under a stack of "Achievement earned!".
  useEffect(() => {
    const nextLogs = listLogs()
    const nextGoals = listGoals()
    evaluateAchievements(nextLogs, nextGoals, getEarned()).newly.forEach(markEarned)
    setLogs(nextLogs)
    setGoals(nextGoals)
    setEarned(getEarned())
    setReviewSubmitted(getReviews().length > 0)
  }, [user?.id])

  const canInvite = (user?.role === 'student' || user?.role === 'volunteer') && !user?.under13
  const loadInvite = useCallback(async () => {
    const token = localStorage.getItem('voluntrack:auth_token')
    if (!canInvite || !token) { setInvite(null); return }
    try {
      const res = await fetch(`${apiUrl}/invites/mine`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return
      const data = await res.json()
      // The first count after sign-in may already earn invite badges earned
      // on another device: mark those quietly, like the logs effect above.
      if (inviteSeenRef.current !== user?.id) {
        inviteSeenRef.current = user?.id
        const { newly } = evaluateAchievements(listLogs(), listGoals(), getEarned(), { friendsInvited: data.joined })
        if (newly.length) {
          newly.forEach(markEarned)
          setEarned(getEarned())
        }
      }
      setInvite({ code: data.code, joined: Number(data.joined) || 0 })
    } catch { /* offline: try again next time */ }
  }, [canInvite, user?.id])

  // Friends join while the student is elsewhere, so look again when the tab
  // comes back into view.
  useEffect(() => {
    loadInvite()
    const onVisible = () => { if (document.visibilityState === 'visible') loadInvite() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [loadInvite])

  // Re-evaluate achievements whenever logs/goals change.
  useEffect(() => {
    const { newly } = evaluateAchievements(logs, goals, earned, { friendsInvited })
    if (newly.length) {
      newly.forEach(markEarned)
      // markEarned() dedupes what it writes, but this state update did not —
      // an effect that ran twice for one change (StrictMode, a re-render
      // between evaluations) appended the same ids again and the dashboard
      // counted "14/12 badges earned" until the next reload.
      setEarned((prev) => [...new Set([...prev, ...newly])])
      setPendingBadges(newly)
    }
  }, [logs, goals, earned, friendsInvited])

  // A log's server id only arrives after syncCreateLog resolves. An edit made
  // in that window has nothing to PATCH against, so it used to be applied
  // locally and silently never sent — leaving parents and school reports on
  // the pre-edit values forever. Park those edits here and replay them once
  // the id lands. Keyed by local log id; the Set marks creates still in
  // flight, so a genuinely unsynced local log (logged out, or predating this
  // feature) isn't queued for a flush that will never come.
  const creatingLogsRef = useRef(new Set())
  const pendingEditsRef = useRef(new Map())
  // Same window, for deletes: with no server id yet there is nothing to
  // DELETE, and the create would still land — an orphaned row that the next
  // sync-pull brings back. Remember the delete and send it once the id lands.
  const pendingDeletesRef = useRef(new Set())

  const addLog = useCallback((data) => {
    const log = createLog(data)
    setLogs((prev) => {
      const next = [log, ...prev]
      // Never for under-13 accounts: an approved review can be published
      // with the reviewer's name.
      if (isStudentLike && !user?.under13 && next.length >= 1 && getReviews().length === 0 && !isReviewDismissed()) {
        setShowReview(true)
      }
      return next
    })
    // Write-through to the server for signed-in accounts, so a linked
    // parent can see it. Best-effort — a pre-existing local log created
    // before this synced never gets a serverId, and that's fine (no
    // backfill of history predating this feature).
    creatingLogsRef.current.add(log.id)
    const whenSynced = createLogOnServer(log).then(({ id: serverId, retry }) => {
      creatingLogsRef.current.delete(log.id)
      // Couldn't reach the server: flushLogOutbox() sends it later, with any
      // edits made meanwhile (they're already on the local copy).
      if (retry && !pendingDeletesRef.current.has(log.id)) {
        pendingEditsRef.current.delete(log.id)
        const marked = updateLog(log.id, { syncPending: true })
        if (marked) setLogs((prev) => prev.map((l) => (l.id === log.id ? marked : l)))
        return null
      }
      const queued = pendingEditsRef.current.get(log.id)
      pendingEditsRef.current.delete(log.id)
      if (pendingDeletesRef.current.delete(log.id)) {
        if (serverId) syncDeleteLog(serverId)
        return null
      }
      if (serverId) {
        updateLog(log.id, { serverId }) // raw local write, doesn't re-trigger sync
        setLogs((prev) => prev.map((l) => (l.id === log.id ? { ...l, serverId } : l)))
      }
      if (serverId && queued) syncUpdateLog(serverId, queued)
      return serverId
    }).catch(() => {
      creatingLogsRef.current.delete(log.id)
      pendingEditsRef.current.delete(log.id)
      pendingDeletesRef.current.delete(log.id)
      return null
    })
    return { ...log, whenSynced }
  }, [isStudentLike, user?.under13])
  const editLog = useCallback((id, patch) => {
    // The edit form pre-fills from the existing log, so it resubmits the
    // verification fields untouched. Mirror the server's rule (PATCH
    // /api/logs/:id): if any fact a supervisor actually vouched for changes,
    // the sign-off no longer describes this log — drop it, signature included,
    // rather than leave rewritten hours wearing an "approved" badge.
    const before = listLogs().find((l) => l.id === id)
    const effective = before && changesVerifiedFacts(before, patch)
      ? { ...patch, verified: false, verificationStatus: 'none', verificationToken: null, supervisorSignature: '' }
      : patch
    const log = updateLog(id, effective)
    if (log) {
      setLogs((prev) => prev.map((l) => (l.id === id ? log : l)))
      if (log.serverId) syncUpdateLog(log.serverId, effective)
      else if (creatingLogsRef.current.has(id)) {
        // Merge, so several quick edits all survive the flush.
        pendingEditsRef.current.set(id, { ...(pendingEditsRef.current.get(id) || {}), ...effective })
      }
    }
    return log
  }, [])

  // Once per signed-in account, check any logs still awaiting a supervisor's
  // response and pick up their approve/reject decision. Keyed on user?.id: this
  // provider doesn't unmount across a logout/login in the same tab, so a plain
  // run-once guard would skip every account after the first one used.
  const checkedVerificationsFor = useRef(null)
  useEffect(() => {
    const account = user?.id ?? null
    if (checkedVerificationsFor.current === account) return
    checkedVerificationsFor.current = account
    // Decisions made on the server (a task organizer's sign-off, a supervisor
    // answering a request sent from another device) only arrive by pulling.
    // Writes that couldn't reach the server earlier go first, so the pull
    // that follows already knows their server ids.
    if (account && localStorage.getItem('voluntrack:auth_token')) {
      syncGoals(account).then((changed) => { if (changed) setGoals(listGoals()) })
      flushLogOutbox()
        .then((sent) => syncPullLogs(account).then((pulled) => sent + pulled))
        .then((n) => { if (n > 0) setLogs(listLogs()) })
    }
    const pending = listLogs().filter((l) => l.verificationStatus === 'pending' && l.verificationToken)
    pending.forEach(async (l) => {
      const result = await getVerificationStatus(l.verificationToken)
      if (result && (result.status === 'approved' || result.status === 'rejected')) {
        const log = updateLog(l.id, {
          verificationStatus: result.status,
          verified: result.status === 'approved',
          ...(result.supervisorSignature ? { supervisorSignature: result.supervisorSignature } : {}),
        })
        if (log) setLogs((prev) => prev.map((x) => (x.id === l.id ? log : x)))
      }
    })
  }, [user?.id])
  // Back online: send what queued up while the server was out of reach.
  useEffect(() => {
    const account = user?.id
    if (!account) return
    const onOnline = () => {
      if (!localStorage.getItem('voluntrack:auth_token')) return
      flushLogOutbox().then((n) => { if (n > 0) setLogs(listLogs()) })
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [user?.id])

  const removeLog = useCallback((id) => {
    const target = logs.find((l) => l.id === id)
    deleteLog(id)
    setLogs((prev) => prev.filter((l) => l.id !== id))
    if (target?.serverId) syncDeleteLog(target.serverId)
    else if (creatingLogsRef.current.has(id)) pendingDeletesRef.current.add(id)
  }, [logs])

  const saveGoal = useCallback((g) => {
    const next = upsertGoal(g)
    setGoals(next)
    pushGoals()
  }, [])
  const removeGoal = useCallback((id) => {
    deleteGoal(id)
    setGoals(listGoals())
    pushGoals()
  }, [])

  const refreshLogs = useCallback(() => setLogs(listLogs()), [])
  const dismissBadges = useCallback(() => setPendingBadges([]), [])

  const dismissReview = useCallback(() => {
    dismissReviewApi()
    setShowReview(false)
  }, [])

  const submitReview = useCallback((rating, comment, name) => {
    saveReview({ rating, comment })
    setReviewSubmitted(true)
    setShowReview(false)
    // Best-effort — the popup is already dismissed and won't reappear
    // (gated by the local flag above) regardless of whether this succeeds.
    // Works for client-only users too: no auth token is required. The
    // review only appears publicly once an admin approves it (see
    // GET /api/reviews/public and the Admin.jsx Reviews tab).
    const token = localStorage.getItem('voluntrack:auth_token')
    fetch(`${apiUrl}/reviews`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ rating, comment, name: name || null }),
    }).catch(() => {})
  }, [])

  // The Android home-screen widget shows the same numbers as the dashboard:
  // counted hours toward the primary goal (all hours when there's no goal).
  useEffect(() => {
    if (!user || (user.role !== 'student' && user.role !== 'volunteer')) {
      updateWidget({ hours: 0, goal: 0, signedIn: false })
      return
    }
    const counted = countedLogs(logs)
    const goal = goals.find((g) => g.primary) || goals[0]
    updateWidget({
      hours: goal ? hoursForGoal(goal, counted) : counted.reduce((s, l) => s + (Number(l.hours) || 0), 0),
      goal: goal ? Number(goal.targetHours) || 0 : 0,
    })
  }, [user, logs, goals])

  return (
    <DataContext.Provider
      value={{
        logs, goals, earned, pendingBadges, dismissBadges, invite, friendsInvited, loadInvite,
        addLog, editLog, removeLog, refreshLogs,
        saveGoal, removeGoal,
        showReview, reviewSubmitted, submitReview, dismissReview, totalHours,
      }}
    >
      {children}
    </DataContext.Provider>
  )
}

// Hook and provider live together on purpose (standard React context idiom).
// eslint-disable-next-line react-refresh/only-export-components
export function useData() {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used inside <DataProvider>')
  return ctx
}
