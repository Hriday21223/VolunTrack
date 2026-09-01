# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run dev       # Vite dev server at http://localhost:5173 (client-only, localStorage mode)
npm run backend   # Express API at http://localhost:10000 (server.js) — Vite proxies /api to it in dev
npm run build     # prebuild runs scripts/generate-seo-files.mjs, then vite build to /dist
npm run preview   # preview the production build
npm run lint      # eslint .
```

There is no test suite; CI (`.github/workflows/ci.yml`) only runs `npm run lint` and `npm run build` on push/PR to `main`.

To run the full backend locally, copy `.env.example` to `.env` and set `DATABASE_URL` (Postgres), `JWT_SECRET`, and optionally SMTP vars (`EMAIL_HOST`/`EMAIL_PORT`/`EMAIL_USER`/`EMAIL_PASSWORD`) — without SMTP config, recovery codes are shown in the UI instead of emailed. Without `DATABASE_URL`, the backend runs in email-only mode (no accounts API).

## Architecture

This app has two parallel, loosely-coupled data layers, and most nontrivial changes touch the boundary between them:

1. **Client-only mode (default)**: all state lives in `localStorage` under the `voluntrack:` namespace (`voluntrack:user`, `voluntrack:logs`, `voluntrack:goals`, `voluntrack:achievements`, `voluntrack:theme`). `src/api/index.js` is the data-access layer over localStorage; `src/lib/storage.js` defines the read/write rules and `src/lib/achievements.js` defines badge-earning logic. The app is fully usable with no backend running.
2. **Server-backed mode (optional)**: when `DATABASE_URL` is set, `server.js` boots a Postgres-backed Express API for accounts, school/organization dashboards, public volunteer tasks, and review moderation. `server/db.js` owns the schema and connection — beyond the core `users`/`schools`/`logs`/`goals` tables, it also covers `organizations` (multi-school orgs), `public_tasks`/`public_task_signups` (with attendance tracking), `supervisor_verifications` (hour-verification workflow), `parent_child_links`, `school_invites`/`organization_invites`, `contact_messages`, and `reviews` (moderation queue for the public testimonials on `About.jsx`); most migrations are additive `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements run on boot rather than a migration tool. `server/auth.js` handles JWT signing/verification and bcrypt password hashing; `server/routes/{auth,school,organization,logs,parent,contact,reviews}.js` are the route handlers; `server/ids.js` generates IDs/tokens.

`src/lib/logSync.js` and `src/lib/agent.js` bridge the two: logs authored locally can sync to the server side. When editing sync logic, check both the localStorage shape (`storage.js`) and the Postgres schema (`db.js`) stay compatible — this is not enforced by types.

Request-handling flow, middleware order, and the auth-gating pattern for `server/` are in `server/CLAUDE.md`.

### Roles

Six roles gate routes and dashboards: `student`, `volunteer`, `parent`, `school`, `school_staff`, `org`, `admin` (see `users_role_check` constraints in `server/db.js` and `requireAuth(...)` calls in `server/routes/*.js`). `organizations` can own multiple `schools` (`schools.organization_id`); `org` accounts manage their schools' invites, `school`/`school_staff` manage their own students/staff, `parent` accounts link to student accounts via `parent_child_links`, and `admin` has cross-cutting access (school/org approval, payment status, review moderation, contact-message replies).

### Notable conventions

- Path alias `@` → `src/` (configured in `vite.config.js` and `jsconfig.json`).
- Dark mode is opt-in per device, persisted at `voluntrack:theme`.
- Drag-and-drop proof uploads are read via `FileReader` and stored as base64 in localStorage — keep proof files under ~1MB, since this inflates localStorage.
- Backend security posture (see `SECURITY.md`): rate limiting, input validation, parameterized Postgres queries via `pg`. Preserve parameterized queries when touching `server/db.js` or route handlers — no string-concatenated SQL.
- `server/turnstile.js` (`verifyTurnstile()` middleware) guards the public unauthenticated write endpoints (`POST /api/contact`, `POST /api/auth/register`, `POST /api/{school,organization}/register`) with Cloudflare Turnstile; the client widget is `src/components/Turnstile.jsx` (config in `src/lib/turnstile.js`). Both are no-ops unless `TURNSTILE_SECRET_KEY` / `VITE_TURNSTILE_SITE_KEY` are set — if you add the check to a new endpoint, wire the widget into its form in the same change so the two stay in sync.
- `scripts/generate-seo-files.mjs` runs as `prebuild` and generates SEO-related static files consumed by `index.html` (`%VITE_SITE_URL%` placeholders) — `scripts/site-url.mjs` resolves the site URL from env for both this script and `vite.config.js`.
- Deployment targets: Render (`render.yaml`) for the backend, Netlify (`netlify.toml`), Vercel (`vercel.json`), or Cloudflare Workers Static Assets (`wrangler.jsonc`) for the frontend — see `DEPLOYMENT.md` for details.
- Scheduled work runs from GitHub Actions (`.github/workflows/*.yml` `schedule:` cron), not on Render (its free tier has no cron and sleeps when idle) — a workflow either runs a `scripts/*.mjs` (e.g. `notify-daily-scan.mjs`) or `curl`s a backend endpoint (e.g. `keep-warm.yml`). The **parent weekly progress digest** does the latter: `server/digest.js` builds/renders/sends; `POST /api/parent/internal/run-weekly-digest` (guarded by an `x-cron-key` header vs. `CRON_SECRET`) is hit weekly by `parent-weekly-digest.yml`; `POST /api/parent/admin/send-weekly-digest` is the admin/testing trigger (`{ weekStart?, parentId?, force?, dryRun? }`). Idempotency: `parent_digest_sends (parent_id, week_start)`. Opt-out: `users.weekly_digest_opt_out` + `users.digest_unsub_token`, public `GET /api/parent/digest/unsubscribe/:token`.
