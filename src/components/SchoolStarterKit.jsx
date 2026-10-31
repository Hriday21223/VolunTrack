import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import QRCode from 'qrcode'
import { Rocket, Copy, Check, Download, Printer, Mail, MessageSquare, ClipboardList, ShieldCheck, Link2 } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { kitCopy, KIT_LANGUAGES } from '@/lib/starterKit.js'
import { tr } from '@/lib/i18n.js'

function CopyButton({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setDone(true)
      setTimeout(() => setDone(false), 1500)
    } catch { /* clipboard blocked: the text is on screen to select */ }
  }
  return (
    <button type="button" onClick={copy} className="btn-sm btn-ghost shrink-0" aria-label={label}>
      {done ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {done ? tr('Copied') : label}
    </button>
  )
}

/**
 * School starter kit (#491): everything an adviser needs to get students in —
 * the join link and its QR code, a printable flyer, messages to paste into
 * email or Google Classroom, and the first setup steps. `onOpenSetup(tab)`
 * jumps to a Setup tab; it's null for co-admins, who can't open Setup.
 */
export default function SchoolStarterKit({ pin, schoolName, onOpenSetup }) {
  const [lang, setLang] = useState('en')
  const [qr, setQr] = useState('')
  const copy = kitCopy(lang, { school: schoolName, pin })

  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(copy.url, { width: 640, margin: 2, errorCorrectionLevel: 'M' })
      .then((url) => !cancelled && setQr(url))
      .catch(() => !cancelled && setQr(''))
    return () => { cancelled = true }
  }, [copy.url])

  const downloadQr = () => {
    if (!qr) return
    const a = document.createElement('a')
    a.href = qr
    a.download = `voluntrack-join-${pin}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const steps = [
    onOpenSetup && { icon: ClipboardList, text: 'Set your hour requirement, so students see their goal.', action: () => onOpenSetup('requirements'), label: 'Set requirement' },
    onOpenSetup && { icon: ShieldCheck, text: 'Add a co-adviser to help approve hours.', action: () => onOpenSetup('staff'), label: 'Add co-adviser' },
    { icon: Link2, text: 'Share the join link or put the flyer up. Students who use it land on your roster.' },
    { icon: Check, text: 'Approve hours as they come in, here on the Students tab.' },
  ].filter(Boolean)

  return (
    <Card className="mb-4">
      <h3 className="font-semibold mb-1 flex items-center gap-2"><Rocket className="w-4 h-4 text-brand-600" />{' '}{tr('Starter kit')}</h3>
      <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">
        {tr('Get your students on VolunTrack in five minutes. Students who open your link or scan the code join {school} without typing the code.', { school: schoolName })}
      </p>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0 space-y-4">
          <div>
            <div className="label">{tr('Join link')}</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 overflow-x-auto whitespace-nowrap rounded-lg bg-earth-100 dark:bg-earth-800 px-3 py-2 font-mono text-sm">{copy.url}</code>
              <CopyButton text={copy.url} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-earth-500 dark:text-earth-400">{tr('Language for students:')}</span>
            {KIT_LANGUAGES.map((l) => (
              <button key={l.code} type="button" onClick={() => setLang(l.code)} className={`btn-sm ${lang === l.code ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={lang === l.code}>
                {l.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <Link to={`/school/flyer?lang=${lang}`} className="btn-secondary"><Printer className="w-4 h-4" />{' '}{tr('Print the flyer')}</Link>
            <button type="button" className="btn-ghost" onClick={downloadQr} disabled={!qr}><Download className="w-4 h-4" />{' '}{tr('Download QR code')}</button>
          </div>
        </div>

        {qr && (
          <img src={qr} alt={`QR code for ${copy.url}`} className="w-36 h-36 rounded-xl bg-white p-1 justify-self-center md:justify-self-end" />
        )}
      </div>

      <div className="mt-5 space-y-3">
        <div className="rounded-xl border border-earth-200 dark:border-white/10 p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-sm font-medium flex items-center gap-2"><Mail className="w-4 h-4 text-brand-600" />{' '}{tr('Email or Google Classroom')}</span>
            <CopyButton text={`${copy.emailSubject}\n\n${copy.email}`} />
          </div>
          <p className="text-xs text-earth-500 dark:text-earth-400 mb-1">{tr('Subject:')}{' '}{copy.emailSubject}</p>
          <pre className="whitespace-pre-wrap break-words font-sans text-sm text-earth-600 dark:text-earth-300 max-h-48 overflow-y-auto">{copy.email}</pre>
        </div>
        <div className="rounded-xl border border-earth-200 dark:border-white/10 p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-sm font-medium flex items-center gap-2"><MessageSquare className="w-4 h-4 text-brand-600" />{' '}{tr('Short message (Remind, group chat, Instagram)')}</span>
            <CopyButton text={copy.short} />
          </div>
          <p className="text-sm text-earth-600 dark:text-earth-300 break-words">{copy.short}</p>
        </div>
      </div>

      <div className="mt-5">
        <div className="text-sm font-medium mb-2">{tr('Set up in 5 minutes')}</div>
        <ol className="space-y-2">
          {steps.map((s, i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="w-6 h-6 rounded-full bg-brand-500/15 text-brand-600 dark:text-brand-400 grid place-items-center text-xs font-semibold shrink-0">{i + 1}</span>
              <span className="flex-1 min-w-[12rem] text-earth-600 dark:text-earth-300">{s.text}</span>
              {s.action && <button type="button" className="btn-sm btn-ghost" onClick={s.action}>{s.label}</button>}
            </li>
          ))}
        </ol>
      </div>
    </Card>
  )
}
