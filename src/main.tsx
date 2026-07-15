import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

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
