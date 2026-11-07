// Rate-limit key: a signed-in person's own id, otherwise their address.
// Students at one school usually share a single public address on school
// Wi-Fi, so counting by address alone throttles a whole class at once.
// Runs after the global authenticate, so req.auth is set when signed in.
export const perPersonKey = (req) => (req.auth?.sub ? `user:${req.auth.sub}` : `ip:${req.ip}`)

// Sign-in limits: the address plus the email being tried. Guessing at one
// account is still capped, but a class signing in on one school address isn't.
// Pair it with an address-wide cap (see authLimiter) so one address can't try
// endless emails.
export const signInKey = (req) => {
  if (req.auth?.sub) return `user:${req.auth.sub}`
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : ''
  return `ip:${req.ip}|${email}`
}
