import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'path'

export default defineConfig({
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
})