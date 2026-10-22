import { useCallback, useEffect, useState } from 'react'
import { Sparkles, X, MapPin, Calendar as CalIcon, Users } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { InterestChips } from '@/components/InterestsCard.jsx'
import { categoryColor } from '@/lib/categories.js'
import { fetchForYou, saveInterests, hasSession, promptDismissed, dismissPrompt } from '@/lib/interests.js'
import { fmtDate } from '@/utils/date.js'
import { tr } from '@/lib/i18n.js'
import { useAuth } from '@/hooks/useAuth.jsx'

// Top of Opportunities, students only. With interests set: a "For you" row of
// up to six upcoming open tasks in those causes (server/routes/interests.js
// applies the main list's exclusions). Without: a one-time, dismissible prompt
// to pick some. Renders nothing otherwise, and never changes the main list.
export default function ForYouTasks() {
  const { user } = useAuth()
  const enabled = user?.role === 'student' && hasSession()
  const [data, setData] = useState(null)
  const [showPrompt, setShowPrompt] = useState(() => !promptDismissed())
  const [draft, setDraft] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)

  const load = useCallback(() => {
    fetchForYou().then((d) => { if (d) setData(d) }).catch(() => {})
  }, [])
  useEffect(() => { if (enabled) load() }, [enabled, load])

  if (!enabled || !data) return null

  if (data.interests.length === 0) {
    if (!showPrompt) return null
    const close = () => { dismissPrompt(); setShowPrompt(false) }
    const save = async () => {
      setBusy(true)
      setError('')
      try {
        await saveInterests(draft)
        dismissPrompt()
        load()
      } catch (e) {
        setError(e.message || tr('Could not save your interests.'))
      } finally { setBusy(false) }
    }
    return (
      <Card padded={false} className="p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <p className="font-medium flex items-center gap-2"><Sparkles className="w-4 h-4 text-brand-400" />{tr('What causes do you care about?')}</p>
            <p className="text-xs text-earth-500 mt-1">{tr("Pick a few and we'll show matching tasks first. You can change them in Settings.")}</p>
          </div>
          <button type="button" onClick={close} className="btn-ghost btn-sm shrink-0" aria-label={tr('Not now')}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <InterestChips value={draft} onChange={setDraft} disabled={busy} />
        <div className="flex items-center gap-2 mt-3">
          <button type="button" onClick={save} disabled={busy || draft.length === 0} className="btn-primary btn-sm disabled:opacity-50">
            {busy ? tr('Saving…') : tr('Save')}
          </button>
          <button type="button" onClick={close} className="btn-ghost btn-sm">{tr('Not now')}</button>
        </div>
        {error && <p role="alert" className="text-sm text-red-500 mt-2">{error}</p>}
      </Card>
    )
  }

  if (data.tasks.length === 0) return null

  // A task that's also in the list below scrolls to its card (where the
  // sign-up button is); one hidden by the radius or filters opens in place.
  const pick = (t) => {
    const el = document.getElementById(`task-${t.id}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    else setOpen((o) => (o === t.id ? null : t.id))
  }

  return (
    <section aria-labelledby="for-you-heading">
      <h3 id="for-you-heading" className="text-sm font-semibold flex items-center gap-2 mb-2">
        <Sparkles className="w-4 h-4 text-brand-400" />{tr('For you')}
      </h3>
      <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 snap-x">
        {data.tasks.map((t) => {
          const left = Number(t.slots_total) - Number(t.slots_filled)
          return (
            <Card key={t.id} padded={false} className="p-3 w-60 shrink-0 snap-start">
              <button type="button" onClick={() => pick(t)} className="text-left w-full" aria-expanded={open === t.id}>
                <p className="font-medium text-sm line-clamp-2">{t.title}</p>
                {t.category && <span className={`chip mt-1 ${categoryColor(t.category)}`}>{tr(t.category)}</span>}
                <div className="mt-2 space-y-1 text-xs text-earth-500">
                  <p className="flex items-center gap-1"><CalIcon className="w-3 h-3" />{fmtDate(t.date)}{t.time ? ` · ${t.time}` : ''}</p>
                  {t.location && <p className="flex items-center gap-1 truncate"><MapPin className="w-3 h-3 shrink-0" />{t.location}</p>}
                  <p className="flex items-center gap-1"><Users className="w-3 h-3" />{tr('{n} spots left', { n: left })}</p>
                </div>
              </button>
              {open === t.id && (
                <div className="mt-2 text-xs text-earth-400 space-y-1">
                  {t.description && <p>{t.description}</p>}
                  <p className="text-earth-500">{tr('Not in the list below — widen the radius or clear filters to sign up.')}</p>
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </section>
  )
}
