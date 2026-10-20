import { Globe } from 'lucide-react'
import { LANGUAGES, language, setLanguage, tr } from '@/lib/i18n.js'

// Choosing a language reloads the page in it (src/lib/i18n.js). Each option
// is written in its own language, so someone who can't read the current one
// still finds theirs.
export default function LanguagePicker({ className = '', compact = false }) {
  return (
    <label className={`inline-flex items-center gap-2 text-sm ${className}`}>
      <Globe className="w-4 h-4 text-earth-400" aria-hidden="true" />
      {!compact && <span className="text-earth-400">{tr('Language')}</span>}
      <select
        value={language}
        onChange={(e) => setLanguage(e.target.value)}
        className="input py-1 px-2 text-sm w-auto"
        aria-label={tr('Language')}
      >
        {LANGUAGES.map((l) => <option key={l.code} value={l.code} lang={l.code}>{l.label}</option>)}
      </select>
    </label>
  )
}
