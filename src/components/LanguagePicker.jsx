import { useState } from 'react'
import { Globe, X } from 'lucide-react'
import { LANGUAGES, language, setLanguage, tr } from '@/lib/i18n.js'
import { isNativeApp } from '@/lib/platform.js'

const SITE = (import.meta.env.VITE_SITE_URL || 'https://volunteer-track-two.vercel.app').replace(/\/$/, '')

// Choosing a language reloads the page in it (src/lib/i18n.js). Each option
// is written in its own language, so someone who can't read the current one
// still finds theirs. "Other language…" explains the browser's own translate
// for any language we don't ship (#720); src/lib/translateGuard.js keeps it
// from crashing the app.
export default function LanguagePicker({ className = '', compact = false }) {
  const [helpOpen, setHelpOpen] = useState(false)
  return (
    <>
      <label className={`inline-flex items-center gap-2 text-sm ${className}`}>
        <Globe className="w-4 h-4 text-earth-400" aria-hidden="true" />
        {!compact && <span className="text-earth-400">{tr('Language')}</span>}
        <select
          value={language}
          onChange={(e) => (e.target.value === 'other' ? setHelpOpen(true) : setLanguage(e.target.value))}
          className="input py-1 px-2 text-sm w-auto"
          aria-label={tr('Language')}
        >
          {LANGUAGES.map((l) => <option key={l.code} value={l.code} lang={l.code}>{l.label}</option>)}
          <option value="other">🌐 {tr('Other language…')}</option>
        </select>
      </label>
      {helpOpen && <OtherLanguageHelp onClose={() => setHelpOpen(false)} />}
    </>
  )
}

function OtherLanguageHelp({ onClose }) {
  const steps = isNativeApp
    ? [tr('Open VolunTrack in your phone’s web browser (Chrome or Safari) using the button below, and sign in.'),
      tr('Then use the browser’s translate, as shown below.')]
    : []
  return (
    <div className="fixed inset-0 z-[150] grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="other-lang-title" onClick={onClose}>
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-white dark:bg-[#0f1813] p-5 text-earth-900 dark:text-earth-100 shadow-soft" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 id="other-lang-title" className="font-display font-semibold text-lg flex items-center gap-2"><Globe className="w-5 h-5 text-brand-600" aria-hidden="true" />{tr('Use VolunTrack in another language')}</h2>
          <button type="button" onClick={onClose} className="btn-ghost p-1" aria-label={tr('Close')}><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-earth-500 dark:text-earth-400 mt-1">{tr('VolunTrack is written in English, Spanish, Vietnamese and Chinese, and its main screens in Hindi, Arabic, Portuguese, French, Bengali, Russian and Japanese. For any other language, your browser can translate the page for you. It’s free and works for 100+ languages, like Tagalog, Korean, Haitian Creole, German and Urdu.')}</p>
        {steps.length > 0 && (
          <ol className="mt-3 list-decimal pl-5 space-y-1 text-sm">{steps.map((s) => <li key={s}>{s}</li>)}</ol>
        )}
        <dl className="mt-3 space-y-2 text-sm">
          <div><dt className="font-semibold">Chrome / Edge ({tr('computer')})</dt><dd className="text-earth-600 dark:text-earth-300">{tr('Right-click anywhere on the page, choose Translate to…, then pick your language.')}</dd></div>
          <div><dt className="font-semibold">Chrome ({tr('Android phone')})</dt><dd className="text-earth-600 dark:text-earth-300">{tr('Tap ⋮ (top right), then Translate…, then pick your language.')}</dd></div>
          <div><dt className="font-semibold">Safari ({tr('iPhone')})</dt><dd className="text-earth-600 dark:text-earth-300">{tr('Tap the page menu (aA or the icon at the left of the address bar), then Translate to….')}</dd></div>
          <div><dt className="font-semibold">Safari ({tr('Mac')})</dt><dd className="text-earth-600 dark:text-earth-300">{tr('Click the translate icon in the address bar, or choose View → Translation.')}</dd></div>
        </dl>
        <p className="text-xs text-earth-500 dark:text-earth-400 mt-3">{tr('Browser translation is done by your browser, not by VolunTrack, and may not be perfect. Emails still come in English or your chosen VolunTrack language.')}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {isNativeApp && <a href={SITE} target="_blank" rel="noopener noreferrer" className="btn-primary btn-sm">{tr('Open in browser')}</a>}
          <button type="button" onClick={onClose} className={isNativeApp ? 'btn-ghost btn-sm' : 'btn-primary btn-sm'}>{tr('Got it')}</button>
        </div>
      </div>
    </div>
  )
}
