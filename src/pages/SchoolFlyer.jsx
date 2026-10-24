import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { ArrowLeft, Printer, Loader2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth.jsx'
import { useSeo } from '@/hooks/useSeo.js'
import { kitCopy, shortUrl, KIT_LANGUAGES } from '@/lib/starterKit.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

// /school/flyer (#491): one printable page for a hallway or classroom — the
// school's name, a big QR code to its join link, three steps and the code.
// Always light, whatever the app theme, because it is meant for paper.
export default function SchoolFlyer() {
  useSeo({ title: 'Printable flyer', path: '/school/flyer' })
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const lang = params.get('lang') === 'es' ? 'es' : 'en'
  const [school, setSchool] = useState(null) // { name, pin }
  const [error, setError] = useState('')
  const [qr, setQr] = useState('')

  useEffect(() => {
    if (!user?.schoolId) { setError('This account is not linked to a school.'); return }
    fetch(`${apiUrl}/school/info?id=${encodeURIComponent(user.schoolId)}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` },
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok || !d.school?.pin) throw new Error(d.error || 'Could not load your school code.')
        setSchool({ name: d.school.name, pin: d.school.pin })
      })
      .catch((e) => setError(e.message))
  }, [user?.schoolId])

  const copy = school ? kitCopy(lang, { school: school.name, pin: school.pin }) : null

  useEffect(() => {
    if (!copy) return
    let cancelled = false
    QRCode.toDataURL(copy.url, { width: 900, margin: 1, errorCorrectionLevel: 'M' })
      .then((u) => !cancelled && setQr(u))
      .catch(() => {})
    return () => { cancelled = true }
  }, [copy?.url]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-earth-100 text-earth-900 pb-10 print:pb-0 print:bg-white">
      <style>{'@page { size: letter portrait; margin: 0.5in; } @media print { html, body { background: #fff !important; } }'}</style>

      <div className="print:hidden max-w-[8.5in] mx-auto px-4 py-4 flex flex-wrap items-center gap-2">
        <Link to="/school/dashboard" className="btn-sm bg-white text-earth-800 border border-earth-300 hover:bg-earth-50"><ArrowLeft className="w-4 h-4" /> Back</Link>
        <div className="flex-1" />
        {KIT_LANGUAGES.map((l) => (
          <button
            key={l.code}
            type="button"
            onClick={() => setParams({ lang: l.code }, { replace: true })}
            className={`btn-sm ${lang === l.code ? 'btn-primary' : 'bg-white text-earth-800 border border-earth-300 hover:bg-earth-50'}`}
            aria-pressed={lang === l.code}
          >
            {l.label}
          </button>
        ))}
        <button type="button" className="btn-primary" onClick={() => window.print()} disabled={!qr}>
          <Printer className="w-4 h-4" /> Print
        </button>
      </div>

      {error ? (
        <p className="max-w-[8.5in] mx-auto px-4 text-red-600">{error}</p>
      ) : !copy ? (
        <p className="max-w-[8.5in] mx-auto px-4 flex items-center gap-2 text-earth-600"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>
      ) : (
        <article
          lang={lang}
          className="mx-auto bg-white shadow-soft print:shadow-none w-full max-w-[8.5in] print:max-w-none px-8 py-10 sm:px-14 sm:py-14 print:p-0 text-center"
        >
          <div className="flex items-center justify-center gap-3">
            <img src={`${import.meta.env.BASE_URL}logo-icon.webp`} alt="" className="w-12 h-12 rounded-xl" />
            <span className="font-display text-2xl font-bold text-[#0b1a12]">VolunTrack</span>
          </div>

          <h1 className="mt-8 print:mt-6 font-display text-3xl sm:text-5xl font-extrabold leading-tight text-[#0b1a12]">{copy.flyerTitle}</h1>
          <p className="mt-4 text-lg sm:text-xl text-earth-700">{copy.flyerSub}</p>

          <div className="mt-8 print:mt-6 flex flex-col items-center">
            {qr
              ? <img src={qr} alt={copy.url} className="w-64 h-64 sm:w-80 sm:h-80 print:w-72 print:h-72" />
              : <div className="w-64 h-64 sm:w-80 sm:h-80 grid place-items-center text-earth-500"><Loader2 className="w-6 h-6 animate-spin" /></div>}
            <p className="mt-2 text-xl font-semibold text-[#2e7d32]">{copy.scan}</p>
          </div>

          <ol className="mt-8 print:mt-6 mx-auto max-w-md space-y-3 text-left">
            {copy.steps.map((s, i) => (
              <li key={i} className="flex items-start gap-3 text-lg text-earth-800">
                <span className="w-8 h-8 rounded-full bg-[#2e7d32] text-white grid place-items-center font-bold shrink-0">{i + 1}</span>
                <span className="pt-0.5">{s}</span>
              </li>
            ))}
          </ol>

          <div className="mt-8 print:mt-6 text-earth-700">
            <p>{copy.orVisit} <span className="font-semibold text-[#0b1a12] break-all">{shortUrl(copy.url)}</span></p>
            <p className="mt-1">{copy.code}: <span className="font-mono font-semibold text-[#0b1a12]">{school.pin}</span></p>
          </div>

          <p className="mt-6 text-sm text-earth-500">{copy.free}</p>
        </article>
      )}
    </div>
  )
}
