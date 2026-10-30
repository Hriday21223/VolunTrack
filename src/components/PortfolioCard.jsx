import { useEffect, useState } from 'react'
import { Globe, Copy, CheckCircle2, RefreshCw, ExternalLink } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { tr } from '@/lib/i18n.js'
import {
  hasServerSession, getMyPortfolio, saveMyPortfolio, resetMyPortfolioLink, portfolioUrl,
} from '@/lib/portfolio.js'

// Settings → Volunteer portfolio (students). An opt-in public page with the
// student's approved hours, to put on a college application. Off by default;
// the link is the only key to it, and "Get a new link" kills the old one.
const SHOW_OPTIONS = [
  { key: 'showCategories', label: () => tr('Hours by category') },
  { key: 'showSkills', label: () => tr('Top skills') },
  { key: 'showBadges', label: () => tr('Badges') },
  { key: 'showActivities', label: () => tr('List of activities (title, date and hours)') },
  { key: 'showSchool', label: () => tr('My school') },
]

export default function PortfolioCard() {
  const [state, setState] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const signedIn = hasServerSession()

  useEffect(() => {
    if (!signedIn) return
    let live = true
    getMyPortfolio()
      .then((data) => { if (live) setState(data) })
      .catch((e) => { if (live) setError(e.message) })
    return () => { live = false }
  }, [signedIn])

  if (!signedIn) return null

  const run = async (fn) => {
    setBusy(true)
    setError('')
    try {
      setState(await fn())
      return true
    } catch (e) {
      setError(e.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const setEnabled = (enabled) => run(() => saveMyPortfolio({ enabled, options: state?.options }))
  const setOption = (key, value) => run(() => saveMyPortfolio({ options: { ...state.options, [key]: value } }))
  const reset = async () => {
    if (await run(resetMyPortfolioLink)) {
      setConfirmReset(false)
      setCopied(false)
    }
  }

  const url = state?.path ? portfolioUrl(state.path) : ''
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError(tr('Could not copy. Select the link and copy it yourself.'))
    }
  }

  const enabled = Boolean(state?.enabled)
  const canEnable = state?.canEnable !== false

  return (
    <Card>
      <h3 className="font-display font-semibold mb-3 flex items-center gap-2">
        <Globe className="w-4 h-4 text-brand-600" /> {tr('Volunteer portfolio')}
      </h3>
      <p className="text-sm text-earth-500 dark:text-earth-400 mb-3">
        {tr('A public page with your approved volunteer hours that you can put on a college application. Only people you give the link to can find it, and search engines are asked not to list it.')}
      </p>

      {!state ? (
        !error && <p className="text-sm text-earth-500 dark:text-earth-400">{tr('Loading…')}</p>
      ) : !canEnable && !enabled ? (
        <p className="text-sm text-earth-500 dark:text-earth-400">{tr('Public portfolios are for students 13 and older.')}</p>
      ) : (
        <div className="space-y-4">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span className="text-sm font-medium">{tr('Share my portfolio')}</span>
            <input
              type="checkbox"
              role="switch"
              className="w-5 h-5 accent-brand-600"
              checked={enabled}
              disabled={busy}
              onChange={(e) => setEnabled(e.target.checked)}
            />
          </label>

          {enabled && url && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input readOnly value={url} onFocus={(e) => e.target.select()} className="input flex-1 min-w-0 text-xs" aria-label={tr('Portfolio link')} />
                <button onClick={copy} className="btn-secondary inline-flex items-center gap-1.5 shrink-0 text-sm">
                  {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? tr('Copied') : tr('Copy link')}
                </button>
              </div>
              <a href={url} target="_blank" rel="noopener noreferrer" className="btn-primary inline-flex items-center gap-2 text-sm">
                <ExternalLink className="w-4 h-4" /> {tr('Open my page')}
              </a>
            </div>
          )}

          <fieldset className="space-y-2" disabled={busy}>
            <legend className="text-sm font-medium mb-1">{tr('What your page shows')}</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="portfolio-name"
                className="accent-brand-600"
                checked={state.options.nameDisplay !== 'full'}
                onChange={() => setOption('nameDisplay', 'first_initial')}
              />
              {tr('First name and last initial')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="portfolio-name"
                className="accent-brand-600"
                checked={state.options.nameDisplay === 'full'}
                onChange={() => setOption('nameDisplay', 'full')}
              />
              {tr('Full name')}
            </label>
            {SHOW_OPTIONS.map((o) => (
              <label key={o.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-brand-600"
                  checked={Boolean(state.options[o.key])}
                  onChange={(e) => setOption(o.key, e.target.checked)}
                />
                {o.label()}
              </label>
            ))}
            <p className="text-xs text-earth-500 dark:text-earth-400">
              {tr('Only hours an organizer or supervisor approved are shown. Never where you volunteered, who supervised you, your notes, proof or signatures.')}
            </p>
          </fieldset>

          {state.slug && (
            confirmReset ? (
              <div className="rounded-xl border border-white/10 p-3 space-y-2">
                <p className="text-sm">{tr('Get a new link? The old one stops working right away, so anyone you gave it to will need the new one.')}</p>
                <div className="flex gap-2">
                  <button onClick={reset} disabled={busy} className="btn-danger flex-1 text-sm">{busy ? tr('Making a new link…') : tr('Yes, get a new link')}</button>
                  <button onClick={() => setConfirmReset(false)} disabled={busy} className="btn-ghost flex-1 text-sm">{tr('No')}</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setConfirmReset(true)} className="btn-ghost inline-flex items-center gap-2 text-sm">
                <RefreshCw className="w-4 h-4" /> {tr('Get a new link')}
              </button>
            )
          )}
          {enabled
            ? <p className="text-xs text-amber-500">{tr('Anyone with the link can see this page. Turn sharing off and it stops working at once.')}</p>
            : state.slug && <p className="text-xs text-earth-500 dark:text-earth-400">{tr('Your page is off, so the link shows nothing. Turning it back on brings the same link back.')}</p>}
        </div>
      )}
      {error && <p className="text-sm text-red-400 mt-2" role="alert">{error}</p>}
    </Card>
  )
}
