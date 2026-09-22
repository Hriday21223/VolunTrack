# Deploy VolunteerTrack Backend to Render

This guide will help you deploy the VolunteerTrack backend to Render for real cross-device sync functionality.

## Prerequisites

- GitHub account with VolunteerTrack repository
- Render account (free tier available)
- Neon database connection string (already configured)

## Step 1: Update GitHub Repository

First, commit and push the changes we made:

```bash
git add .
git commit -m "feat: add backend API support for sync PIN and configure for Render deployment"
git push
```

## Step 2: Deploy to Render

### Option A: Automatic Blueprint Deployment (Recommended)

1. Go to [render.com](https://render.com) and sign up/login
2. Click "New +" → "Blueprint"
3. Connect your GitHub repository
4. Select the `VolunteerTrack` repository
5. Render will detect the `render.yaml` file
6. Click "Apply" to deploy

### Option B: Manual Web Service Deployment

1. Go to [render.com](https://render.com) and sign up/login
2. Click "New +" → "Web Service"
3. Connect your GitHub repository
4. Configure:
   - **Name**: voluntrack-backend
   - **Runtime**: Node
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `node server.js`
   - **Plan**: Free

## Step 3: Configure Environment Variables

After creating the service, add these environment variables in Render:

### Required Variables:
- `DATABASE_URL`: (your Neon PostgreSQL connection string)
- `JWT_SECRET`: (generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)
- `NODE_ENV`: `production`

### Optional Variables (for email features):
- `EMAIL_HOST`: `smtp.gmail.com`
- `EMAIL_PORT`: `587`
- `EMAIL_SECURE`: `false`
- `EMAIL_USER`: (your Gmail address)
- `EMAIL_PASSWORD`: (your Gmail app password)
- `EMAIL_FROM`: `volunteertrack@googlegroups.com`

### Optional Admin Account:
- `ADMIN_EMAIL`: Your admin email
- `ADMIN_PASSWORD`: Strong password for admin

### Optional — Parent weekly progress digest:
- `CRON_SECRET`: long random value; the digest cron endpoint
  (`POST /api/parent/internal/run-weekly-digest`) rejects any request whose
  `x-cron-key` header doesn't match. Leave unset to disable the endpoint.
- `PUBLIC_BACKEND_URL`: this backend's public origin (e.g.
  `https://voluntrack-backend-frrh.onrender.com`), used for the unsubscribe
  link in digest emails.

Then, in the GitHub repo (Settings → Secrets and variables → Actions): add a
**secret** `CRON_SECRET` (same value as above) and a **variable**
`PUBLIC_BACKEND_URL` (same origin). The `.github/workflows/parent-weekly-digest.yml`
workflow runs Mondays ~13:00 UTC and `curl`s the endpoint; requires `EMAIL_*`
set on the backend to actually send. Trigger it manually from the Actions tab
(with `dry_run: true` to preview without sending).

## Step 4: Deploy Frontend to Vercel

This is the live path: the frontend runs on Vercel at
<https://volunteer-track-two.vercel.app>.

The Vercel project is **not** connected to this repo — there is no Git
integration, so merging to `main` does not by itself ship anything from
Vercel's side. `.github/workflows/deploy-vercel.yml` is what deploys: every
push to `main` builds and deploys production, a PR gets a preview, and
`workflow_dispatch` lets you pick either by hand. It builds on the GitHub
runner rather than on Vercel because `scripts/prerender.mjs` needs Chrome and
Vercel's build image is missing libraries it wants — so prerendering silently
skips there. The workflow's "Verify" step fails the deploy if the prerendered
pages did not come out, instead of trusting a green build.

One-time setup:

1. Create the project once (`npx vercel link`, or import it in the dashboard).
   `vercel.json` in the repo root holds the build config (`npm run build`,
   output `dist`, `cleanUrls`, SPA fallback rewrite).
2. Set these repo secrets so the workflow can deploy (the org/project IDs live
   in `.vercel/project.json`, which is gitignored):

   ```bash
   gh secret set VERCEL_TOKEN       # https://vercel.com/account/tokens
   gh secret set VERCEL_ORG_ID
   gh secret set VERCEL_PROJECT_ID
   ```

3. Add the environment variables in the Vercel dashboard (Project → Settings →
   Environment Variables), for Production:

   ```bash
   VITE_API_URL=https://voluntrack-backend.onrender.com/api
   VITE_SITE_URL=https://volunteer-track-two.vercel.app
   ```

   The workflow runs `vercel pull` before building, so the bundle is built
   against exactly these values. `VITE_SITE_URL` should be the site's own
   public URL (no trailing slash) — it's baked into canonical/Open Graph tags
   and `robots.txt`/`sitemap.xml` at build time. If you attach a custom domain
   later, update this value and redeploy so SEO tags follow automatically — no
   code changes needed. Note `VITE_SITE_URL` is currently unset in the Preview
   environment, so preview builds fall back to localhost in their SEO files;
   that's fine for a test deploy, but it's why previews shouldn't be promoted
   by hand.

4. Back in Render, set `FRONTEND_URL` on the backend service to the Vercel URL
   so CORS allows it.

To deploy manually instead: `npx vercel --prod` (or re-run the workflow from
the Actions tab), but prefer the workflow — a local `vercel build` sets
`VERCEL=1` and skips prerendering, shipping a plain SPA shell for the SEO
pages.

## Step 4b: Deploy Frontend to Cloudflare Workers (alternative)

Cloudflare now recommends **Workers Static Assets** over classic Pages for new
projects (Pages still works, but new features target Workers). `wrangler.jsonc`
in the repo root already configures this as a static-asset-only Worker (no
server-side Worker script — the app calls its API on the separate Render
backend, not through this Worker).

1. Go to the [Cloudflare dashboard](https://dash.cloudflare.com) → Compute (Workers) → Create → Import a repository (this is "Workers Builds", Cloudflare's Git-connected CI/CD)
2. Select the `VolunTrack` repository
3. Cloudflare should detect `wrangler.jsonc` automatically. Confirm the build config:
   - **Build command**: `npm run build`
   - **Deploy command**: `npx wrangler deploy` (default)
4. Add environment variables (Worker → Settings → Environment variables):

   ```bash
   VITE_API_URL=https://voluntrack-backend.onrender.com/api
   VITE_SITE_URL=https://your-worker.workers.dev
   ```

5. Deploy. Note the assigned `*.workers.dev` URL (or your custom domain).
6. Back in Render, set `FRONTEND_URL` on the backend service to that Workers URL so CORS allows it.

Client-side SPA routing is handled by `assets.not_found_handling` in
`wrangler.jsonc` (`public/_redirects` also ships in `dist/` and works the same
way, for parity with other static hosts). Cloudflare's Workers Builds image,
like Vercel's, is missing shared libraries Puppeteer's Chrome needs —
`scripts/prerender.mjs` detects this (`WORKERS_CI=1`, set automatically by
Workers Builds) and skips SEO prerendering rather than hanging the build,
falling back to a plain client-rendered SPA.

To deploy manually instead of via Git CI: `npm run build && npx wrangler deploy` (requires `npx wrangler login` once).

## Step 5: Test Cross-Device Sync

1. **Desktop**: Go to your deployed site URL
2. **Register/Login** with your account (now using backend)
3. **Settings** → Generate sync PIN
4. **Mobile**: Open same URL on phone
5. **Sync Login** → Enter the PIN
6. **Success!** You should be logged in on both devices

## Troubleshooting

### Backend fails to start:
- Check Render logs for errors
- Verify DATABASE_URL is correct
- Ensure JWT_SECRET is set

### Frontend can't connect to backend:
- Check VITE_API_URL is set correctly
- Verify backend is deployed and running
- Check CORS settings

### Sync PIN doesn't work across devices:
- Ensure both devices are using the backend (not local storage)
- Check browser console for API errors
- Verify JWT token is being stored

## Architecture

- **Frontend**: Vercel (static React app; Cloudflare Workers as an alternative)
- **Backend**: Render (Node.js + Express)
- **Database**: Neon (PostgreSQL)
- **Auth**: JWT tokens stored in localStorage
- **Sync**: PIN-based authentication via backend API

## Cost

- **Render**: Free tier (750 hours/month)
- **Neon**: Free tier (0.5GB storage, ~200 hours compute)
- **Vercel / Cloudflare Workers**: Free tier

Total: **$0/month** for hobby usage!