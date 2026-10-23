import { useEffect, useState } from 'react'
import { Megaphone, Check } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { ACTIVITY_CATEGORIES } from '@/lib/categories.js'
import { MAX_ABOUT, fetchMyOrganizerProfile, saveMyOrganizerProfile, isHttpsUrl } from '@/lib/organizerProfile.js'
import { tr } from '@/lib/i18n.js'

// Settings: the organizer profile shown on /organizers/:id once you post a
// volunteer task. Signed-in accounts only (renders nothing without a session).
export default function OrganizerProfileCard() {
  const [saved, setSaved] = useState(null)
  const [about, setAbout] = useState('')
  const [website, setWebsite] = useState('')
  const [causes, setCauses] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchMyOrganizerProfile()
      .then((p) => {
        if (cancelled || !p) return
        setSaved(p); setAbout(p.about); setWebsite(p.website); setCauses(p.causes)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (saved === null) return null

  const websiteOk = isHttpsUrl(website)
  const toggle = (c) => { setMsg(''); setCauses((list) => (list.includes(c) ? list.filter((x) => x !== c) : [...list, c])) }

  const save = async (e) => {
    e.preventDefault()
    if (!websiteOk) return
    setBusy(true); setError(''); setMsg('')
    try {
      const p = await saveMyOrganizerProfile({ about, website, causes })
      setSaved(p); setAbout(p.about); setWebsite(p.website); setCauses(p.causes)
      setMsg(tr('Saved.'))
    } catch (err) {
      setError(err.message || tr('Could not save your organizer profile.'))
    } finally { setBusy(false) }
  }

  return (
    <Card>
      <h3 className="font-display font-semibold mb-1 flex items-center gap-2">
        <Megaphone className="w-4 h-4 text-brand-600" /> {tr('Organizer profile')}
      </h3>
      <p className="text-sm text-earth-500 dark:text-earth-400 mb-3">
        {tr('If you post volunteer tasks, signed-in students can open your organizer page from them. It shows your name, what you write here, your upcoming tasks, your rating and the total volunteer hours given at your tasks — never your email.')}
      </p>
      <form onSubmit={save} className="space-y-3">
        <div>
          <label htmlFor="org-about" className="block text-sm font-medium mb-1">{tr('About')}</label>
          <textarea
            id="org-about"
            className="input w-full min-h-[6rem]"
            maxLength={MAX_ABOUT}
            value={about}
            onChange={(e) => { setAbout(e.target.value); setMsg('') }}
            placeholder={tr('Who you are and what volunteers will do with you.')}
          />
          <p className="text-xs text-earth-500 mt-1 text-right">{about.length}/{MAX_ABOUT}</p>
        </div>
        <div>
          <label htmlFor="org-website" className="block text-sm font-medium mb-1">{tr('Website (optional)')}</label>
          <input
            id="org-website"
            type="url"
            inputMode="url"
            className="input w-full"
            maxLength={200}
            value={website}
            onChange={(e) => { setWebsite(e.target.value); setMsg('') }}
            placeholder="https://example.org"
            aria-invalid={!websiteOk}
            aria-describedby={websiteOk ? undefined : 'org-website-err'}
          />
          {!websiteOk && <p id="org-website-err" className="text-xs text-red-500 mt-1">{tr('Use a full https:// address, like https://example.org.')}</p>}
        </div>
        <fieldset>
          <legend className="block text-sm font-medium mb-1">{tr('Causes')}</legend>
          <div className="flex flex-wrap gap-2">
            {ACTIVITY_CATEGORIES.map((c) => {
              const on = causes.includes(c)
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggle(c)}
                  disabled={busy}
                  aria-pressed={on}
                  className={`btn-sm inline-flex items-center gap-1 ${on ? 'btn-primary' : 'btn-ghost border border-earth-200 dark:border-white/10'} disabled:opacity-50`}
                >
                  {on && <Check className="w-3.5 h-3.5" />}
                  {tr(c)}
                </button>
              )
            })}
          </div>
        </fieldset>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={busy || !websiteOk} className="btn-primary btn-sm disabled:opacity-50">
            {busy ? tr('Saving…') : tr('Save')}
          </button>
          {msg && <span className="text-sm text-brand-600 dark:text-brand-400">{msg}</span>}
        </div>
        {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      </form>
    </Card>
  )
}
