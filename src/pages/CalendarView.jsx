import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, MapPin, Clock, X, Plus, Edit2 } from 'lucide-react'
import { useData } from '@/hooks/useData.jsx'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import LogHours from './LogHours.jsx'
import VerificationBadge from '@/components/VerificationBadge.jsx'
import { fmtHours, fmtTime } from '@/utils/date.js'
import { categoryColor } from '@/lib/categories.js'
import { addMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, format, isSameMonth, isSameDay, parseISO } from 'date-fns'

export default function CalendarView() {
  const { logs, removeLog } = useData()
  const [cursor, setCursor] = useState(() => new Date())
  const [selected, setSelected] = useState(null)
  const [editing, setEditing] = useState(null)

  const monthStart = startOfMonth(cursor)
  const monthEnd = endOfMonth(cursor)
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd })

  const logsByDay = useMemo(() => {
    const m = new Map()
    for (const l of logs) {
      if (!l.date) continue
      const k = l.date
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(l)
    }
    return m
  }, [logs])

  if (editing) {
    return <LogHours editId={editing} onCloseEdit={() => setEditing(null)} />
  }

  return (
    <AppLayout
      title="Calendar"
      subtitle="Tap a day to see what you did."
      action={
        <button onClick={() => setEditing('new')} className="btn-primary">
          <Plus className="w-4 h-4" /> Log hours
        </button>
      }
    >
      <Card padded={false} className="p-4">
        <div className="flex items-center justify-between mb-3 px-1">
          <button className="btn-ghost p-2" onClick={() => setCursor((c) => addMonths(c, -1))} aria-label="Previous month">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="font-display text-lg font-semibold">{format(cursor, 'MMMM yyyy')}</div>
          <button className="btn-ghost p-2" onClick={() => setCursor((c) => addMonths(c, 1))} aria-label="Next month">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-7 text-center text-xs font-medium text-earth-500 dark:text-earth-400 mb-1.5">
          {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d) => <div key={d}>{d}</div>)}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {days.map((day) => {
            const inMonth = isSameMonth(day, cursor)
            const k = format(day, 'yyyy-MM-dd')
            const dayLogs = logsByDay.get(k) || []
            const isToday = isSameDay(day, new Date())
            return (
              <button
                key={k}
                onClick={() => setSelected(day)}
                className={[
                  'aspect-square sm:aspect-auto sm:min-h-[88px] rounded-xl p-1.5 text-left transition border',
                  inMonth ? 'bg-white dark:bg-[#14201a]' : 'bg-earth-50/50 dark:bg-[#0f1a14] text-earth-400',
                  isToday ? 'border-brand-500 ring-2 ring-brand-500/20' : 'border-earth-100 dark:border-[#1f2e25]',
                  'hover:border-brand-400',
                ].join(' ')}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-semibold ${isToday ? 'text-brand-700 dark:text-brand-300' : ''}`}>
                    {format(day, 'd')}
                  </span>
                </div>
                <div className="mt-1 space-y-0.5">
                  {dayLogs.slice(0, 2).map((l) => (
                    <div key={l.id} className="text-[10px] truncate rounded px-1 py-0.5 bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">
                      {fmtHours(l.hours)} · {l.activity}
                    </div>
                  ))}
                  {dayLogs.length > 2 && (
                    <div className="text-[10px] text-earth-500">+{dayLogs.length - 2} more</div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </Card>

      {selected && (
        <DayModal
          day={selected}
          logs={logsByDay.get(format(selected, 'yyyy-MM-dd')) || []}
          onClose={() => setSelected(null)}
          onEdit={(id) => { setSelected(null); setEditing(id) }}
          onDelete={(id) => removeLog(id)}
        />
      )}
    </AppLayout>
  )
}

function DayModal({ day, logs, onClose, onEdit, onDelete }) {
  const [confirmId, setConfirmId] = useState(null)

  return (
    <div className="fixed inset-0 z-50 grid place-items-center px-4 bg-black/30 animate-fade-in" onClick={onClose}>
      <Card
        padded={false}
        className="w-full max-w-lg p-5 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-lg font-semibold">{format(day, 'EEEE, MMMM d')}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-earth-100 dark:hover:bg-[#1b2a22]"><X className="w-4 h-4" /></button>
        </div>
        {logs.length === 0 ? (
          <div className="py-8 text-center text-earth-500 dark:text-earth-400">
            No volunteer hours logged this day.
          </div>
        ) : (
          <ul className="space-y-3">
            {logs.map((l) => (
              <li key={l.id} className="p-3 rounded-xl border border-earth-100 dark:border-[#1f2e25]">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-brand-100 text-brand-800 dark:bg-brand-900/30 dark:text-brand-200 grid place-items-center font-bold text-sm shrink-0">
                    {fmtHours(Number(l.hours) || 0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{l.activity}</div>
                    <div className="text-xs text-earth-500 dark:text-earth-400 flex items-center gap-2 flex-wrap mt-0.5">
                      {l.startTime && <span className="flex items-center gap-0.5"><Clock className="w-3 h-3" />{fmtTime(`${l.date}T${l.startTime}:00`)} – {fmtTime(`${l.date}T${l.endTime}:00`)}</span>}
                      {l.location && <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" />{l.location}</span>}
                      {l.category && <span className={`chip ${categoryColor(l.category)}`}>{l.category}</span>}
                      <VerificationBadge status={l.verificationStatus} />
                    </div>
                    {l.notes && <p className="text-sm text-earth-600 dark:text-earth-300 mt-1.5">{l.notes}</p>}
                  </div>
                  <div className="flex flex-col gap-1">
                    <button onClick={() => onEdit(l.id)} className="p-1.5 rounded-lg hover:bg-earth-100 dark:hover:bg-[#1b2a22]" title="Edit"><Edit2 className="w-4 h-4" /></button>
                    {confirmId === l.id ? (
                      <div className="flex gap-1">
                        <button onClick={() => { onDelete(l.id); setConfirmId(null) }} className="px-2 py-1 rounded-lg bg-red-600 text-white text-xs font-semibold" title="Confirm delete">Yes</button>
                        <button onClick={() => setConfirmId(null)} className="px-2 py-1 rounded-lg bg-earth-200 dark:bg-[#243529] text-xs font-semibold" title="Cancel">No</button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmId(l.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-600 dark:hover:bg-red-900/20" title="Delete"><X className="w-4 h-4" /></button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
