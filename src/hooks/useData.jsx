import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { listLogs, createLog, updateLog, deleteLog,
         listGoals, upsertGoal, deleteGoal,
         getEarned, markEarned, getReviews, saveReview } from '@/api/index.js'
import { evaluateAchievements } from '@/lib/achievements.js'
import { getVerificationStatus } from '@/lib/supervisorNotify.js'
import { syncCreateLog, syncUpdateLog, syncDeleteLog } from '@/lib/logSync.js'
import { useAuth } from '@/hooks/useAuth.jsx'

const DataContext = createContext(null)

const apiUrl = import.meta.env.VITE_API_URL || '/api'

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

  // Re-evaluate achievements whenever logs/goals change.
  useEffect(() => {
    const { newly } = evaluateAchievements(logs, goals, earned)
    if (newly.length) {
      newly.forEach(markEarned)
      setEarned((prev) => [...prev, ...newly])
      setPendingBadges(newly)
    }
  }, [logs, goals, earned])

  const addLog = useCallback((data) => {
    const log = createLog(data)
    setLogs((prev) => {
      const next = [log, ...prev]
      if (isStudentLike && next.length >= 1 && getReviews().length === 0) {
        setShowReview(true)
      }
      return next
    })
    // Write-through to the server for signed-in accounts, so a linked
    // parent can see it. Best-effort — a pre-existing local log created
    // before this synced never gets a serverId, and that's fine (no
    // backfill of history predating this feature).
    const whenSynced = syncCreateLog(log).then((serverId) => {
      if (serverId) {
        updateLog(log.id, { serverId }) // raw local write, doesn't re-trigger sync
        setLogs((prev) => prev.map((l) => (l.id === log.id ? { ...l, serverId } : l)))
      }
      return serverId
    })
    return { ...log, whenSynced }
  }, [isStudentLike])
  const editLog = useCallback((id, patch) => {
    const log = updateLog(id, patch)
    if (log) {
      setLogs((prev) => prev.map((l) => (l.id === id ? log : l)))
      if (log.serverId) syncUpdateLog(log.serverId, patch)
    }
    return log
  }, [])

  // Once per session, check any logs still awaiting a supervisor's response
  // and pick up their approve/reject decision.
  const checkedVerifications = useRef(false)
  useEffect(() => {
    if (checkedVerifications.current) return
    checkedVerifications.current = true
    const pending = listLogs().filter((l) => l.verificationStatus === 'pending' && l.verificationToken)
    pending.forEach(async (l) => {
      const result = await getVerificationStatus(l.verificationToken)
      if (result && (result.status === 'approved' || result.status === 'rejected')) {
        const log = updateLog(l.id, { verificationStatus: result.status, verified: result.status === 'approved' })
        if (log) setLogs((prev) => prev.map((x) => (x.id === l.id ? log : x)))
      }
    })
  }, [])
  const removeLog = useCallback((id) => {
    const target = logs.find((l) => l.id === id)
    deleteLog(id)
    setLogs((prev) => prev.filter((l) => l.id !== id))
    if (target?.serverId) syncDeleteLog(target.serverId)
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

  const submitReview = useCallback((rating, comment) => {
    saveReview({ rating, comment })
    setReviewSubmitted(true)
    setShowReview(false)
    // Best-effort — the popup is already dismissed and won't reappear
    // (gated by the local flag above) regardless of whether this succeeds.
    // Works for client-only users too: no auth token is required.
    const token = localStorage.getItem('voluntrack:auth_token')
    fetch(`${apiUrl}/reviews`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ rating, comment }),
    }).catch(() => {})
  }, [])

  return (
    <DataContext.Provider
      value={{
        logs, goals, earned, pendingBadges, dismissBadges,
        addLog, editLog, removeLog, refreshLogs,
        saveGoal, removeGoal,
        showReview, reviewSubmitted, submitReview, totalHours,
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
