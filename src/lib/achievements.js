// Auto-earning badges. A badge becomes "earned" the first time its
// `isEarned(state)` returns true. `inviteOnly` badges come from friends who
// joined through the student's invite link (#493); under-13 accounts can't
// invite, so those badges are hidden for them (visibleBadges). New badges can be added freely; existing
// IDs must not change once shipped.

import { differenceInCalendarDays, parseISO, isAfter, startOfDay } from 'date-fns'
import { tr } from '@/lib/i18n.js'
import { hoursForGoal } from '@/lib/goalProgress.js'

export const BADGES = [
  {
    id: 'first-hour',
    title: tr('First Volunteer Hour'),
    description: tr('Logged your very first hour of service.'),
    icon: 'Sprout',
    color: 'brand',
    isEarned: ({ totalHours }) => totalHours >= 1,
    target: { metric: 'totalHours', value: 1, unit: 'h' },
  },
  {
    id: 'streak-3',
    title: tr('3-Day Streak'),
    description: tr('Logged hours on three different days.'),
    icon: 'Flame',
    color: 'amber',
    isEarned: ({ distinctDays }) => distinctDays >= 3,
    target: { metric: 'distinctDays', value: 3, unit: ' days' },
  },
  {
    id: 'streak-7',
    title: tr('Week-Long Dedication'),
    description: tr('Logged hours on seven different days.'),
    icon: 'Flame',
    color: 'orange',
    isEarned: ({ distinctDays }) => distinctDays >= 7,
    target: { metric: 'distinctDays', value: 7, unit: ' days' },
  },
  {
    id: 'ten-hours',
    title: tr('10 Hours Completed'),
    description: tr('You crossed the ten-hour mark.'),
    icon: 'Award',
    color: 'sky',
    isEarned: ({ totalHours }) => totalHours >= 10,
    target: { metric: 'totalHours', value: 10, unit: 'h' },
  },
  {
    id: 'fifty-hours',
    title: tr('50 Hours Completed'),
    description: tr('Halfway to community hero status.'),
    icon: 'Medal',
    color: 'violet',
    isEarned: ({ totalHours }) => totalHours >= 50,
    target: { metric: 'totalHours', value: 50, unit: 'h' },
  },
  {
    id: 'hundred-hours',
    title: tr('100 Hours Completed'),
    description: tr('A full hundred hours of service.'),
    icon: 'Trophy',
    color: 'amber',
    isEarned: ({ totalHours }) => totalHours >= 100,
    target: { metric: 'totalHours', value: 100, unit: 'h' },
  },
  {
    id: 'community-hero',
    title: tr('Community Hero'),
    description: tr('Reached your primary goal.'),
    icon: 'Crown',
    color: 'amber',
    isEarned: ({ goalReached }) => goalReached,
  },
  {
    id: 'category-explorer',
    title: tr('Category Explorer'),
    description: tr('Logged hours in three different categories.'),
    icon: 'Compass',
    color: 'emerald',
    isEarned: ({ distinctCategories }) => distinctCategories >= 3,
    target: { metric: 'distinctCategories', value: 3, unit: ' categories' },
  },
  {
    id: 'category-master',
    title: tr('Category Master'),
    description: tr('Logged hours in five or more categories.'),
    icon: 'Sparkles',
    color: 'fuchsia',
    isEarned: ({ distinctCategories }) => distinctCategories >= 5,
    target: { metric: 'distinctCategories', value: 5, unit: ' categories' },
  },
  {
    id: 'monthly-five',
    title: tr('Monthly Momentum'),
    description: tr('Logged five or more hours in a single month.'),
    icon: 'CalendarCheck',
    color: 'indigo',
    isEarned: ({ bestMonthHours }) => bestMonthHours >= 5,
    target: { metric: 'bestMonthHours', value: 5, unit: 'h in a month' },
  },
  {
    id: 'weekend-warrior',
    title: tr('Weekend Warrior'),
    description: tr('Logged hours on a Saturday or Sunday.'),
    icon: 'Sun',
    color: 'rose',
    isEarned: ({ hasWeekend }) => hasWeekend,
  },
  {
    id: 'consistent',
    title: tr('Consistent Contributor'),
    description: tr('Logged hours across two different months.'),
    icon: 'TrendingUp',
    color: 'teal',
    isEarned: ({ distinctMonths }) => distinctMonths >= 2,
    target: { metric: 'distinctMonths', value: 2, unit: ' months' },
  },
  {
    id: 'invite-1',
    title: tr('Bring a Friend'),
    description: tr('A friend joined VolunTrack with your invite link.'),
    icon: 'UserPlus',
    color: 'sky',
    inviteOnly: true,
    isEarned: ({ friendsInvited }) => friendsInvited >= 1,
    target: { metric: 'friendsInvited', value: 1, unit: ' friend' },
  },
  {
    id: 'invite-5',
    title: tr('Team Builder'),
    description: tr('Five friends joined VolunTrack with your invite link.'),
    icon: 'Users',
    color: 'emerald',
    inviteOnly: true,
    isEarned: ({ friendsInvited }) => friendsInvited >= 5,
    target: { metric: 'friendsInvited', value: 5, unit: ' friends' },
  },
]

/** The badges this account can earn: no invite badges for under-13s. */
export function visibleBadges(user) {
  return user?.under13 ? BADGES.filter((b) => !b.inviteOnly) : BADGES
}

/** Build the derived state we evaluate against. */
// Hours a supervisor or school rejected don't count: not toward a badge, a
// goal, the school's requirement, or a certificate of service. The school's
// own totals already leave them out (server/routes/school.js), and the
// student's must agree with them.
export function countedLogs(logs) {
  return (logs || []).filter((l) => (l.verificationStatus || l.verification_status) !== 'rejected')
}

// `extra.friendsInvited` comes from the server (GET /api/invites/mine).
export function deriveAchievementState(allLogs, goals, extra = {}) {
  const logs = countedLogs(allLogs)
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
  // A goal for one cause is reached on that cause's hours alone.
  const goalReached = !!primaryGoal && hoursForGoal(primaryGoal, logs) >= Number(primaryGoal.targetHours || 0)

  return {
    totalHours,
    distinctDays,
    distinctMonths,
    distinctCategories,
    hasWeekend,
    bestMonthHours,
    goalReached,
    friendsInvited: Number(extra.friendsInvited) || 0,
  }
}

/** Returns a list of badge IDs newly earned in this evaluation. */
export function evaluateAchievements(logs, goals, alreadyEarned = [], extra = {}) {
  const state = deriveAchievementState(logs, goals, extra)
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
    // Hours badges only: "1 friend away" isn't something more volunteering fixes.
    .filter((b) => b.target && !b.inviteOnly && !earned.includes(b.id) && !b.isEarned(state))
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
