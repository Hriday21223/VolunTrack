import { useEffect, useState } from 'react'
import { Heart, Check } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { ACTIVITY_CATEGORIES } from '@/lib/categories.js'
import { MAX_INTERESTS, fetchInterests, saveInterests } from '@/lib/interests.js'
import { tr } from '@/lib/i18n.js'

// Toggle chips over the activity categories. Shared by the Settings card and
// the one-time prompt on Opportunities (ForYouTasks).
export function InterestChips({ value, onChange, disabled }) {
  const toggle = (c) => {
    if (value.includes(c)) onChange(value.filter((x) => x !== c))
    else if (value.length < MAX_INTERESTS) onChange([...value, c])
  }
  return (
    <div className="flex flex-wrap gap-2">
      {ACTIVITY_CATEGORIES.map((c) => {
        const on = value.includes(c)
        return (
          <button
            key={c}
            type="button"
            onClick={() => toggle(c)}
            disabled={disabled || (!on && value.length >= MAX_INTERESTS)}
            aria-pressed={on}
            className={`btn-sm inline-flex items-center gap-1 ${on ? 'btn-primary' : 'btn-ghost border border-earth-200 dark:border-white/10'} disabled:opacity-50`}
          >
            {on && <Check className="w-3.5 h-3.5" />}
            {tr(c)}
          </button>
        )
      })}
    </div>
  )
}

// Settings: the causes the student cares about, which pick the "For you"
// tasks at the top of Opportunities.
export default function InterestsCard() {
  const [saved, setSaved] = useState(null)
  const [draft, setDraft] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchInterests()
      .then((list) => { if (!cancelled && list) { setSaved(list); setDraft(list) } })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (saved === null) return null

  const dirty = draft.length !== saved.length || draft.some((c) => !saved.includes(c))

  const save = async () => {
    setBusy(true)
    setError('')
    setMsg('')
    try {
      const list = await saveInterests(draft)
      setSaved(list)
      setDraft(list)
      setMsg(tr('Saved.'))
    } catch (e) {
      setError(e.message || tr('Could not save your interests.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <h3 className="font-display font-semibold mb-1 flex items-center gap-2">
        <Heart className="w-4 h-4 text-brand-600" /> {tr('Causes you care about')}
      </h3>
      <p className="text-sm text-earth-500 dark:text-earth-400 mb-3">
        {tr('Pick a few and Opportunities shows matching tasks first, under "For you".')}
      </p>
      <InterestChips value={draft} onChange={(v) => { setDraft(v); setMsg('') }} disabled={busy} />
      <div className="flex items-center gap-3 mt-3">
        <button type="button" onClick={save} disabled={busy || !dirty} className="btn-primary btn-sm disabled:opacity-50">
          {busy ? tr('Saving…') : tr('Save')}
        </button>
        {msg && <span className="text-sm text-brand-600 dark:text-brand-400">{msg}</span>}
      </div>
      {error && <p role="alert" className="text-sm text-red-500 mt-2">{error}</p>}
    </Card>
  )
}
