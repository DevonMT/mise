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
              // Only a real shell may replace the saved one. Workbox's default
              // also keeps status-0 responses, and a navigation the gateway
              // bounces to sign-in (the 7-day session lapsed) arrives as an
              // opaque redirect with status 0. Saved, it took the shell's place:
              // offline, the app "opened" to a sign-in page that needs the
              // network, so Mise would not open in a shop with no signal.
              cacheableResponse: { statuses: [200] },
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
        // Dark, though the default theme is light. Chrome paints an installed
        // Android app's system navigation bar from these, baked in when the
        // WebAPK is minted; the theme-color meta reaches only the status bar.
        // Light here left a white bar under the dark theme. A dark bar under the
        // light theme reads as deliberate; a white bar under the dark one does
        // not. --bg and --surface of the dark theme (src/ds/theme.css).
        theme_color: '#110f08',
        background_color: '#1e1c14',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        id: base,
        // Absolute paths + PNG only. Relative paths and an SVG in the icon list
        // have both been implicated in Android minting a generic launcher icon;
        // this is the stable config, so the WebAPK stops getting re-generated.
        // "Share to Mise" from the Android share sheet: a GET to the start page
        // (see src/shareTarget.ts). Personal edition only — Lite has no parser
        // to hand a link to. Changing the manifest re-mints the WebAPK, so this
        // goes out once, with the icon checked afterwards.
        ...(lite
          ? {}
          : {
              share_target: {
                action: base,
                method: 'GET',
                params: { title: 'title', text: 'text', url: 'url' },
              },
            }),
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
