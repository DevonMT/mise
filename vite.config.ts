import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
// GitHub Pages serves a project repo under /<repo>/. Overridable via BASE_PATH.
const base = process.env.BASE_PATH ?? '/'
const lite = process.env.VITE_MISE_EDITION === 'lite'
const appName = lite ? 'Mise Lite' : 'Mise'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: appName,
        short_name: appName,
        description: lite
          ? 'A clean, offline smart grocery list — aisle-grouped, swipe to check.'
          : 'Snap it, paste it, or type it — one smart grocery list.',
        theme_color: '#0e7c5b',
        background_color: '#f7f3ec',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        id: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // Both maskable sizes — some Android launchers look for a 192 maskable
          // specifically, and fall back to a generic icon if only 512 exists.
          {
            src: 'icon-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
})
