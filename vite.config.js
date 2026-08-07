import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'path'
import { resolveSiteUrl } from './scripts/site-url.mjs'

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

  return {
    base: '/',

    plugins: [
      react(),

      VitePWA({
        registerType: 'autoUpdate',
        devOptions: {
          enabled: false,
        },

        includeAssets: [
          'logo.png',
          'icons/icon-192.png',
          'icons/icon-512.png'
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

          icons: [
            {
              src: 'logo.png',
              sizes: 'any',
              type: 'image/png',
              purpose: 'maskable any',
            },
            {
              src: 'icons/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'maskable any',
            },
            {
              src: 'icons/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable any',
            },
          ],
        },

        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        },
      }),
    ],

    resolve: {
      alias: [
        { find: '@', replacement: resolve('./src') },
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
