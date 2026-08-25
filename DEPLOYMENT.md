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

## Step 4: Deploy Frontend to Netlify

Once your backend is deployed (e.g., `https://voluntrack-backend.onrender.com`):

1. Go to [netlify.com](https://netlify.com) and sign up/login
2. Click "Add new site" → "Import an existing project"
3. Connect your GitHub repository and select `VolunteerTrack`
4. Netlify will detect the `netlify.toml` (build command `npm run build`, publish dir `dist`)
5. Add the environment variable:

   ```bash
   VITE_API_URL=https://voluntrack-backend.onrender.com/api
   VITE_SITE_URL=https://your-site.netlify.app
   ```

   `VITE_SITE_URL` should be this site's own public URL (no trailing slash) —
   it's baked into canonical/Open Graph tags and `robots.txt`/`sitemap.xml`
   at build time. If you attach a custom domain later, update this value and
   redeploy so SEO tags follow automatically — no code changes needed.

6. Deploy. Note the assigned site URL (e.g., `https://your-site.netlify.app`).
7. Back in Render, set `FRONTEND_URL` on the backend service to that Netlify URL so CORS allows it.

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
way, for parity with Netlify). Cloudflare's Workers Builds image, like
Vercel's, is missing shared libraries Puppeteer's Chrome needs —
`scripts/prerender.mjs` detects this (`WORKERS_CI=1`, set automatically by
Workers Builds) and skips SEO prerendering rather than hanging the build,
falling back to a plain client-rendered SPA.

To deploy manually instead of via Git CI: `npm run build && npx wrangler deploy` (requires `npx wrangler login` once).

## Step 5: Test Cross-Device Sync

1. **Desktop**: Go to your Netlify site URL
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

- **Frontend**: Netlify, Vercel, or Cloudflare Workers (static React app)
- **Backend**: Render (Node.js + Express)
- **Database**: Neon (PostgreSQL)
- **Auth**: JWT tokens stored in localStorage
- **Sync**: PIN-based authentication via backend API

## Cost

- **Render**: Free tier (750 hours/month)
- **Neon**: Free tier (0.5GB storage, ~200 hours compute)
- **Netlify / Vercel / Cloudflare Workers**: Free tier

Total: **$0/month** for hobby usage!