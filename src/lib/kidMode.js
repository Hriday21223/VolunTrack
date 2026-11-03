import { gradeKey } from '@policy'

// Young students (#641), going by grade: Kindergarten to 5th grade, about
// ages 5–11. No birthday is stored, so grade is what decides.
export const YOUNG_GRADES = ['K', '1', '2', '3', '4', '5']

/** Whether this account gets the kid-friendly Helper Card. */
export function isYoungStudent(user) {
  return user?.role === 'student' && YOUNG_GRADES.includes(gradeKey(user?.grade))
}

/** The goal a young student sees when no one has set one: small on purpose. */
export const KID_DEFAULT_GOAL = 5

/**
 * How the stars on the card work: one star per hour for goals up to 20 hours;
 * above that, 10 stars, each worth goal / 10 hours.
 * → { stars, filled, perStar }
 */
export function starsFor(hours, goal) {
  const target = Math.max(1, Number(goal) || KID_DEFAULT_GOAL)
  const stars = target <= 20 ? Math.ceil(target) : 10
  const perStar = target / stars
  const filled = Math.min(stars, Math.floor((Number(hours) || 0) / perStar + 1e-9))
  return { stars, filled, perStar }
}
