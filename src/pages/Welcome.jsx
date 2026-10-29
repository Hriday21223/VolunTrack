import GradePicker from '@/components/GradePicker.jsx'
import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowRight, Award, CalendarDays, Check, GraduationCap, Hash, School, Sparkles, Target } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth.jsx'
import { useData } from '@/hooks/useData.jsx'
import Card from '@/components/Card.jsx'
import { clearWelcomePending, readWelcomePending } from '@/lib/welcome.js'

// Starting points, not rules — every school and society sets its own number,
// so the hours stay editable and the copy says "a common target".
const PRESETS = [
  { id: 'honor', icon: Award, label: 'NHS or honor society', title: 'Honor society service hours', hours: 40 },
  { id: 'graduation', icon: GraduationCap, label: 'Graduation requirement', title: 'Graduation service hours', hours: 40 },
  { id: 'award', icon: Sparkles, label: 'Scholarship or award', title: 'Scholarship service hours', hours: 100 },
  { id: 'custom', icon: Target, label: 'My own goal', title: '', hours: 25 },
]

// One-time setup after sign-up (#284): a goal so the dashboard ring means
// something on day one, and — for students with a server account — the result
// of the school code they typed at sign-up, which used to be dropped silently.
export default function Welcome() {
  const { user, refreshUser } = useAuth()
  const { goals, saveGoal } = useData()
  const nav = useNavigate()
  const apiUrl = import.meta.env.VITE_API_URL || '/api'

  // Read once, then clear, so Home() stops sending this tab here — leaving
  // /welcome any way at all (finish, skip, the address bar) ends the step.
  const [pending] = useState(() => readWelcomePending())
  useEffect(() => { clearWelcomePending() }, [])

  const hasServerAccount = Boolean(localStorage.getItem('voluntrack:auth_token'))
  // POST /school/join is student-only; volunteers and local-only accounts
  // have no school to join here.
  const showSchool = user?.role === 'student' && hasServerAccount
  const steps = showSchool ? ['goal', 'school'] : ['goal']
  const [step, setStep] = useState(0)

  const [preset, setPreset] = useState('')
  const [goal, setGoal] = useState({ title: '', targetHours: '', deadline: '' })
  const [goalErr, setGoalErr] = useState('')

  const [schoolCode, setSchoolCode] = useState(pending?.schoolCode || '')
  // idle | busy | linked | transfer | error
  const [join, setJoin] = useState({ status: 'idle', message: '' })

  // A school that set its grades asks for one (#581).
  const [gradeAsk, setGradeAsk] = useState(null)
  const joinSchool = async (code, grade = null) => {
    const pin = String(code || '').trim()
    if (!pin) return
    setJoin({ status: 'busy', message: '' })
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pin, ...(grade ? { grade } : {}) }),
      })
      const data = await res.json().catch(() => ({}))
      if (data.needsGrade) { setGradeAsk({ pin, grades: data.grades || [], schoolName: data.schoolName }); setJoin({ status: 'idle', message: '' }); return }
      setGradeAsk(null)
      // 409 means this account is already on that school's roster — the
      // outcome the student wanted, so it reads as success.
      if (res.status === 409) { setJoin({ status: 'linked', message: '' }); return }
      if (!res.ok) throw new Error(data.error || 'Could not join that school.')
      if (data.pending) { setJoin({ status: 'transfer', message: data.message || '' }); return }
      setJoin({ status: 'linked', message: '' })
      refreshUser()
    } catch (e) {
      setJoin({ status: 'error', message: e.message })
    }
  }

  // Try the sign-up code straight away, so the school step opens on an answer.
  const triedSignupCode = useRef(false)
  useEffect(() => {
    if (triedSignupCode.current || !showSchool || !pending?.schoolCode) return
    triedSignupCode.current = true
    joinSchool(pending.schoolCode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSchool])

  if (!user) return <Navigate to="/login" replace />

  const finish = () => nav('/', { replace: true })
  const next = () => (step + 1 < steps.length ? setStep(step + 1) : finish())

  const choosePreset = (p) => {
    setPreset(p.id)
    setGoalErr('')
    setGoal((g) => ({ ...g, title: p.title, targetHours: String(p.hours) }))
  }

  const saveAndContinue = (e) => {
    e.preventDefault()
    const hours = Number(goal.targetHours)
    if (!goal.title.trim()) { setGoalErr('Give your goal a name.'); return }
    if (!(hours > 0) || hours > 10000) { setGoalErr('Enter how many hours you are aiming for.'); return }
    saveGoal({
      title: goal.title.trim(),
      targetHours: hours,
      deadline: goal.deadline || null,
      // Don't take the dashboard ring away from a goal that already has it.
      primary: !goals.some((g) => g.primary),
    })
    next()
  }

  const firstName = (user.name || '').split(' ')[0]

  return (
    <div className="min-h-screen grid place-items-center px-4 py-8 page-shell">
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-2.5 justify-center mb-6">
          <img src={`${import.meta.env.BASE_URL}logo-icon.webp`} alt="" className="w-10 h-10 object-contain" />
          <span className="font-display font-bold text-2xl">VolunTrack</span>
        </div>

        <Card padded={false} className="p-7 animate-fade-in-up">
          {steps.length > 1 && (
            <div className="flex items-center gap-2 mb-5" aria-label={`Step ${step + 1} of ${steps.length}`}>
              {steps.map((s, i) => (
                <span key={s} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-brand-500' : 'bg-earth-200 dark:bg-earth-800'}`} />
              ))}
            </div>
          )}

          {steps[step] === 'goal' && (
            <form onSubmit={saveAndContinue} className="space-y-5">
              <div>
                <h1 className="text-2xl font-bold mb-1">Welcome{firstName ? `, ${firstName}` : ''}! What are you working toward?</h1>
                <p className="text-sm text-earth-500 dark:text-earth-400">
                  Set a goal and your dashboard will show how close you are. You can change it any time in Settings.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => choosePreset(p)}
                    aria-pressed={preset === p.id}
                    className={`flex items-start gap-2.5 p-3 rounded-2xl border-2 text-left text-sm font-medium transition ${
                      preset === p.id
                        ? 'border-brand-500 bg-brand-500/10'
                        : 'border-earth-200 dark:border-earth-800 hover:border-earth-300 dark:hover:border-earth-700'
                    }`}
                  >
                    <p.icon className={`w-4 h-4 mt-0.5 shrink-0 ${preset === p.id ? 'text-brand-500' : 'text-earth-400'}`} />
                    <span>{p.label}</span>
                  </button>
                ))}
              </div>

              {preset && (
                <div className="space-y-4 animate-fade-in-up">
                  <div>
                    <label className="label" htmlFor="welcome-goal-title">Goal name</label>
                    <input id="welcome-goal-title" className="input" value={goal.title} onChange={(e) => setGoal({ ...goal, title: e.target.value })} placeholder="e.g. Summer service hours" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label" htmlFor="welcome-goal-hours">Hours</label>
                      <input id="welcome-goal-hours" className="input" type="number" min="1" max="10000" step="any" inputMode="decimal" value={goal.targetHours} onChange={(e) => setGoal({ ...goal, targetHours: e.target.value })} />
                    </div>
                    <div>
                      <label className="label" htmlFor="welcome-goal-deadline">Due by (optional)</label>
                      <div className="relative">
                        <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-earth-400 pointer-events-none" />
                        <input id="welcome-goal-deadline" className="input pl-9" type="date" value={goal.deadline} onChange={(e) => setGoal({ ...goal, deadline: e.target.value })} />
                      </div>
                    </div>
                  </div>
                  {preset !== 'custom' && (
                    <p className="text-xs text-earth-500 dark:text-earth-400">
                      {goal.targetHours || PRESETS.find((p) => p.id === preset)?.hours} hours is a common target — check the number your school or program asks for.
                    </p>
                  )}
                </div>
              )}

              {goalErr && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-300 px-3 py-2 rounded-lg">{goalErr}</div>}

              <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-between">
                <button type="button" className="btn-ghost" onClick={next}>Skip for now</button>
                <button type="submit" className="btn-primary" disabled={!preset}>
                  Save goal <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </form>
          )}

          {steps[step] === 'school' && (
            <div className="space-y-5">
              <div>
                <h1 className="text-2xl font-bold mb-1">Link your school</h1>
                <p className="text-sm text-earth-500 dark:text-earth-400">
                  If your school uses VolunTrack, its code lets your coordinator review and approve your hours. No code? Skip this — you can add one later in Settings.
                </p>
              </div>

              {join.status === 'linked' ? (
                <div className="flex items-start gap-3 rounded-2xl border border-brand-500/40 bg-brand-500/10 p-4 text-sm">
                  <Check className="w-5 h-5 text-brand-500 shrink-0" />
                  <span>You&apos;re linked to your school. Hours you log will show up for your coordinator to review.</span>
                </div>
              ) : join.status === 'transfer' ? (
                <div className="flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
                  <School className="w-5 h-5 text-amber-500 shrink-0" />
                  <span>{join.message || 'Your school has been asked to accept you.'}</span>
                </div>
              ) : (
                gradeAsk ? (
                  <GradePicker grades={gradeAsk.grades} schoolName={gradeAsk.schoolName} busy={join.status === 'busy'} onPick={(g) => joinSchool(gradeAsk.pin, g)} />
                ) : (
                <form onSubmit={(e) => { e.preventDefault(); joinSchool(schoolCode) }} className="space-y-3">
                  {join.status === 'error' && (
                    <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-300 px-3 py-2 rounded-lg" role="alert">
                      {pending?.schoolCode && schoolCode === pending.schoolCode
                        ? <>We couldn&apos;t link the code you entered at sign-up: {join.message} Check it and try again.</>
                        : join.message}
                    </div>
                  )}
                  <div>
                    <label className="label" htmlFor="welcome-school-code">School code</label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-earth-400 pointer-events-none" />
                        <input id="welcome-school-code" className="input pl-9" value={schoolCode} onChange={(e) => setSchoolCode(e.target.value)} placeholder="cisd-12345" autoComplete="off" />
                      </div>
                      <button type="submit" className="btn-secondary" disabled={!schoolCode.trim() || join.status === 'busy'}>
                        {join.status === 'busy' ? 'Linking…' : 'Link'}
                      </button>
                    </div>
                  </div>
                </form>
                )
              )}

              <div className="flex justify-end">
                {join.status === 'linked' || join.status === 'transfer' ? (
                  <button type="button" className="btn-primary" onClick={finish}>
                    Go to my dashboard <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button type="button" className="btn-ghost" onClick={finish} disabled={join.status === 'busy'}>
                    Skip for now <ArrowRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
