import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve, dirname } from 'path'
import { readFileSync, copyFileSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { resolveSiteUrl } from './scripts/site-url.mjs'

// package.json is the single source of truth for the app version, and it is
// what the release tags track (v0.3.0 === "version": "0.3.0"). Read it here so
// the number shown on /status/system can never drift from the published
// release the way a hardcoded string would.
const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'))

// The on-device reader for "Scan a paper log" (#521): Tesseract's worker, its
// WebAssembly core (LSTM builds only, one per CPU feature level) and the
// English model, served from our own origin so the photo never leaves the
// device and the CSP needs no third-party script host. Copied into the build
// and served from node_modules in dev; loaded only when someone scans.
const TESSERACT_FILES = {
  'worker.min.js': 'node_modules/tesseract.js/dist/worker.min.js',
  'core/tesseract-core-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
  'core/tesseract-core-simd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'core/tesseract-core-relaxedsimd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
  'lang/eng.traineddata.gz': 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
}
const tesseractAssets = {
  name: 'voluntrack-tesseract-assets',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const name = req.url?.startsWith('/tesseract/') ? req.url.slice('/tesseract/'.length).split('?')[0] : null
      const from = name && TESSERACT_FILES[name]
      if (!from) return next()
      res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : 'application/octet-stream')
      res.end(readFileSync(resolve(from)))
    })
  },
  closeBundle() {
    for (const [name, from] of Object.entries(TESSERACT_FILES)) {
      const to = resolve('dist/tesseract', name)
      mkdirSync(dirname(to), { recursive: true })
      copyFileSync(resolve(from), to)
    }
  },
}

export default defineConfig(({ mode }) => {
  // Resolve VITE_SITE_URL ourselves (via Vite's own .env-loading logic) and
  // write the final value back to process.env *before* returning config, so
  // both index.html's %VITE_SITE_URL% placeholders and
  // import.meta.env.VITE_SITE_URL in client code see the same value, with a
  // safe localhost fallback when it's unset — without blocking a .env.local
  // override (Vite never lets .env files overwrite an already-set
  // process.env var).
  const env = loadEnv(mode, process.cwd(), '')
  process.env.VITE_SITE_URL = resolveSiteUrl(env)

  // Exposed the same way, for the same reason: set it on process.env before
  // returning config and Vite picks it up as import.meta.env.VITE_APP_VERSION,
  // so no new global needs declaring for eslint or jsconfig.
  process.env.VITE_APP_VERSION = pkg.version

  // The landing page calls the backend as it loads; when that's another origin
  // (production: VITE_API_URL is the Render URL), opening the connection early
  // saves ~270 ms (Lighthouse "preconnect to required origins"). crossorigin
  // matches the CORS fetches. A relative '/api' (dev) needs nothing.
  let apiOrigin = null
  try { apiOrigin = new URL(env.VITE_API_URL || '').origin } catch { /* relative or unset */ }
  const preconnectApi = {
    name: 'preconnect-api',
    transformIndexHtml: () => (apiOrigin
      ? [{ tag: 'link', attrs: { rel: 'preconnect', href: apiOrigin, crossorigin: '' }, injectTo: 'head' }]
      : []),
  }

  return {
    base: '/',

    plugins: [
      react(),
      preconnectApi,
      tesseractAssets,

      VitePWA({
        // The native apps (npm run build:app) ship the bundle inside the app
        // and update through the stores, so a service worker there would only
        // add a second cache that can serve a stale build after an update.
        disable: mode === 'app',
        registerType: 'autoUpdate',
        // Registered in src/main.jsx instead, so a refused registration (a
        // browser extension, private mode, blocked storage) is caught rather
        // than reported as an app error. The generated registerSW.js had no catch.
        injectRegister: false,
        devOptions: {
          enabled: false,
        },

        includeAssets: [
          'favicon-32.png',
          'apple-touch-icon.png',
          'icons/icon-192.png',
          'icons/icon-512.png',
          'icons/icon-512-maskable.png',
        ],

        manifest: {
          name: 'VolunTrack — Volunteer Hour Tracker',
          short_name: 'VolunTrack',
          description: 'Track volunteer hours, set goals, earn badges, and export reports.',
          theme_color: '#3f8344',
          background_color: '#f1f8f1',
          display: 'standalone',
          orientation: 'portrait',

          start_url: '/',
          scope: '/',

          // Square icons made from the 1024px app icon. The maskable one keeps
          // the logo inside the middle 80%, since Android crops to a circle.
          // (These files used to be missing, so installs had no icon.)
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },

        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          // The on-device paper-log reader (~15 MB) loads only when someone
          // scans, so it isn't precached for every visitor.
          // The easy-read font downloads only for people who turn it on (#553).
          globIgnores: ['tesseract/**', 'fonts/atkinson-*'],
          // Web Push handlers. generateSW can't host custom SW code, but it
          // can importScripts one — see public/push-sw.js.
          importScripts: ['/push-sw.js'],
        },
      }),
    ],

    resolve: {
      alias: [
        { find: '@', replacement: resolve('./src') },
        // The requirements policy (tenant-defined log rules) has to be applied
        // identically in the browser and on the server: the form shows the rule
        // before you submit, the API is what actually enforces it. Two copies
        // of that logic drift, and the drift shows up as "the form let me save
        // it but the server said no". One narrow alias to that single pure
        // module instead — deliberately not an alias to server/, which would
        // put db.js and the signing keys one import away from client code.
        { find: '@policy', replacement: resolve('./server/requirements.js') },
        // The join offer's rules and arithmetic have to be applied identically
        // in the browser and on the server: the landing-page banner quotes a price,
        // and POST /api/invoices/admin is what actually charges it. Two copies
        // drift, and the drift shows up as a school being billed something
        // other than the number it was shown. One narrow alias to that single
        // pure module instead — deliberately not an alias to server/, which
        // would put db.js and the signing keys one import away from client code.
        { find: '@promo', replacement: resolve('./server/promo.js') },
        // Sign-up age rules: the form explains them, POST /api/auth/register
        // enforces them. Same single-pure-module alias as above.
        { find: '@ageRules', replacement: resolve('./server/ageRules.js') },
      ],
    },

    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:10000',
          changeOrigin: true,
          secure: false,
        },
      },
    },
  }
})
