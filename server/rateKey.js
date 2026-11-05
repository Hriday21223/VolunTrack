// Rate-limit key: a signed-in person's own id, otherwise their address.
// Students at one school usually share a single public address on school
// Wi-Fi, so counting by address alone throttles a whole class at once.
// Runs after the global authenticate, so req.auth is set when signed in.
export const perPersonKey = (req) => (req.auth?.sub ? `user:${req.auth.sub}` : `ip:${req.ip}`)
