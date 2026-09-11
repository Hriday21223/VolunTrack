import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { listLogs, createLog, updateLog, deleteLog,
         listGoals, upsertGoal, deleteGoal,
         getEarned, markEarned, getReviews, saveReview,
         isReviewDismissed, dismissReview as dismissReviewApi } from '@/api/index.js'
import { evaluateAchievements } from '@/lib/achievements.js'
import { getVerificationStatus } from '@/lib/supervisorNotify.js'
import { syncCreateLog, syncUpdateLog, syncDeleteLog } from '@/lib/logSync.js'
import { useAuth } from '@/hooks/useAuth.jsx'

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
  const [showReview, setShowReview] = useState(false)
  const [reviewSubmitted, setReviewSubmitted] = useState(() => getReviews().length > 0)

  const totalHours = useMemo(() => logs.reduce((s, l) => s + (Number(l.hours) || 0), 0), [logs])

  // Local logs/goals/achievements live under one global localStorage key,
  // not scoped per account (see clearUserData() in useAuth.jsx's logout).
  // Since this provider doesn't unmount across a logout/login in the same
  // SPA session, its state must be re-read here whenever the signed-in
  // account changes — otherwise the previous account's in-memory logs stay
  // on screen after switching to a different account in the same browser.
  useEffect(() => {
    setLogs(listLogs())
    setGoals(listGoals())
    setEarned(getEarned())
    setReviewSubmitted(getReviews().length > 0)
  }, [user?.id])

  // Re-evaluate achievements whenever logs/goals change.
  useEffect(() => {
    const { newly } = evaluateAchievements(logs, goals, earned)
    if (newly.length) {
      newly.forEach(markEarned)
      setEarned((prev) => [...prev, ...newly])
      setPendingBadges(newly)
    }
  }, [logs, goals, earned])

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
      if (isStudentLike && next.length >= 1 && getReviews().length === 0 && !isReviewDismissed()) {
        setShowReview(true)
      }
      return next
    })
    // Write-through to the server for signed-in accounts, so a linked
    // parent can see it. Best-effort — a pre-existing local log created
    // before this synced never gets a serverId, and that's fine (no
    // backfill of history predating this feature).
    creatingLogsRef.current.add(log.id)
    const whenSynced = syncCreateLog(log).then((serverId) => {
      creatingLogsRef.current.delete(log.id)
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
  }, [isStudentLike])
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
  }, [])
  const removeGoal = useCallback((id) => {
    deleteGoal(id)
    setGoals((prev) => prev.filter((g) => g.id !== id))
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

  return (
    <DataContext.Provider
      value={{
        logs, goals, earned, pendingBadges, dismissBadges,
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
