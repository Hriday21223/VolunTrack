# Build settings for the native Android/iOS apps: `npm run build:app`
# (vite build --mode app, then cap sync). Committed on purpose — every value
# here is public and already ships in the website's JavaScript. Never put a
# secret in this file.
#
# The app serves its bundle from https://localhost (Android) or
# capacitor://localhost (iOS), so the relative /api the website uses would
# point at the phone itself — the backend needs its full address.
VITE_API_URL=https://voluntrack-backend-frrh.onrender.com/api
VITE_SITE_URL=https://volunteer-track-two.vercel.app
VITE_TURNSTILE_SITE_KEY=0x4AAAAAAFJoD8JyFF_Ev4rC
