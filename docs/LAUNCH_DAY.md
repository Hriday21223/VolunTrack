# Launch day checklist (Tue Dec 1, 2026)

## The week before

- [ ] Domain is live and verified in Brevo; `EMAIL_FROM` uses it.
- [ ] Brevo on a paid plan for launch week, and `EMAIL_DAILY_LIMIT` on Render set to its daily allowance.
- [ ] Render backend on a paid plan (stays awake, more memory). You can move back to free later.
- [ ] Run **Actions → Database snapshot → Run workflow** so there's a fresh copy.
- [ ] Sign up as a new student, school and parent on the live site; check every email arrives (inbox, not spam).
- [ ] Live-check robot is green (Admin → Incidents).
- [ ] Store apps approved, or the website ready on its own if they aren't.

## On the day: what to watch

| Where | Look for |
| --- | --- |
| Admin → Incidents | Live checks failing, new app errors |
| `/status` | Anything not green |
| Admin email | "VolunTrack has sent N of 300 emails today" (80% warning) |
| Render → Metrics | Memory near the limit, slow responses |
| Admin → Inbox | People stuck signing up |

## If something goes wrong

| Problem | What to do |
| --- | --- |
| Email nearly used up | Upgrade Brevo and raise `EMAIL_DAILY_LIMIT` on Render. Until then, digests and alerts already pause at 60% so sign-up codes keep working. |
| Site slow or timing out | Upgrade the Render plan (or a bigger one). Restart the service if memory is full. |
| Sign-ups failing | Check the Render logs for the error; tell people on Instagram you're on it. |
| Bad data saved / a bad change | Turn on `MAINTENANCE_MODE=1` on Render, then restore from a snapshot (docs/BACKUPS.md). |
| Something broken after a deploy | Roll back in Vercel (frontend) or Render (backend) to the previous deploy. |

## After the day

- [ ] Check Admin → Users sign-up counts.
- [ ] Answer the inbox.
- [ ] Turn off maintenance mode if it was on; decide whether to keep the paid plans.
