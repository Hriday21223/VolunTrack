# VolunTrack

[![CI](https://github.com/Hriday21223/VolunTrack/actions/workflows/ci.yml/badge.svg)](https://github.com/Hriday21223/VolunTrack/actions/workflows/ci.yml)
[![Dependabot](https://img.shields.io/badge/dependabot-enabled-brightgreen?logo=dependabot)](https://github.com/Hriday21223/VolunTrack/security/dependabot)
[![Deploy frontend](https://github.com/Hriday21223/VolunTrack/actions/workflows/deploy-vercel.yml/badge.svg)](https://github.com/Hriday21223/VolunTrack/actions/workflows/deploy-vercel.yml)

**Live demo:** <https://volunteer-track-two.vercel.app> (frontend on Vercel, backend on Render — see [DEPLOYMENT.md](DEPLOYMENT.md))

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

**For students and volunteers** (free, no account needed for local-only use)
- Log hours with activity, category, times, location, notes and proof; a Calendar view; goals with a progress ring and pace toward a deadline
- 12 automatically earned achievement badges
- Reports: PDF, CSV and a printable certificate, plus submitting a report to your school
- Supervisor verification by signature — in person, by an emailed one-time link, or via QR code
- Reminders, a public Opportunities list of volunteer tasks, and signed, verifiable transcripts
- Cross-device sync with a sync PIN; two-factor authentication (authenticator app) and passkeys

**For parents** — a read-only family dashboard of a linked child's hours (from the moment they link) and a weekly progress email

**For volunteer task makers** — post tasks, approve sign-ups, message volunteers, and sign off hours in bulk

**For schools and organizations** (paid; sign-up needs a one-time registration code or invite from us)
- Student roster and report review, co-admins, announcements to students
- Requirements: required fields, custom questions, hour goals and signature rules, inherited from an organization by its schools
- School single sign-on, and proof files kept in the school's own storage bucket
- An access audit trail for student data

**For the admin** — schools, organizations, invoices, registration codes, announcements, reviews, incidents and the contact inbox

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
When `DATABASE_URL` is configured, the backend stores accounts for seven roles (student, volunteer, parent, school, school_staff, org, admin) and everything the server-backed features need — logs, schools and organizations, parent links, volunteer tasks and sign-ups, verifications, invoices, registration codes, announcements and the audit trail. Migrations are additive and run on boot.

See `server/db.js` for the schema and `CLAUDE.md` for how the pieces fit together.

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
- **Gradual migration**: Users can start with local storage and later create an account; logs authored locally sync to the server (`src/lib/logSync.js`).
- Drag-and-drop proof uploads read files via `FileReader` and store as base64 — convenient, but it does inflate `localStorage`. Keep proof files under ~1 MB.
- Dark is the default theme; a device's choice is persisted in `voluntrack:theme`.
- **Security**: Backend includes rate limiting, input validation, and parameterized queries. See SECURITY.md for details.

## License

Copyright (c) 2026 Hriday Karnatam. **All rights reserved.**

This project is proprietary. The source is visible here for reference only —
it is **not** open source. You may not use, copy, modify, redistribute, host,
or deploy this software or any part of it without prior written permission.
See [LICENSE](LICENSE) for the full terms. Permission requests:
volunteertrackinfo@gmail.com
