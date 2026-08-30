// Cloudflare Turnstile client config. Mirrors server/turnstile.js: entirely
// opt-in — with VITE_TURNSTILE_SITE_KEY unset the <Turnstile> widget renders
// nothing and forms submit without a token (the backend middleware is a
// matching no-op when TURNSTILE_SECRET_KEY is unset).

export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || ''

export const turnstileEnabled = Boolean(TURNSTILE_SITE_KEY)
