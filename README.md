# VolunTrack

[![CI](https://github.com/Hriday21223/VolunteerTrack/actions/workflows/ci.yml/badge.svg)](https://github.com/Hriday21223/VolunteerTrack/actions/workflows/ci.yml)
[![Dependabot](https://github.com/Hriday21223/VolunteerTrack/security/dependabot)](https://github.com/Hriday21223/VolunteerTrack/security/dependabot)

**Live demo:** hosted on Netlify — update this link once the site is deployed (see [DEPLOYMENT.md](DEPLOYMENT.md))

A warm, focused volunteer hour tracker. Log hours, set goals, earn achievements, and generate reports for school or community organizations.

## Stack

- **React 18** + **Vite 5**
- **React Router 6**
- **Tailwind CSS 3** (custom `brand` greens + `earth` warm neutrals)
- **localStorage** persistence (client-side) + **PostgreSQL** (server-side accounts)
- **Express** backend with **bcrypt** + **JWT** authentication
- **jsPDF** + **jspdf-autotable** for report exports
- **lucide-react** for icons
- **date-fns** for date math

## Features

- 🔐 **Dual Auth**: Local auth (client-side) + Server auth (PostgreSQL + bcrypt + JWT)
- 📊 Dashboard with total/monthly hours, weekly chart, progress ring, recent activity
- ⏰ Log hours with drag-and-drop proof upload, supervisor verification fields
- 📅 Calendar view with session indicators per day
- 🎯 Goal tracking + 12 auto-earning achievement badges
- 📄 PDF volunteer log, CSV export, printable certificate
- 👤 Profile with avatar, school/grade, quick stats
- ⚙️ Settings: dark mode, goal management, account
- 🌐 Public About + Contact pages
- 🔒 **Security**: Rate limiting, input validation, parameterized queries

## Run it

```bash
npm install
npm run dev       # http://localhost:5173 (client-only mode)
npm run backend   # optional: full backend with Postgres + auth
npm run build     # production build to /dist
npm run preview   # preview the build
```

### Backend + Database (for school management features)

The backend requires PostgreSQL and environment variables. It can run in two modes:

1. **Email-only mode** (default): No database required. Only handles email sending for recovery flows.
2. **Full mode**: With `DATABASE_URL` set, provides user accounts, JWT auth, and school management.

To run the full backend:

```bash
cp .env.example .env
# Edit .env and set:
# - DATABASE_URL=postgres://user:password@host:5432/dbname
# - JWT_SECRET=your-secret-key
# - (Optional) ADMIN_EMAIL and ADMIN_PASSWORD to seed an admin account
npm run backend
```

### Recovery emails (optional)

The backend handles `POST /api/send-reset-email` for password/PIN recovery. Without SMTP
credentials, the UI shows the recovery code locally. To deliver real emails, set SMTP
variables in `.env`:

```bash
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USER=your-email@example.com
EMAIL_PASSWORD=your-app-password
EMAIL_FROM=volunteertrack@example.com
```

Any SMTP provider works (Resend, SendGrid, Mailgun, Gmail app passwords, etc.).

## Data model

All state lives in `localStorage` under the `voluntrack:` namespace:

| Key                      | Shape                                              |
|--------------------------|----------------------------------------------------|
| `voluntrack:user`        | `{ id, name, email, school, grade, avatar }`       |
| `voluntrack:logs`        | `VolunteerLog[]`                                   |
| `voluntrack:goals`       | `Goal[]`                                           |
| `voluntrack:achievements`| `string[]` (badge IDs the user has earned)         |
| `voluntrack:theme`       | `'light' \| 'dark'`                                |

See `src/lib/storage.js` and `src/lib/achievements.js` for the rules.

### Server-side (PostgreSQL)
When `DATABASE_URL` is configured, the backend stores:

| Table      | Purpose                                     |
|------------|---------------------------------------------|
| `users`    | User accounts with roles (admin/school/student) |
| `schools`  | School information and PINs                 |
| `logs`     | Volunteer hours (future sync from localStorage) |
| `goals`    | User goals (future sync from localStorage)  |

See `server/db.js` for the schema definition.

## Project layout

```
src/
  api/         # data layer over localStorage
  components/  # reusable UI (cards, buttons, charts, etc.)
  hooks/       # shared React hooks (useLocalStorage, useTheme, etc.)
  lib/         # pure utilities (achievements, date math, export)
  pages/       # route-level pages
  utils/       # small helpers (cn, format, etc.)
server/
  auth.js      # JWT token signing, password hashing, auth middleware
  db.js        # PostgreSQL connection and schema initialization
  routes/      # API route handlers (auth, schools, etc.)
  ids.js       # ID generation utilities
server.js      # Express server entry point
```

## Notes

- **Dual mode**: The app works in client-only mode (localStorage) for immediate use, and with the backend for school management features.
- **Gradual migration**: Users can start with local storage and optionally sync to the backend when schools implement the dashboard.
- Drag-and-drop proof uploads read files via `FileReader` and store as base64 — convenient, but it does inflate `localStorage`. Keep proof files under ~1 MB.
- Dark mode is opt-in per device; the choice is persisted in `voluntrack:theme`.
- **Security**: Backend includes rate limiting, input validation, and parameterized queries. See SECURITY.md for details.
