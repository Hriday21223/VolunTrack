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
2. **Server-backed mode (optional)**: when `DATABASE_URL` is set, `server.js` boots a Postgres-backed Express API for accounts and school dashboards. `server/db.js` owns the schema (`users`, `schools`, `logs`, `goals`) and connection; `server/auth.js` handles JWT signing/verification and bcrypt password hashing; `server/routes/{auth,school,logs,parent}.js` are the route handlers; `server/ids.js` generates IDs/tokens.

`src/lib/logSync.js` and `src/lib/agent.js` bridge the two: logs authored locally can sync to the server side. When editing sync logic, check both the localStorage shape (`storage.js`) and the Postgres schema (`db.js`) stay compatible — this is not enforced by types.

### Server request flow

`server.js` wires: `helmet` → `cors` (allowlist includes `FRONTEND_URL` env + localhost) → `express.json` (1MB limit) → a global rate limiter (`apiLimiter`, 100 req/15min) → `authenticate` middleware (JWT, from `server/auth.js`) applied globally → route mounts under `/api/auth`, `/api/school`, `/api/logs`, `/api/parent` (each with an additional `apiLimiter`). Password/PIN recovery email sending (`POST /api/send-reset-email`, defined inline in `server.js`) has its own stricter `emailLimiter` (20/hour) and falls back to an in-memory dev code log (`devCodeLog`) when SMTP env vars are unset.

### Frontend structure

```
src/
  api/         # data layer over localStorage (src/api/index.js)
  components/  # reusable UI (cards, buttons, charts)
  hooks/       # shared React hooks (useLocalStorage, useTheme, etc.)
  lib/         # pure utilities: achievements, date math, PDF/CSV export, log sync, recovery codes
  pages/       # route-level pages (one per route in App.jsx / React Router)
  utils/       # small helpers (cn, format)
```

Path alias `@` → `src/` (configured in `vite.config.js` and `jsconfig.json`).

### Notable conventions

- Dark mode is opt-in per device, persisted at `voluntrack:theme`.
- Drag-and-drop proof uploads are read via `FileReader` and stored as base64 in localStorage — keep proof files under ~1MB, since this inflates localStorage.
- Backend security posture (see `SECURITY.md`): rate limiting, input validation, parameterized Postgres queries via `pg`. Preserve parameterized queries when touching `server/db.js` or route handlers — no string-concatenated SQL.
- `scripts/generate-seo-files.mjs` runs as `prebuild` and generates SEO-related static files consumed by `index.html` (`%VITE_SITE_URL%` placeholders) — `scripts/site-url.mjs` resolves the site URL from env for both this script and `vite.config.js`.
- Deployment targets: Render (`render.yaml`) for the backend, Netlify (`netlify.toml`) or Vercel (`vercel.json`) for the frontend — see `DEPLOYMENT.md` for details.
