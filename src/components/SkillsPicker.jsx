import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { STARTER_SKILLS, MAX_SKILLS_PER_ENTRY, MAX_SKILL_LENGTH, cleanSkills } from '@/lib/skills.js'
import { tr } from '@/lib/i18n.js'

// Skills used on an entry (#605): tap the common ones or add your own. Stored
// in English (like categories) and shown translated.
export default function SkillsPicker({ value, onChange }) {
  const [custom, setCustom] = useState('')
  const picked = cleanSkills(value)
  const has = (s) => picked.some((p) => p.toLowerCase() === s.toLowerCase())
  const full = picked.length >= MAX_SKILLS_PER_ENTRY

  const toggle = (s) => onChange(has(s) ? picked.filter((p) => p.toLowerCase() !== s.toLowerCase()) : cleanSkills([...picked, s]))
  const addCustom = () => {
    const s = custom.trim()
    if (!s || full) return
    onChange(cleanSkills([...picked, s]))
    setCustom('')
  }
  const own = picked.filter((p) => !STARTER_SKILLS.includes(p))

  return (
    <div>
      <label className="label">
        {tr('Skills you used')} <span className="text-earth-400 font-normal">{tr('(optional, up to {n})', { n: MAX_SKILLS_PER_ENTRY })}</span>
      </label>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={tr('Skills you used')}>
        {STARTER_SKILLS.map((s) => {
          const on = has(s)
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              disabled={!on && full}
              onClick={() => toggle(s)}
              className={`chip transition ${on ? 'bg-brand-600 text-white ring-1 ring-brand-400' : 'hover:ring-1 hover:ring-brand-400'} disabled:opacity-40`}
            >
              {tr(s)}
            </button>
          )
        })}
        {own.map((s) => (
          <button key={s} type="button" aria-pressed="true" onClick={() => toggle(s)} className="chip bg-brand-600 text-white ring-1 ring-brand-400 inline-flex items-center gap-1">
            {s} <X className="w-3 h-3" aria-label={tr('Remove')} />
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          className="input flex-1"
          value={custom}
          maxLength={MAX_SKILL_LENGTH}
          disabled={full}
          placeholder={tr('Add your own skill')}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }}
        />
        <button type="button" className="btn-ghost" onClick={addCustom} disabled={!custom.trim() || full}>
          <Plus className="w-4 h-4" />{' '}{tr('Add')}
        </button>
      </div>
      <p className="text-xs text-earth-400 mt-1">{tr('Only you see these, unless you show your top skills on your portfolio.')}</p>
    </div>
  )
}
