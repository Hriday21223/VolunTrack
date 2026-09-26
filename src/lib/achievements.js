// 12 auto-earning badges. A badge becomes "earned" the first time its
// `isEarned(state)` returns true. New badges can be added freely; existing
// IDs must not change once shipped.

import { differenceInCalendarDays, parseISO, isAfter, startOfDay } from 'date-fns'

export const BADGES = [
  {
    id: 'first-hour',
    title: 'First Volunteer Hour',
    description: 'Logged your very first hour of service.',
    icon: 'Sprout',
    color: 'brand',
    isEarned: ({ totalHours }) => totalHours >= 1,
    target: { metric: 'totalHours', value: 1, unit: 'h' },
  },
  {
    id: 'streak-3',
    title: '3-Day Streak',
    description: 'Logged hours on three different days.',
    icon: 'Flame',
    color: 'amber',
    isEarned: ({ distinctDays }) => distinctDays >= 3,
    target: { metric: 'distinctDays', value: 3, unit: ' days' },
  },
  {
    id: 'streak-7',
    title: 'Week-Long Dedication',
    description: 'Logged hours on seven different days.',
    icon: 'Flame',
    color: 'orange',
    isEarned: ({ distinctDays }) => distinctDays >= 7,
    target: { metric: 'distinctDays', value: 7, unit: ' days' },
  },
  {
    id: 'ten-hours',
    title: '10 Hours Completed',
    description: 'You crossed the ten-hour mark.',
    icon: 'Award',
    color: 'sky',
    isEarned: ({ totalHours }) => totalHours >= 10,
    target: { metric: 'totalHours', value: 10, unit: 'h' },
  },
  {
    id: 'fifty-hours',
    title: '50 Hours Completed',
    description: 'Halfway to community hero status.',
    icon: 'Medal',
    color: 'violet',
    isEarned: ({ totalHours }) => totalHours >= 50,
    target: { metric: 'totalHours', value: 50, unit: 'h' },
  },
  {
    id: 'hundred-hours',
    title: '100 Hours Completed',
    description: 'A full hundred hours of service.',
    icon: 'Trophy',
    color: 'amber',
    isEarned: ({ totalHours }) => totalHours >= 100,
    target: { metric: 'totalHours', value: 100, unit: 'h' },
  },
  {
    id: 'community-hero',
    title: 'Community Hero',
    description: 'Reached your primary goal.',
    icon: 'Crown',
    color: 'amber',
    isEarned: ({ goalReached }) => goalReached,
  },
  {
    id: 'category-explorer',
    title: 'Category Explorer',
    description: 'Logged hours in three different categories.',
    icon: 'Compass',
    color: 'emerald',
    isEarned: ({ distinctCategories }) => distinctCategories >= 3,
    target: { metric: 'distinctCategories', value: 3, unit: ' categories' },
  },
  {
    id: 'category-master',
    title: 'Category Master',
    description: 'Logged hours in five or more categories.',
    icon: 'Sparkles',
    color: 'fuchsia',
    isEarned: ({ distinctCategories }) => distinctCategories >= 5,
    target: { metric: 'distinctCategories', value: 5, unit: ' categories' },
  },
  {
    id: 'monthly-five',
    title: 'Monthly Momentum',
    description: 'Logged five or more hours in a single month.',
    icon: 'CalendarCheck',
    color: 'indigo',
    isEarned: ({ bestMonthHours }) => bestMonthHours >= 5,
    target: { metric: 'bestMonthHours', value: 5, unit: 'h in a month' },
  },
  {
    id: 'weekend-warrior',
    title: 'Weekend Warrior',
    description: 'Logged hours on a Saturday or Sunday.',
    icon: 'Sun',
    color: 'rose',
    isEarned: ({ hasWeekend }) => hasWeekend,
  },
  {
    id: 'consistent',
    title: 'Consistent Contributor',
    description: 'Logged hours across two different months.',
    icon: 'TrendingUp',
    color: 'teal',
    isEarned: ({ distinctMonths }) => distinctMonths >= 2,
    target: { metric: 'distinctMonths', value: 2, unit: ' months' },
  },
]

/** Build the derived state we evaluate against. */
export function deriveAchievementState(logs, goals) {
  const dates = logs.map((l) => l.date).filter(Boolean)
  const totalHours = logs.reduce((s, l) => s + (Number(l.hours) || 0), 0)
  const distinctDays = new Set(dates).size
  const distinctMonths = new Set(dates.map((d) => d.slice(0, 7))).size
  const distinctCategories = new Set(logs.map((l) => l.category).filter(Boolean)).size
  const hasWeekend = dates.some((d) => {
    const day = parseISO(d).getDay()
    return day === 0 || day === 6
  })

  // best month
  const monthMap = new Map()
  for (const l of logs) {
    const key = l.date?.slice(0, 7)
    if (!key) continue
    monthMap.set(key, (monthMap.get(key) || 0) + (Number(l.hours) || 0))
  }
  const bestMonthHours = monthMap.size ? Math.max(...monthMap.values()) : 0

  const primaryGoal = goals.find((g) => g.primary) || goals[0]
  const goalReached = !!primaryGoal && totalHours >= Number(primaryGoal.targetHours || 0)

  return {
    totalHours,
    distinctDays,
    distinctMonths,
    distinctCategories,
    hasWeekend,
    bestMonthHours,
    goalReached,
  }
}

/** Returns a list of badge IDs newly earned in this evaluation. */
export function evaluateAchievements(logs, goals, alreadyEarned = []) {
  const state = deriveAchievementState(logs, goals)
  const newly = []
  for (const b of BADGES) {
    if (alreadyEarned.includes(b.id)) continue
    if (b.isEarned(state)) newly.push(b.id)
  }
  return { state, newly }
}


/**
 * The unearned badge closest to being earned, with how far off it is.
 *
 * Only badges with a measurable target take part — "Weekend Warrior" is a yes
 * or no, and telling someone they are 0% of the way to a weekend is not
 * encouragement. Returns null once every measurable badge is earned.
 */
export function nextBadgeProgress(logs, goals, earned = []) {
  const state = deriveAchievementState(logs, goals)
  const candidates = BADGES
    .filter((b) => b.target && !earned.includes(b.id) && !b.isEarned(state))
    .map((b) => {
      const current = Number(state[b.target.metric]) || 0
      return {
        id: b.id,
        title: b.title,
        current,
        target: b.target.value,
        unit: b.target.unit,
        remaining: Math.max(0, b.target.value - current),
        percent: Math.min(1, current / b.target.value),
      }
    })
  if (candidates.length === 0) return null
  // Closest by what is left, not by percentage: "2 hours away" beats "80% of
  // the way to a hundred".
  return candidates.sort((a, b) => a.remaining - b.remaining || a.target - b.target)[0]
}
