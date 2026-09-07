import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
// GitHub Pages serves a project repo under /<repo>/. Overridable via BASE_PATH.
const base = process.env.BASE_PATH ?? '/'
const lite = process.env.VITE_MISE_EDITION === 'lite'
const appName = lite ? 'Mise Lite' : 'Mise'
// A human build stamp so Settings can show which version is actually running —
// the fastest way to tell a stale install from a current one.
const buildStamp = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'

export default defineConfig({
  base,
  define: {
    __BUILD__: JSON.stringify(buildStamp),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      /**
       * THE SHELL IS NOT PRECACHED. Everything else is.
       *
       * By default the generated worker precaches index.html and answers every
       * navigation from it. That is what let a worker keep serving a
       * two-hour-old app from a device that was online the whole time: the
       * shell in the cache named the old hashed assets, so the old assets are
       * what loaded, and nothing about being online changed that. The update
       * machinery — skipWaiting, clientsClaim, a reload on controllerchange, a
       * poll every 60s — was all in place and it still happened.
       *
       * So navigations go to the network first and fall back to the cache only
       * when there isn't one. Online, you always get the current shell, which
       * names the current assets; those are content-hashed and immutable, so
       * they come from cache instantly. Offline, the last shell is still there
       * and the app opens exactly as before. The offline guarantee is kept; the
       * ability to be silently two hours stale is not.
       */
      workbox: {
        // No .html — that is the whole point.
        globPatterns: ['**/*.{js,css,ico,png,svg,webmanifest,woff2}'],
        cleanupOutdatedCaches: true,
        navigateFallback: undefined,
        runtimeCaching: [
          {
            urlPattern: ({ request }: { request: Request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'mise-shell',
              // A slow connection in a shop must not mean staring at nothing:
              // after 4s, serve the last shell and carry on.
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 4 },
            },
          },
        ],
      },
      manifest: {
        name: appName,
        short_name: appName,
        description: lite
          ? 'A clean, offline smart grocery list — aisle-grouped, swipe to check.'
          : 'Snap it, paste it, or type it — one smart grocery list.',
        theme_color: '#f2f4f3',
        background_color: '#f2f4f3',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        id: base,
        // Absolute paths + PNG only. Relative paths and an SVG in the icon list
        // have both been implicated in Android minting a generic launcher icon;
        // this is the stable config, so the WebAPK stops getting re-generated.
        icons: [
          { src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: `${base}icon-maskable-192.png`, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: `${base}icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
})
