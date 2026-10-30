import { memo } from 'react'

const HUB = 'https://devondoes.dev'

/**
 * The estate bar, bar v2 (ds/chrome.css), at every width.
 *
 * Mise draws the markup and ds/chrome.js, loaded in index.html's head, fills it
 * in from /api/me: the avatar, the switcher and the theme menus. chrome.js edits
 * these nodes in place (an avatar into the button, a plain label for the switcher
 * when signed out), so React must never render over them: no props, memo, and
 * main.tsx draws it OUTSIDE App, so the loading and storage-locked screens have
 * the bar too. chrome.js looks for it once, when the document finishes loading.
 *
 * It used to be desktop-only, to give a phone's one row to the list. A v2 bar is
 * the only place the theme and the way to the other apps live, so it shows on a
 * phone too, and offline it is still there: the place stays a plain label and the
 * theme control still works (the estate cookie, not the network).
 *
 * The emblems and the avatar come from the hub; offline they are simply absent.
 */
export const EstateBar = memo(function EstateBar() {
  return (
    <header className="ds-bar" data-app="mise">
      <a className="ds-mark" href={`${HUB}/`}><img src={`${HUB}/emblems/hub.svg`} alt="" width="26" height="26" /><span>devondoes</span></a>
      <span className="ds-sep" aria-hidden="true">/</span>
      <button className="ds-switch" type="button" aria-haspopup="menu" aria-expanded="false"><img src={`${HUB}/emblems/mise.svg`} alt="" width="22" height="22" /><span>Mise</span></button>
      <span className="ds-fill" />
      <nav className="ds-nav" aria-label="Site">
        <a className="ds-people" href={`${HUB}/people`} aria-label="People" />
        <button className="ds-me" type="button" aria-haspopup="menu" aria-label="Account" />
      </nav>
      <button className="ds-theme" type="button" aria-haspopup="menu" aria-label="Theme" hidden />
    </header>
  )
})
