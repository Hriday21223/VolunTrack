Guidance for working with files in `server/`. Root-level architecture is in the top-level `CLAUDE.md`.

### Server request flow

`server.js` wires: `helmet` → `cors` (allowlist includes `FRONTEND_URL` env + localhost) → one route mounted *before* body parsing (`POST /api/contact/inbound`, using `express.raw()` because it verifies a Resend/svix webhook signature over the raw body) → `express.json` (1MB limit) → `translateErrors` → `rateLimitWait` (a 429 names the minutes to wait, from `Retry-After`) → `authenticate` (from `server/auth.js`) applied globally → a global rate limiter (`apiLimiter`, 600 req/15min) → route mounts under `/api/auth`, `/api/school`, `/api/organization`, `/api/logs`, `/api/parent`, `/api/contact`, `/api/reviews` (each with an additional `apiLimiter`). Password/PIN recovery email sending (`POST /api/send-reset-email`, defined inline in `server.js`) has its own stricter `emailLimiter` (20/hour) and falls back to an in-memory dev code log (`devCodeLog`) when SMTP env vars are unset.

**The global `authenticate` middleware is soft**: it decodes a bearer token if present and sets `req.auth = { sub, role, email }`, but never rejects a request itself — an unauthenticated request just gets `req.auth = null` and continues. Actual gating happens per-route via `requireAuth(...roles)` (also in `server/auth.js`), e.g. `requireAuth('admin')` or `requireAuth('school', 'school_staff')`; `requireAuth()` with no args just requires *any* valid user. When adding a route, you must explicitly add `requireAuth(...)` — forgetting it leaves the route open to any caller, since the global middleware won't have blocked it.

### Rate limits count people, not addresses

Students at one school share a public address on school Wi-Fi, so the global `apiLimiter`, `school.js`'s `limiter` and the everyday routers' `limiter`s key on `perPersonKey` (`server/rateKey.js`): the signed-in account, else the address. `authenticate` runs before `apiLimiter` for that. Keep address-only keys on the public and sign-in limiters (contact, passkeys, consent, handover, reviews, social sign-in), which guard against guessing.
