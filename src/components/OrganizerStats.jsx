import { useState, useEffect, useMemo } from 'react'
import { format, parseISO, subMonths } from 'date-fns'
import { ChevronUp, ChevronDown, CalendarCheck, Users, UserCheck, Clock, Star } from 'lucide-react'
import Card from '@/components/Card.jsx'
import BarChart from '@/components/BarChart.jsx'
import { fmtDate } from '@/utils/date.js'

// The Stats tab of My Tasks: how the organizer's own tasks went. Everything
// comes from GET /school/public-tasks/mine/stats, which returns counts only.
// An organizer screen, so English only (no tr()).

const apiUrl = import.meta.env.VITE_API_URL || '/api'

const PRESETS = [
  { id: '3m', label: 'Last 3 months' },
  { id: '12m', label: 'Last 12 months' },
  { id: 'all', label: 'All time' },
]

const COLUMNS = [
  { key: 'date', label: 'Date', align: 'left' },
  { key: 'title', label: 'Task', align: 'left' },
  { key: 'signups', label: 'Sign-ups' },
  { key: 'showUpRate', label: 'Show-up' },
  { key: 'noShows', label: 'No-shows' },
  { key: 'hours', label: 'Hours' },
  { key: 'rating', label: 'Rating' },
]

const pct = (rate) => (rate == null ? '—' : `${Math.round(rate * 100)}%`)
const hrs = (n) => `${Math.round(n * 100) / 100}`

function presetParams(preset) {
  if (preset === 'all') return 'all=1'
  if (preset === '3m') return `from=${format(subMonths(new Date(), 3), 'yyyy-MM-dd')}`
  return '' // the server's default: the last 12 months
}

// BarChart squeezes its SVG labels to the card's width, so the bars go to it
// unlabelled and the labels are drawn underneath in HTML. Up to 13 months
// (the 12-month window spans 13 calendar months) show one bar a month; longer
// windows roll up into quarters, and past three years into whole years.
function chartData(months) {
  if (months.length <= 13) {
    return months.map((m) => ({ label: format(parseISO(`${m.month}-01`), 'MMM'), value: m.hours }))
  }
  const byYear = months.length > 36
  const groups = new Map()
  for (const m of months) {
    const [y, mo] = m.month.split('-').map(Number)
    const id = byYear ? `${y}` : `Q${Math.ceil(mo / 3)} '${String(y).slice(2)}`
    const g = groups.get(id) || { label: id, value: 0 }
    g.value += m.hours
    groups.set(id, g)
  }
  return [...groups.values()]
}

function HoursChart({ months }) {
  const data = chartData(months)
  return (
    <div>
      <BarChart data={data.map((d) => ({ ...d, label: '', title: `${d.label}: ${Math.round(d.value * 100) / 100} hours` }))} showValues={false} />
      <div className="grid mt-1.5 gap-1.5 sm:gap-3 text-[10px] text-earth-500 text-center" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}>
        {data.map((d, i) => (
          <span key={i} className="truncate" title={`${d.label}: ${Math.round(d.value * 100) / 100} hours`}>{d.label}</span>
        ))}
      </div>
    </div>
  )
}

function sortValue(t, key) {
  if (key === 'rating') return t.rating.average
  return t[key]
}

export default function OrganizerStats() {
  const [preset, setPreset] = useState('12m')
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' })

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    const token = localStorage.getItem('voluntrack:auth_token')
    fetch(`${apiUrl}/school/public-tasks/mine/stats?${presetParams(preset)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Could not load your stats')
        if (!cancelled) setStats(data)
      })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [preset])

  const sorted = useMemo(() => {
    if (!stats) return []
    const { key, dir } = sort
    const sign = dir === 'asc' ? 1 : -1
    return [...stats.tasks].sort((a, b) => {
      const va = sortValue(a, key)
      const vb = sortValue(b, key)
      // No show-up rate or rating yet sorts last either way.
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      if (typeof va === 'string') return va.localeCompare(vb) * sign
      return (va - vb) * sign
    })
  }, [stats, sort])

  const toggleSort = (key) => setSort((s) => (
    s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'title' ? 'asc' : 'desc' }
  ))

  const totals = stats?.totals
  const empty = totals && totals.tasksRun === 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Date range">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPreset(p.id)}
            aria-pressed={preset === p.id}
            className={`btn-sm ${preset === p.id ? 'btn-primary' : 'btn-ghost'}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {loading && !stats ? (
        <Card><p className="text-center text-earth-500 py-8">Loading…</p></Card>
      ) : error ? (
        <Card><p className="text-center text-red-400 py-8">{error}</p></Card>
      ) : empty ? (
        <Card>
          <div className="text-center py-8">
            <p className="font-medium">No tasks to show yet</p>
            <p className="text-sm text-earth-500 mt-1">
              {preset === 'all'
                ? 'Once a task you posted has its day, its sign-ups, attendance, hours and ratings add up here.'
                : 'None of your tasks fell in this range. Try All time.'}
            </p>
            {totals.cancelled > 0 && (
              <p className="text-xs text-earth-500 mt-2">{totals.cancelled} cancelled task{totals.cancelled === 1 ? '' : 's'} in this range {totals.cancelled === 1 ? 'is' : 'are'} not counted.</p>
            )}
          </div>
        </Card>
      ) : (
        <div className={`space-y-4 ${loading ? 'opacity-60' : ''}`}>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <StatTile icon={CalendarCheck} label="Tasks run" value={totals.tasksRun} />
            <StatTile icon={Users} label="Volunteers" value={totals.volunteers} hint={`${totals.signups} sign-up${totals.signups === 1 ? '' : 's'}${totals.guests > 0 ? ` · +${totals.guests} guest${totals.guests === 1 ? '' : 's'}` : ''} · ${totals.waitlisted} waitlisted`} />
            <StatTile
              icon={UserCheck}
              label="Show-up rate"
              value={pct(totals.showUpRate)}
              hint={totals.showUpRate == null ? 'No attendance taken yet' : `${totals.showedUp} came · ${totals.noShows} no-show${totals.noShows === 1 ? '' : 's'}`}
            />
            <StatTile icon={Clock} label="Hours given" value={hrs(totals.hours)} />
            <StatTile
              icon={Star}
              label="Avg rating"
              value={totals.rating.average == null ? '—' : `★ ${totals.rating.average.toFixed(1)}`}
              hint={`${totals.rating.count} rating${totals.rating.count === 1 ? '' : 's'}`}
            />
          </div>

          <Card>
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 mb-2">
              <h3 className="font-semibold">Hours given by month</h3>
              <span className="text-xs text-earth-500">
                {stats.from ? `${fmtDate(stats.from)} – ${fmtDate(stats.to)}` : `Up to ${fmtDate(stats.to)}`}
              </span>
            </div>
            <HoursChart months={stats.months} />
            <ul className="mt-3 text-sm text-earth-600 dark:text-earth-300 space-y-1">
              {totals.busiestMonth && (
                <li>Busiest month: <span className="font-medium">{format(parseISO(`${totals.busiestMonth.month}-01`), 'MMMM yyyy')}</span> — {hrs(totals.busiestMonth.hours)} hours, {totals.busiestMonth.tasks} task{totals.busiestMonth.tasks === 1 ? '' : 's'}</li>
              )}
              {totals.busiestCategory && (
                <li>Busiest category: <span className="font-medium">{totals.busiestCategory.category}</span> — {hrs(totals.busiestCategory.hours)} hours, {totals.busiestCategory.tasks} task{totals.busiestCategory.tasks === 1 ? '' : 's'}</li>
              )}
              <li>Repeat volunteers: <span className="font-medium">{totals.repeatVolunteers}</span> of {totals.attended} who came were at 2 or more of your tasks</li>
              {totals.excused > 0 && <li>Excused: {totals.excused} (not counted in the show-up rate)</li>}
              {totals.cancelled > 0 && <li className="text-earth-500">{totals.cancelled} cancelled task{totals.cancelled === 1 ? '' : 's'} left out of these numbers</li>}
            </ul>
          </Card>

          <Card padded={false} className="p-4">
            <h3 className="font-semibold mb-2">Your tasks</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-earth-500">
                  <tr>
                    {COLUMNS.map((c) => (
                      <th
                        key={c.key}
                        className={`py-2 px-1 whitespace-nowrap ${c.align === 'left' ? 'text-left' : 'text-right'}`}
                        aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      >
                        <button onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-0.5 hover:text-earth-800 dark:hover:text-earth-100">
                          {c.label}
                          {sort.key === c.key && (sort.dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((t) => (
                    <tr key={t.id} className="border-t border-earth-200 dark:border-white/10">
                      <td className="py-2 px-1 whitespace-nowrap">{fmtDate(t.date)}</td>
                      <td className="py-2 px-1 min-w-[10rem]">
                        {t.title}
                        {t.waitlisted > 0 && <span className="text-xs text-earth-500"> · {t.waitlisted} waitlisted</span>}
                      </td>
                      <td className="py-2 px-1 text-right">{t.signups}{t.guests > 0 && <span className="text-xs text-earth-500" title="Guests of approved volunteers"> +{t.guests}</span>}</td>
                      <td className="py-2 px-1 text-right" title={t.excused ? `${t.excused} excused, not counted` : undefined}>{pct(t.showUpRate)}</td>
                      <td className="py-2 px-1 text-right">{t.noShows}</td>
                      <td className="py-2 px-1 text-right">{hrs(t.hours)}</td>
                      <td className="py-2 px-1 text-right whitespace-nowrap">
                        {t.rating.average == null ? '—' : <>★ {t.rating.average.toFixed(1)} <span className="text-earth-500">({t.rating.count})</span></>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-earth-500 mt-3">
              Show-up rate counts volunteers you approved who were marked present or checked in, out of those plus anyone marked absent. Excused volunteers and anyone not yet marked aren't counted. Hours are approved hours logged on the task.
            </p>
          </Card>
        </div>
      )}
    </div>
  )
}

function StatTile({ icon: Icon, label, value, hint }) {
  return (
    <div className="card p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-earth-500">
        <Icon className="w-3.5 h-3.5 text-brand-600" /> {label}
      </div>
      <div className="text-xl font-semibold mt-1">{value}</div>
      {hint && <div className="text-[11px] text-earth-500 mt-0.5">{hint}</div>}
    </div>
  )
}
