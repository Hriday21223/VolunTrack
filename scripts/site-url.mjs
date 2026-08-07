export const DEFAULT_SITE_URL = 'http://localhost:5173'

export function resolveSiteUrl(env = process.env) {
  const raw = env.VITE_SITE_URL || DEFAULT_SITE_URL
  return raw.replace(/\/+$/, '') // strip trailing slash so callers can do `${SITE_URL}${path}`
}
