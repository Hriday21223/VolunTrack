import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PenLine, Copy, Check, ChevronDown } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { fmtDate } from '@/utils/date.js'
import { tr } from '@/lib/i18n.js'

// Reports → My reflections (#510): every "What did you learn?" the student
// wrote, newest first, to reuse in NHS reflections, scholarships and essays.
export default function ReflectionsCard({ logs }) {
  const written = useMemo(
    () => logs.filter((l) => String(l.reflection || '').trim()).sort((a, b) => String(b.date).localeCompare(String(a.date))),
    [logs],
  )
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const copyAll = async () => {
    const text = written.map((l) => `${fmtDate(l.date)} · ${l.activity}${l.orgName ? ` (${l.orgName})` : ''}\n${l.reflection.trim()}`).join('\n\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard blocked: the text is on screen */ }
  }

  return (
    <Card>
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-start justify-between gap-3 text-left" aria-expanded={open}>
        <span>
          <span className="font-display font-semibold flex items-center gap-2">
            <PenLine className="w-4 h-4 text-brand-600" />{' '}{tr('My reflections')}
            {written.length > 0 && <span className="chip bg-brand-500/10 text-brand-700 dark:text-brand-300">{written.length}</span>}
          </span>
          <span className="block text-sm text-earth-500 dark:text-earth-400 mt-0.5">{tr('What you learned, all in one place. Only you can see these.')}</span>
        </span>
        <ChevronDown className={`w-5 h-5 mt-0.5 shrink-0 text-earth-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        written.length === 0 ? (
          <p className="mt-4 text-sm text-earth-500 dark:text-earth-400">
            {tr('None yet. Next time you')}{' '}<Link to="/log" className="text-brand-700 dark:text-brand-300 font-medium hover:underline">{tr('log hours')}</Link>{tr(', fill in “What did you learn?”.')}
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            <button type="button" onClick={copyAll} className="btn-secondary btn-sm w-full">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{' '}{copied ? tr('Copied') : tr('Copy all')}
            </button>
            <ul className="space-y-3">
              {written.map((l) => (
                <li key={l.id} className="rounded-xl border border-earth-200 dark:border-earth-700 p-3">
                  <p className="text-xs text-earth-500 dark:text-earth-400">{fmtDate(l.date)} · {l.activity}{l.orgName ? ` · ${l.orgName}` : ''}</p>
                  <p className="text-sm mt-1 whitespace-pre-line">{l.reflection.trim()}</p>
                </li>
              ))}
            </ul>
          </div>
        )
      )}
    </Card>
  )
}
