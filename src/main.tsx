import { StrictMode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
// Fredoka, Mise's display face, bundled so it is precached and works offline.
// Latin only, one weight: titles, recipe cards and section labels use it.
import '@fontsource/fredoka/latin-600.css'
import './index.css'
import App from './App.tsx'
import { EstateBar } from './EstateBar.tsx'
import { legacyThemeOnce } from './legacyTheme'
import { applyTheme, configureTheme, cookieThemeStore, readTheme, startTheme } from './ds/theme'
import { migrateStaples } from './db'
import { hydrateSettings, migrateSettings, readSetting } from './prefs'

/*
 * The theme is the estate's now: the ds_theme cookie, set from the bar's own
 * control and followed across every app (ds/react/theme.ts, SPEC-estate-shell).
 * Mise's own synced 'mise.theme' setting is only read, once, so nobody's pick
 * resets: with no cookie yet, the store adopts what this device had (the row's
 * localStorage mirror) and writes it to the cookie, and the platform adopts it
 * from there. That read happens once per device (legacyTheme.ts): nothing writes
 * 'mise.theme' any more, so a stale copy must not outvote a later pick.
 *
 * The cookie is read synchronously, which is what keeps the first paint right,
 * offline included: ds/chrome.js stamps it from the head before this runs.
 */
configureTheme(cookieThemeStore({ read: () => legacyThemeOnce(() => readSetting('mise.theme'), localStorage), write: () => {}, clear: () => {} }))

// Before the first render: stamping the root afterwards means a frame of the
// wrong theme, which on a dark-mode phone is a white flash in a dark room.
startTheme()

// Finish the v5 move of staples into the pantry. Outside the Dexie upgrade
// because it writes tombstones, and a sync that never learned of the deletion
// would hand every staple back on the next pull.
void migrateStaples().catch(() => {
  /* it will be retried on the next open */
})

/**
 * Preferences: lift whatever this device already had into rows, then bring the
 * cache back in line with them.
 *
 * The order matters. Migrating first means a device configured for months
 * pushes its store and aisle order rather than being overwritten by an empty
 * set from one that has never been set up — the exact loss this feature exists
 * to prevent.
 */
void migrateSettings()
  .then(() => hydrateSettings())
  // A device that never had a pick of its own may only learn the old one here,
  // from the synced row: with no cookie, reading the theme adopts it.
  .then(() => applyTheme(readTheme()))
  .catch(() => {
    /* retried on the next open */
  })

// Drawn synchronously: ds/chrome.js looks for the estate bar once, when the document finishes loading, and a
// render React schedules for later would miss it (the avatar and menus would never fill in).
flushSync(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <EstateBar />
      <App />
    </StrictMode>,
  ),
)

// Persistent storage is NOT requested here any more.
//
// It used to be, on every load, because IndexedDB was the only copy of the
// lists and an eviction lost them outright. Sync changed that: with an account,
// the device holds a cache of something the server also has, and eviction costs
// a re-download rather than the data.
//
// Firefox answers persist() with a permission prompt, so asking on load meant
// prompting people whose data was already safe, before they had any data, with
// no explanation of what was being asked — which is how a permission gets
// denied permanently. It now lives in Settings, offered only when it actually
// matters: when nothing is syncing this device.

// Keep the installed app from getting stuck on an old cached build.
//
// The service worker skipWaiting()s and claims clients, so a new version takes
// control on its own — but that does NOT reload the page already in memory, and
// Android often restores a PWA's old process instead of navigating fresh. So we
// reload once when a new worker actually takes over, and poll for updates while
// open (visibilitychange alone misses a long-lived session).
if ('serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller)
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Skip the very first claim on an uncontrolled first visit — nothing to update.
    if (reloading || !hadController) return
    reloading = true
    window.location.reload()
  })

  const check = () =>
    navigator.serviceWorker
      .getRegistration()
      .then((r) => r?.update())
      .catch(() => {})

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check()
  })
  window.setInterval(check, 60_000)
}
