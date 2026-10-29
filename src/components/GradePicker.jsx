import { useState } from 'react'
import { GraduationCap } from 'lucide-react'
import { gradeOptionLabel } from '@policy'
import { tr } from '@/lib/i18n.js'

// "Pick your grade" when joining a school that set its grades (#581). The
// server answers the join with needsGrade + the school's grades; this asks,
// then the caller retries the join with the chosen grade.
export default function GradePicker({ grades = [], schoolName = '', busy = false, onPick }) {
  const [grade, setGrade] = useState('')
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (grade) onPick(grade) }}
      className="rounded-xl border border-brand-500/30 bg-brand-500/10 p-3 space-y-2 text-left"
    >
      <label className="label flex items-center gap-1.5" htmlFor="join-grade">
        <GraduationCap className="w-4 h-4" />
        {schoolName ? tr('Your grade at {school}', { school: schoolName }) : tr('Your grade')}
      </label>
      <div className="flex gap-2">
        <select id="join-grade" className="input flex-1" value={grade} onChange={(e) => setGrade(e.target.value)} required>
          <option value="">{tr('Select your grade')}</option>
          {grades.map((g) => <option key={g} value={g}>{gradeOptionLabel(g)}</option>)}
        </select>
        <button type="submit" className="btn-primary btn-sm" disabled={!grade || busy}>{busy ? tr('Joining…') : tr('Join')}</button>
      </div>
    </form>
  )
}
