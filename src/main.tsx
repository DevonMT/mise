import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { configureTheme, startTheme } from './ds/theme'
import { migrateStaples } from './db'
import { hydrateSettings, migrateSettings, readSetting, setSetting } from './prefs'

/*
 * Persist the theme through the sync layer, so choosing dark on the phone
 * reaches the laptop. The shared module defaults to localStorage; Mise is the
 * app that has somewhere better to put it.
 *
 * Reads stay synchronous against localStorage underneath, which is what lets
 * the first paint be correct — a synced value arriving later is applied by the
 * settings hydration below.
 */
configureTheme({
  read: () => readSetting('mise.theme'),
  write: (choice) => {
    void setSetting('mise.theme', choice).catch(() => {
      try {
        localStorage.setItem('mise.theme', choice)
      } catch {
        /* the choice still applies for this session */
      }
    })
  },
  clear: () => {
    void setSetting('mise.theme', 'system').catch(() => {
      try {
        localStorage.removeItem('mise.theme')
      } catch {
        /* nothing cached */
      }
    })
  },
})

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
  .catch(() => {
    /* retried on the next open */
  })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
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
