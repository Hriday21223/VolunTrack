import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { isNativeApp } from '@/lib/platform.js'
import { useNavigate, useParams } from 'react-router-dom'
import { Lock, LogIn, LogOut, CheckCircle, Delete } from 'lucide-react'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })
const CODE_KEY = 'voluntrack:kiosk-exit-code'
const SITE = (isNativeApp && import.meta.env.VITE_SITE_URL) || window.location.origin

// The same changing code as Check-in QR: a volunteer signed in on their phone
// scans it, then still types their PIN there (#668).
function KioskQr({ taskId }) {
  const canvas = useRef(null)
  const [code, setCode] = useState(null)
  useEffect(() => {
    let live = true
    let timer
    const load = async () => {
      try {
        const res = await fetch(`${apiUrl}/school/public-tasks/${taskId}/checkin`, { headers: headers() })
        const d = await res.json()
        if (!live || !res.ok) return
        setCode(d.code)
        timer = setTimeout(load, Math.max(5, d.refreshIn || 60) * 1000)
      } catch { timer = setTimeout(load, 15000) }
    }
    load()
    return () => { live = false; clearTimeout(timer) }
  }, [taskId])
  useEffect(() => {
    if (code && canvas.current) QRCode.toCanvas(canvas.current, `${SITE}/checkin/${taskId}?c=${encodeURIComponent(code)}`, { width: 220, margin: 2 }, () => {})
  }, [code, taskId])
  return (
    <div className="rounded-2xl bg-white/5 p-4 text-center">
      <p className="font-semibold mb-2">{tr('Or scan with your phone')}</p>
      <canvas ref={canvas} className="mx-auto rounded-lg bg-white" aria-label={tr('Check-in QR code')} />
      <p className="text-xs text-white/60 mt-2">{tr('Sign in on your phone and scan. A code appears under your name here: type it on your phone.')}</p>
    </div>
  )
}

function Keypad({ length, value, onChange, onDone }) {
  const press = (d) => { if (value.length < length) { const v = value + d; onChange(v); if (v.length === length) onDone?.(v) } }
  return (
    <div>
      <div className="flex justify-center gap-2 mb-5" aria-live="polite">
        {Array.from({ length }, (_, i) => <span key={i} className={`w-10 h-12 rounded-lg border-2 flex items-center justify-center text-2xl ${i < value.length ? 'border-emerald-400' : 'border-white/20'}`}>{i < value.length ? '•' : ''}</span>)}
      </div>
      <div className="grid grid-cols-3 gap-3 max-w-xs mx-auto">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} type="button" onClick={() => press(d)} className="h-16 rounded-xl bg-white/10 text-2xl font-semibold active:bg-white/20">{d}</button>)}
        <span />
        <button type="button" onClick={() => press('0')} className="h-16 rounded-xl bg-white/10 text-2xl font-semibold active:bg-white/20">0</button>
        <button type="button" onClick={() => onChange(value.slice(0, -1))} className="h-16 rounded-xl bg-white/5 flex items-center justify-center" aria-label={tr('Delete')}><Delete className="w-6 h-6" /></button>
      </div>
    </div>
  )
}

// Event check-in kiosk (#668): runs on the organizer's own signed-in tablet on
// the event day. A volunteer taps their name and types the 6-digit PIN they
// were emailed when approved: once on arrival, once when leaving.
export default function Kiosk() {
  const { taskId } = useParams()
  const nav = useNavigate()
  const [exitCode, setExitCode] = useState(() => { try { return sessionStorage.getItem(`${CODE_KEY}:${taskId}`) || '' } catch { return '' } })
  const [newCode, setNewCode] = useState('')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [who, setWho] = useState(null)
  const [pin, setPin] = useState('')
  const [result, setResult] = useState(null)
  const [organizer, setOrganizer] = useState(null) // { action: 'exit' | 'unlock', person }
  const [orgCode, setOrgCode] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/school/public-tasks/${taskId}/kiosk`, { headers: headers() })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || tr('Could not open the kiosk.'))
      setData(body); setError('')
    } catch (e) { setError(e.message) }
  }, [taskId])
  useEffect(() => { if (exitCode) { load(); const t = setInterval(load, 3000); return () => clearInterval(t) } return undefined }, [exitCode, load])

  const submit = async (value) => {
    try {
      const res = await fetch(`${apiUrl}/school/public-tasks/${taskId}/kiosk/${who.signupId}`, { method: 'POST', headers: headers(), body: JSON.stringify({ pin: value }) })
      const body = await res.json().catch(() => ({}))
      setResult(res.ok ? { ok: true, ...body } : { ok: false, message: body.error || tr('Something went wrong.') })
    } catch { setResult({ ok: false, message: tr('Couldn’t reach VolunTrack. Check the internet connection.') }) }
    setPin('')
    load()
    setTimeout(() => { setResult(null); setWho(null) }, 3500)
  }

  const organizerDone = async (code) => {
    if (code !== exitCode) { setOrgCode(''); return }
    if (organizer.action === 'exit') {
      try { sessionStorage.removeItem(`${CODE_KEY}:${taskId}`) } catch { /* ignore */ }
      nav('/my-tasks'); return
    }
    await fetch(`${apiUrl}/school/public-tasks/${taskId}/kiosk/${organizer.person.signupId}`, { method: 'POST', headers: headers(), body: JSON.stringify({ unlock: true }) })
    setOrganizer(null); setOrgCode(''); load()
  }

  const shell = (children) => <div className="min-h-screen bg-[#0d1712] text-white p-4 sm:p-8">{children}</div>

  if (!exitCode) {
    return shell(
      <div className="max-w-sm mx-auto text-center pt-10">
        <h1 className="text-2xl font-bold mb-2">{tr('Set a kiosk exit code')}</h1>
        <p className="text-white/70 mb-6">{tr('Pick 4 digits only you know. You’ll need them to leave the kiosk or unlock a name, so volunteers can’t get into your account.')}</p>
        <Keypad length={4} value={newCode} onChange={setNewCode} onDone={(v) => { try { sessionStorage.setItem(`${CODE_KEY}:${taskId}`, v) } catch { /* ignore */ } setExitCode(v) }} />
      </div>,
    )
  }

  return shell(
    <>
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <p className="text-sm text-white/60">{tr('Check in and out')}</p>
          <h1 className="text-2xl sm:text-3xl font-bold">{data?.title || tr('Loading…')}</h1>
        </div>
        <button type="button" className="text-sm text-white/60 underline" onClick={() => setOrganizer({ action: 'exit' })}>{tr('Organizer: exit kiosk')}</button>
      </div>
      {error && <p role="alert" className="text-red-300 mb-4">{error}</p>}
      <p className="text-white/70 mb-4">{tr('Tap your name, then enter the 6-digit PIN from your approval email.')}</p>
      <div className="grid lg:grid-cols-[1fr_260px] gap-6 items-start">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {(data?.people || []).map((p) => (
          <button key={p.signupId} type="button" disabled={!p.hasPin}
            onClick={() => (p.locked ? setOrganizer({ action: 'unlock', person: p }) : setWho(p))}
            className={`rounded-2xl p-4 text-left min-h-[84px] ${p.checkedOutAt ? 'bg-emerald-900/40' : p.checkedInAt ? 'bg-amber-900/30' : 'bg-white/10'} ${p.locked ? 'opacity-60' : ''}`}>
            <span className="block text-lg font-semibold">{p.name}</span>
            {p.screenCode && <span className="block text-3xl font-bold tracking-[0.3em] text-yellow-300 my-1" aria-label={tr('Code for {name}', { name: p.name })}>{p.screenCode}</span>}
            <span className="text-sm text-white/70 flex items-center gap-1">
              {p.locked ? <><Lock className="w-4 h-4" />{tr('Locked')}</> : p.checkedOutAt ? <><CheckCircle className="w-4 h-4" />{tr('Done')}</> : p.checkedInAt ? <><LogIn className="w-4 h-4" />{tr('Here')}</> : !p.hasPin ? tr('No PIN') : tr('Not yet')}
            </span>
          </button>
        ))}
      </div>
      <KioskQr taskId={taskId} />
      </div>

      {who && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="bg-[#14241b] rounded-2xl p-6 w-full max-w-sm text-center">
            {result ? (
              <div className="py-6">
                {result.ok ? (
                  <>
                    {result.state === 'checked_out' ? <LogOut className="w-12 h-12 mx-auto text-emerald-400" /> : <CheckCircle className="w-12 h-12 mx-auto text-emerald-400" />}
                    <p className="text-xl font-semibold mt-3">
                      {result.state === 'checked_in' ? (result.tooSoon ? tr('You’re checked in. Come back when you leave.') : tr('Welcome, {name}! You’re checked in.', { name: who.name }))
                        : result.state === 'checked_out' ? (result.leftEarly
                          ? tr('Thanks, {name}! You stayed {stayed} of {minimum} minutes, so the organizer will review your hours.', { name: who.name, stayed: result.leftEarly.stayed, minimum: result.leftEarly.minimum })
                          : tr('Thanks, {name}! {n} hours sent to the organizer to sign.', { name: who.name, n: result.hours }))
                          : tr('You’re all done for today.')}
                    </p>
                  </>
                ) : <p className="text-lg text-red-300">{result.message}</p>}
              </div>
            ) : (
              <>
                <p className="text-lg font-semibold mb-4">{who.name}</p>
                <Keypad length={6} value={pin} onChange={setPin} onDone={submit} />
                <button type="button" className="mt-5 text-white/60 underline" onClick={() => { setWho(null); setPin('') }}>{tr('Cancel')}</button>
              </>
            )}
          </div>
        </div>
      )}

      {organizer && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="bg-[#14241b] rounded-2xl p-6 w-full max-w-sm text-center">
            <p className="text-lg font-semibold mb-1">{organizer.action === 'exit' ? tr('Exit kiosk') : tr('Unlock {name}', { name: organizer.person.name })}</p>
            <p className="text-sm text-white/60 mb-4">{tr('Organizer: enter your 4-digit kiosk code.')}</p>
            <Keypad length={4} value={orgCode} onChange={setOrgCode} onDone={organizerDone} />
            <button type="button" className="mt-5 text-white/60 underline" onClick={() => { setOrganizer(null); setOrgCode('') }}>{tr('Cancel')}</button>
          </div>
        </div>
      )}
    </>,
  )
}
