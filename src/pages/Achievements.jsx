import {
  Sprout, Flame, Award, Medal, Trophy, Crown, Compass, Sparkles, CalendarCheck, Sun, TrendingUp,
} from 'lucide-react'
import { useData } from '@/hooks/useData.jsx'
import { BADGES, deriveAchievementState } from '@/lib/achievements.js'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import { cn } from '@/utils/cn.js'
import { tr } from '@/lib/i18n.js'

const ICONS = { Sprout, Flame, Award, Medal, Trophy, Crown, Compass, Sparkles, CalendarCheck, Sun, TrendingUp }

const COLOR_CLASS = {
  brand:   { ring: 'ring-brand-500/30',   text: 'text-brand-700',   bg: 'bg-brand-100',   dark: 'dark:bg-brand-900/30 dark:text-brand-300' },
  amber:   { ring: 'ring-amber-500/30',   text: 'text-amber-700',   bg: 'bg-amber-100',   dark: 'dark:bg-amber-900/30 dark:text-amber-300' },
  orange:  { ring: 'ring-orange-500/30',  text: 'text-orange-700',  bg: 'bg-orange-100',  dark: 'dark:bg-orange-900/30 dark:text-orange-300' },
  sky:     { ring: 'ring-sky-500/30',     text: 'text-sky-700',     bg: 'bg-sky-100',     dark: 'dark:bg-sky-900/30 dark:text-sky-300' },
  violet:  { ring: 'ring-violet-500/30',  text: 'text-violet-700',  bg: 'bg-violet-100',  dark: 'dark:bg-violet-900/30 dark:text-violet-300' },
  emerald: { ring: 'ring-emerald-500/30', text: 'text-emerald-700', bg: 'bg-emerald-100', dark: 'dark:bg-emerald-900/30 dark:text-emerald-300' },
  fuchsia: { ring: 'ring-fuchsia-500/30', text: 'text-fuchsia-700', bg: 'bg-fuchsia-100', dark: 'dark:bg-fuchsia-900/30 dark:text-fuchsia-300' },
  indigo:  { ring: 'ring-indigo-500/30',  text: 'text-indigo-700',  bg: 'bg-indigo-100',  dark: 'dark:bg-indigo-900/30 dark:text-indigo-300' },
  rose:    { ring: 'ring-rose-500/30',    text: 'text-rose-700',    bg: 'bg-rose-100',    dark: 'dark:bg-rose-900/30 dark:text-rose-300' },
  teal:    { ring: 'ring-teal-500/30',    text: 'text-teal-700',    bg: 'bg-teal-100',    dark: 'dark:bg-teal-900/30 dark:text-teal-300' },
}

export default function Achievements() {
  const { logs, goals, earned } = useData()
  const state = deriveAchievementState(logs, goals)

  return (
    <AppLayout
      title={tr('Achievements')}
      subtitle={tr('{earned} of {total} earned', { earned: earned.length, total: BADGES.length })}
    >
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {BADGES.map((b) => {
          const isEarned = earned.includes(b.id)
          const Icon = ICONS[b.icon] || Trophy
          const palette = COLOR_CLASS[b.color] || COLOR_CLASS.brand
          return (
            <Card key={b.id} className={cn('relative overflow-hidden', !isEarned && 'opacity-60')}>
              <div className="flex items-start gap-3">
                <div className={cn(
                  'w-12 h-12 rounded-2xl grid place-items-center shrink-0',
                  palette.bg, palette.dark,
                  isEarned && `ring-4 ${palette.ring}`,
                )}>
                  <Icon className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-display font-semibold">{b.title}</div>
                  <div className="text-sm text-earth-500 dark:text-earth-400 mt-0.5">{b.description}</div>
                </div>
              </div>
              <div className="mt-4 text-xs">
                {isEarned ? (
                  <span className="chip-brand">{tr('Earned')}</span>
                ) : (
                  <span className="chip-earth">{tr('Locked')}</span>
                )}
              </div>
              {isEarned && (
                <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-brand-500/10" />
              )}
            </Card>
          )
        })}
      </div>

      <Card className="mt-6">
        <h3 className="font-display font-semibold mb-2">{tr('Your progress')}</h3>
        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <Stat label={tr('Total hours')}      value={state.totalHours.toFixed(1)} />
          <Stat label={tr('Distinct days')}    value={state.distinctDays} />
          <Stat label={tr('Categories used')}  value={state.distinctCategories} />
          <Stat label={tr('Best month')}       value={state.bestMonthHours.toFixed(1)} />
        </div>
      </Card>
    </AppLayout>
  )
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-earth-50 dark:bg-[#0f1a14] p-3">
      <div className="text-xs text-earth-500 dark:text-earth-400">{label}</div>
      <div className="font-bold text-xl mt-0.5">{value}</div>
    </div>
  )
}
