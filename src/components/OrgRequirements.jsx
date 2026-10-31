import { useCallback, useEffect, useState } from 'react'
import { Layers, Plus, Trash2 } from 'lucide-react'
import Card from '@/components/Card.jsx'
import RequirementsSettings from '@/components/RequirementsSettings.jsx'
import { listTemplates, createTemplate, deleteTemplate, assignTemplate } from '@/lib/requirements.js'
import { tr } from '@/lib/i18n.js'

// The organization's Requirements tab (#577): its defaults for every school,
// plus named templates ("Middle schools", "High schools") that schools can be
// assigned to. A school follows its own sections, then its template, then the
// defaults.
export default function OrgRequirements({ schools = [], onSchoolsChange }) {
  const [templates, setTemplates] = useState([])
  const [editing, setEditing] = useState('defaults')
  const [newName, setNewName] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(() => listTemplates().then(setTemplates).catch((e) => setError(e.message)), [])
  useEffect(() => { load() }, [load])

  const add = async (e) => {
    e.preventDefault()
    setError('')
    try {
      const t = await createTemplate(newName)
      setNewName('')
      await load()
      setEditing(t.id)
    } catch (err) { setError(err.message) }
  }

  const remove = async (t) => {
    setError('')
    try {
      await deleteTemplate(t.id)
      if (editing === t.id) setEditing('defaults')
      await load()
      onSchoolsChange?.()
    } catch (err) { setError(err.message) }
  }

  const assign = async (schoolId, templateId) => {
    setError('')
    try {
      await assignTemplate(schoolId, templateId || null)
      await Promise.all([load(), onSchoolsChange?.()])
    } catch (err) { setError(err.message) }
  }

  const current = templates.find((t) => t.id === editing)
  return (
    <div className="space-y-4">
      <Card>
        <h3 className="font-semibold mb-1 flex items-center gap-2"><Layers className="w-4 h-4 text-brand-600" />{' '}{tr('Rule sets')}</h3>
        <p className="text-sm text-earth-500 mb-3">
          {tr('Your defaults apply to every school. Add a template, such as “Middle schools”, for schools that need different rules, then assign those schools to it below.')}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={`btn-sm ${editing === 'defaults' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setEditing('defaults')}>
            {tr('Defaults (all schools)')}
          </button>
          {templates.map((t) => (
            <button key={t.id} type="button" className={`btn-sm ${editing === t.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setEditing(t.id)}>
              {t.name} <span className="opacity-70 ml-1">· {t.schoolCount} school{t.schoolCount === 1 ? '' : 's'}</span>
            </button>
          ))}
          {templates.length < 10 && (
            <form onSubmit={add} className="flex gap-1">
              <input className="input py-1 text-sm w-40" placeholder={tr('New template name')} maxLength={60} value={newName} onChange={(e) => setNewName(e.target.value)} required />
              <button type="submit" className="btn-sm btn-secondary" aria-label={tr('Add template')}><Plus className="w-3.5 h-3.5" /></button>
            </form>
          )}
        </div>
        {current && (
          <button type="button" className="btn-ghost btn-sm text-red-500 mt-2" onClick={() => remove(current)}>
            <Trash2 className="w-3.5 h-3.5 mr-1" />{' '}{tr('Delete “{name}” (its schools go back to your defaults)', { name: current.name })}
          </button>
        )}

        {templates.length > 0 && schools.length > 0 && (
          <div className="mt-4 border-t border-earth-200 dark:border-white/10 pt-3">
            <p className="text-sm font-medium mb-2">{tr('Which rules each school follows')}</p>
            <ul className="space-y-2">
              {schools.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{s.name}</span>
                  <select
                    className="input w-auto py-1 text-sm"
                    value={s.requirement_template_id || ''}
                    onChange={(e) => assign(s.id, e.target.value)}
                    aria-label={`Rules for ${s.name}`}
                  >
                    <option value="">{tr('Defaults')}</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
      </Card>

      {editing === 'defaults'
        ? <RequirementsSettings key="defaults" scope="organization" />
        : <RequirementsSettings key={editing} scope="template" templateId={editing} />}
    </div>
  )
}
