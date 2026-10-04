/**
 * "Share to Mise" from Android's share sheet.
 *
 * The manifest's `share_target` is a plain GET to the app's start page, so the
 * shared page arrives as query parameters — never a POST, which would need the
 * service worker to answer it. Chrome fills `url` only sometimes; most apps put
 * the address inside `text` ("Great chili recipe https://…"), so we look in all
 * three fields and take the first http(s) link.
 */

/** The query parameters the manifest asks Android to send. */
export const SHARE_PARAMS = { title: 'title', text: 'text', url: 'url' } as const

const LINK = /https?:\/\/[^\s<>"']+/i

/** The recipe link in a share-target query string, or null if it is not one. */
export function sharedLink(search: string): string | null {
  const q = new URLSearchParams(search)
  if (!q.has(SHARE_PARAMS.url) && !q.has(SHARE_PARAMS.text) && !q.has(SHARE_PARAMS.title)) return null
  for (const key of [SHARE_PARAMS.url, SHARE_PARAMS.text, SHARE_PARAMS.title]) {
    const m = (q.get(key) ?? '').match(LINK)
    if (m) return m[0].replace(/[.,;:!?)\]]+$/, '')
  }
  return null
}

/** True when the query string is a share-target hand-off at all (even without a link). */
export function isShareQuery(search: string): boolean {
  const q = new URLSearchParams(search)
  return q.has(SHARE_PARAMS.url) || q.has(SHARE_PARAMS.text) || q.has(SHARE_PARAMS.title)
}
