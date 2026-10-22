import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Clock, Heart, MapPin, CalendarDays, Flame, Award, Flag, Sparkles, Share2, Download, PartyPopper,
} from 'lucide-react'
import { useData } from '@/hooks/useData.jsx'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import { BADGES } from '@/lib/achievements.js'
import { yearInReview, yearsWithLogs, defaultReviewYear } from '@/lib/yearInReview.js'
import { isNativeApp } from '@/lib/platform.js'
import { fmtDate, fmtHours } from '@/utils/date.js'
import { tr, language } from '@/lib/i18n.js'

const monthName = (m, style = 'long') =>
  new Date(2000, m, 1).toLocaleString(language === 'es' ? 'es' : 'en', { month: style })

// One decimal at most: "11.5 hours", not "11.50h".
const hoursText = (n) => {
  const v = Math.round(n * 10) / 10
  return v === 1 ? tr('1 hour') : tr('{n} hours', { n: v })
}

function shareText(s) {
  const lines = [
    tr('My {year} in volunteering 🎉', { year: s.year }),
    tr('{hours} across {n} sessions', { hours: hoursText(s.totalHours), n: s.sessions }),
  ]
  if (s.topCategory) lines.push(tr('Top cause: {cause}', { cause: tr(s.topCategory) }))
  if (s.places > 0) lines.push(tr('Places helped: {n}', { n: s.places }))
  if (s.badges.length > 0) lines.push(tr('Badges earned: {n}', { n: s.badges.length }))
  lines.push(tr('Tracked with VolunTrack'))
  return lines.join('\n')
}

/** Draw the summary as a 1080×1350 PNG (portrait, the shape social apps crop to). */
async function renderImage(s) {
  const W = 1080
  const H = 1350
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  const grad = ctx.createLinearGradient(0, 0, W, H)
  grad.addColorStop(0, '#1c3720')
  grad.addColorStop(0.55, '#020617')
  grad.addColorStop(1, '#0f172a')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  const font = (size, weight = 700) => `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
  const fit = (text, max, size, weight) => {
    let t = String(text)
    ctx.font = font(size, weight)
    while (t.length > 1 && ctx.measureText(t).width > max) t = t.slice(0, -2) + '…'
    return t
  }
  ctx.textBaseline = 'alphabetic'

  ctx.fillStyle = '#86efac'
  ctx.font = font(36, 600)
  ctx.fillText(tr('Year in review').toUpperCase(), 80, 140)
  ctx.fillStyle = '#ffffff'
  ctx.font = font(120, 800)
  ctx.fillText(String(s.year), 80, 270)

  ctx.font = font(170, 800)
  ctx.fillStyle = '#bbf7d0'
  const hrs = String(Math.round(s.totalHours * 10) / 10)
  ctx.fillText(hrs, 80, 480)
  const hrsW = ctx.measureText(hrs).width
  ctx.font = font(56, 600)
  ctx.fillStyle = '#e2e8f0'
  ctx.fillText(s.totalHours === 1 ? tr('hour') : tr('hours'), 100 + hrsW, 480)
  ctx.font = font(40, 500)
  ctx.fillStyle = '#cbd5e1'
  ctx.fillText(fit(tr('{n} sessions of volunteering', { n: s.sessions }), W - 160, 40, 500), 80, 550)

  const rows = [
    [tr('Top cause'), s.topCategory ? tr(s.topCategory) : '—'],
    [tr('Places helped'), String(s.places)],
    [tr('Busiest month'), monthName(s.busiestMonth.month)],
    [tr('Longest streak'), s.longestWeekStreak === 1 ? tr('1 week') : tr('{n} weeks in a row', { n: s.longestWeekStreak })],
    [tr('Badges earned'), String(s.badges.length)],
  ]
  let y = 680
  for (const [label, value] of rows) {
    ctx.fillStyle = 'rgba(255,255,255,0.08)'
    ctx.beginPath()
    ctx.roundRect ? ctx.roundRect(80, y - 70, W - 160, 100, 24) : ctx.rect(80, y - 70, W - 160, 100)
    ctx.fill()
    ctx.fillStyle = '#94a3b8'
    ctx.font = font(34, 500)
    ctx.fillText(fit(label, 420, 34, 500), 120, y - 5)
    ctx.fillStyle = '#ffffff'
    const v = fit(value, 460, 40, 700)
    ctx.font = font(40, 700)
    ctx.fillText(v, W - 120 - ctx.measureText(v).width, y - 5)
    y += 125
  }

  ctx.fillStyle = '#86efac'
  ctx.font = font(34, 600)
  ctx.fillText('VolunTrack', 80, H - 70)

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

export default function YearInReview() {
  const { logs, goals } = useData()
  const years = useMemo(() => yearsWithLogs(logs), [logs])
  const [picked, setPicked] = useState(null)
  const year = picked ?? defaultReviewYear(years)
  const summary = useMemo(() => yearInReview(logs, goals, year), [logs, goals, year])
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const fileName = `voluntrack-${year}-in-review.png`

  const share = async () => {
    if (!summary) return
    const text = shareText(summary)
    setNotice('')
    try {
      if (navigator.share) {
        // An image if the device can share files, else just the words.
        let files
        try {
          const blob = await renderImage(summary)
          const file = blob && new File([blob], fileName, { type: 'image/png' })
          if (file && navigator.canShare?.({ files: [file] })) files = [file]
        } catch { /* fall back to text */ }
        await navigator.share(files ? { text, files } : { text })
        return
      }
      await navigator.clipboard.writeText(text)
      setNotice(tr('Summary copied — paste it anywhere.'))
    } catch (err) {
      if (err?.name === 'AbortError') return // closed the share sheet
      setNotice(tr("Couldn't share from this device. Try Download image instead."))
    }
  }

  const download = async () => {
    if (!summary) return
    setBusy(true)
    setNotice('')
    try {
      const blob = await renderImage(summary)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      setNotice(tr("Couldn't make the image on this device."))
    } finally {
      setBusy(false)
    }
  }

  const yearPicker = years.length > 1 && (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">{tr('Year')}</span>
      <select
        className="input py-1.5 w-auto"
        value={year}
        onChange={(e) => setPicked(Number(e.target.value))}
        aria-label={tr('Year')}
      >
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </label>
  )

  if (!summary) {
    return (
      <AppLayout title={tr('Year in review')} subtitle={tr('Your volunteering year at a glance')} action={yearPicker}>
        <Card className="text-center py-10">
          <PartyPopper className="w-10 h-10 mx-auto text-brand-500" />
          <p className="mt-3 font-display font-semibold">{tr('No hours logged in {year} yet.', { year })}</p>
          <p className="mt-1 text-sm text-earth-500 dark:text-earth-400">{tr('Log your volunteering and your year in review fills itself in.')}</p>
          <Link to="/log" className="btn-primary btn-sm mt-4 inline-flex">{tr('Log hours')}</Link>
        </Card>
      </AppLayout>
    )
  }

  const s = summary
  const maxMonth = Math.max(...s.months, 0.0001)
  const badgeList = s.badges.map((id) => BADGES.find((b) => b.id === id)).filter(Boolean)

  return (
    <AppLayout title={tr('Year in review')} subtitle={tr('Your volunteering year at a glance')} action={yearPicker}>
      <div className="space-y-4 max-w-3xl">
        {/* Hero */}
        <Card padded={false} className="overflow-hidden">
          <div className="bg-gradient-to-br from-brand-800 via-slate-950 to-slate-900 p-5 sm:p-7 text-white">
            <div className="text-xs uppercase tracking-[0.3em] text-brand-300">{tr('Your {year} in volunteering', { year: s.year })}</div>
            <div className="mt-3 flex items-end gap-2 flex-wrap">
              <span className="font-display text-5xl sm:text-6xl font-extrabold leading-none text-brand-200">{Math.round(s.totalHours * 10) / 10}</span>
              <span className="text-xl font-semibold text-slate-200 pb-1">{s.totalHours === 1 ? tr('hour') : tr('hours')}</span>
            </div>
            <p className="mt-2 text-slate-300">
              {s.sessions === 1 ? tr('1 session of volunteering') : tr('{n} sessions of volunteering', { n: s.sessions })}
              {' · '}
              {s.activeDays === 1 ? tr('1 day') : tr('{n} days', { n: s.activeDays })}
            </p>
            <p className="mt-3 text-sm text-slate-300">
              {s.approvedHours === s.totalHours
                ? tr('Every hour approved by a supervisor or organizer. 🎉')
                : s.approvedHours === 0
                  ? tr('None approved by a supervisor or organizer yet — pending hours and hours not sent for approval are counted here.')
                  : tr('{approved} of these approved by a supervisor or organizer ({n} entries); the rest are pending or not sent for approval.', {
                  approved: hoursText(s.approvedHours), n: s.approvedSessions,
                })}
            </p>
          </div>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Top cause */}
          <StatCard icon={Heart} label={tr('Top cause')} className="sm:col-span-2">
            <div className="font-display text-2xl font-bold">{tr(s.topCategory)}</div>
            <ul className="mt-3 space-y-2">
              {s.categories.slice(0, 5).map((c) => (
                <li key={c.category}>
                  <div className="flex justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">{tr(c.category)}</span>
                    <span className="shrink-0 text-earth-500 dark:text-earth-400">{Math.round(c.hours * 10) / 10}h · {Math.round(c.share * 100)}%</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-earth-100 dark:bg-[#1b2a22] overflow-hidden" aria-hidden="true">
                    <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.max(4, c.share * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
            {s.categories.length > 5 && (
              <p className="mt-2 text-xs text-earth-500 dark:text-earth-400">{tr('+{n} more causes', { n: s.categories.length - 5 })}</p>
            )}
          </StatCard>

          <StatCard icon={MapPin} label={tr('Places helped')}>
            <div className="font-display text-3xl font-bold">{s.places}</div>
            <p className="text-sm text-earth-500 dark:text-earth-400">
              {s.places === 0 ? tr('Add an organization or location when you log to count places.') : tr('different organizations and places')}
            </p>
          </StatCard>

          <StatCard icon={Flame} label={tr('Longest streak')}>
            <div className="font-display text-3xl font-bold">
              {s.longestWeekStreak === 1 ? tr('1 week') : tr('{n} weeks', { n: s.longestWeekStreak })}
            </div>
            <p className="text-sm text-earth-500 dark:text-earth-400">{tr('in a row with at least one session')}</p>
          </StatCard>

          {/* Busiest month with a tiny month-by-month chart */}
          <StatCard icon={CalendarDays} label={tr('Busiest month')} className="sm:col-span-2">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-display text-2xl font-bold capitalize">{monthName(s.busiestMonth.month)}</span>
              <span className="text-sm text-earth-500 dark:text-earth-400">{hoursText(s.busiestMonth.hours)}</span>
            </div>
            <div className="mt-3 grid grid-cols-12 gap-1 items-end h-20" role="img"
              aria-label={s.months.map((h, m) => `${monthName(m)}: ${hoursText(h)}`).join(', ')}>
              {s.months.map((h, m) => (
                <div key={m} className="flex flex-col items-center gap-1 h-full justify-end min-w-0">
                  <div
                    className={`w-full rounded-t ${m === s.busiestMonth.month ? 'bg-brand-500' : 'bg-brand-200 dark:bg-brand-900/60'}`}
                    style={{ height: `${h > 0 ? Math.max(6, (h / maxMonth) * 100) : 2}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-12 gap-1 text-[0.625rem] text-center text-earth-500 dark:text-earth-400" aria-hidden="true">
              {s.months.map((_, m) => <span key={m} className="truncate">{monthName(m, 'narrow')}</span>)}
            </div>
          </StatCard>

          <StatCard icon={Award} label={tr('Badges earned')} className="sm:col-span-2">
            {badgeList.length === 0 ? (
              <p className="text-sm text-earth-500 dark:text-earth-400">{tr('No new badges this year — your earlier ones still count!')}</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {badgeList.map((b) => (
                  <li key={b.id} className="chip-brand text-sm">🏅 {b.title}</li>
                ))}
              </ul>
            )}
          </StatCard>

          <StatCard icon={Flag} label={tr('First activity')}>
            <Moment entry={s.first} />
          </StatCard>
          <StatCard icon={Sparkles} label={tr('Most recent')}>
            <Moment entry={s.latest} />
          </StatCard>
        </div>

        {/* Share */}
        <Card>
          <div className="flex items-start gap-3">
            <Share2 className="w-5 h-5 mt-0.5 text-brand-500 shrink-0" />
            <div className="min-w-0 flex-1">
              <h2 className="font-display font-semibold">{tr('Share your year')}</h2>
              <p className="text-sm text-earth-500 dark:text-earth-400">
                {tr('Shares your totals only — no names, places or notes.')}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={share} className="btn-primary btn-sm">
                  <Share2 className="w-4 h-4" /> {tr('Share')}
                </button>
                {!isNativeApp && (
                  <button type="button" onClick={download} disabled={busy} className="btn-secondary btn-sm">
                    <Download className="w-4 h-4" /> {tr('Download image')}
                  </button>
                )}
              </div>
              {notice && <p className="mt-2 text-sm text-earth-600 dark:text-earth-300" role="status">{notice}</p>}
            </div>
          </div>
        </Card>
      </div>
    </AppLayout>
  )
}

function StatCard({ icon: Icon, label, className = '', children }) {
  return (
    <Card className={`min-w-0 ${className}`}>
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-earth-500 dark:text-earth-400">
        <Icon className="w-4 h-4 text-brand-500" aria-hidden="true" /> {label}
      </div>
      <div className="mt-2">{children}</div>
    </Card>
  )
}

function Moment({ entry }) {
  return (
    <div className="min-w-0">
      <div className="font-display text-lg font-bold">{fmtDate(entry.date)}</div>
      <p className="text-sm break-words">{entry.activity || tr(entry.category) || '—'}</p>
      <p className="text-sm text-earth-500 dark:text-earth-400 break-words">
        <Clock className="inline w-3.5 h-3.5 -mt-0.5" aria-hidden="true" /> {fmtHours(entry.hours)}
        {entry.place ? ` · ${entry.place}` : ''}
      </p>
    </div>
  )
}
