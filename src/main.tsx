import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Check for a new deployed version whenever the app comes to the foreground.
// (Paired with the PWA's autoUpdate service worker, this applies + reloads.)
if ('serviceWorker' in navigator) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      navigator.serviceWorker
        .getRegistration()
        .then((r) => r?.update())
        .catch(() => {})
    }
  })
}
