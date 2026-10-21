/**
 * Fetch a page for the link importer without letting the link reach anything
 * private.
 *
 * Mise runs on the mini itself, so a plain fetch() of a user's link can reach
 * 127.0.0.1, the LAN, the docker bridge (the AI broker at 172.30.0.1:8610)
 * and the platform. With one user that was Devon pointing at his own house;
 * with a friend on the Full tier it is a way in, and the page text comes back
 * to them through the parsed items.
 *
 * The check runs in the socket's own DNS lookup, so the address that is
 * checked is the address that is connected to. Checking first and then
 * calling fetch() would resolve twice, and a hostile DNS server can answer
 * "public" to the check and "127.0.0.1" to the connect. Redirects are
 * followed by hand for the same reason: every hop goes through the same
 * lookup.
 */
import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import { isIP } from 'node:net'
import zlib from 'node:zlib'

const MAX_REDIRECTS = 5
const MAX_BYTES = 3 * 1024 * 1024

export class BlockedAddressError extends Error {}

/** Whether an address is somewhere on the public internet. */
export function isPublicAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 0 || a === 10 || a === 127) return false          // this-net, private, loopback
    if (a === 100 && b >= 64 && b <= 127) return false           // carrier-grade NAT
    if (a === 169 && b === 254) return false                     // link-local, cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false            // private, incl. the docker bridges
    if (a === 192 && b === 168) return false                     // private, the LAN
    if (a === 192 && b === 0) return false                       // IETF protocol assignments
    if (a === 198 && (b === 18 || b === 19)) return false        // benchmarking
    if (a >= 224) return false                                   // multicast, reserved, broadcast
    return true
  }
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase()
    if (v === '::' || v === '::1') return false
    // IPv4 written as IPv6 (::ffff:127.0.0.1) is judged as the IPv4 it is.
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPublicAddress(mapped[1])
    if (/^f[cd]/.test(v)) return false                           // unique local
    if (/^fe[89ab]/.test(v)) return false                        // link-local
    if (v.startsWith('ff')) return false                         // multicast
    return true
  }
  return false
}

/** dns.lookup, refusing to hand back any address that is not public. */
function guardedLookup(
  hostname: string,
  options: object,
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '')
    const list = addresses as LookupAddress[]
    // Every answer must be public, not just the first: the socket may try any.
    const bad = list.find((a) => !isPublicAddress(a.address))
    if (!list.length || bad) {
      return callback(new BlockedAddressError(`${hostname} is not a public address`), '')
    }
    if ((options as { all?: boolean }).all) return callback(null, list)
    callback(null, list[0].address, list[0].family)
  })
}

export type SafeResponse = { status: number; contentType: string; body: string }

function once(url: URL, headers: Record<string, string>, signal: AbortSignal): Promise<http.IncomingMessage> {
  // A literal IP skips DNS entirely, so it is checked here instead.
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host) && !isPublicAddress(host)) {
    return Promise.reject(new BlockedAddressError(`${host} is not a public address`))
  }
  const mod = url.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const req = mod.request(url, {
      method: 'GET', headers, signal, lookup: guardedLookup as never,
    }, resolve)
    req.on('error', reject)
    req.end()
  })
}

function readBody(res: http.IncomingMessage): Promise<string> {
  const enc = String(res.headers['content-encoding'] ?? '').toLowerCase()
  const stream =
    enc === 'gzip' ? res.pipe(zlib.createGunzip())
    : enc === 'deflate' ? res.pipe(zlib.createInflate())
    : enc === 'br' ? res.pipe(zlib.createBrotliDecompress())
    : res
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let cut = false
    stream.on('data', (c: Buffer) => {
      if (cut) return
      size += c.length
      // A recipe page is never megabytes; a stream that is gets cut off.
      if (size > MAX_BYTES) { cut = true; res.destroy(); resolve(Buffer.concat(chunks).toString('utf8')); return }
      chunks.push(c)
    })
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    stream.on('error', reject)
  })
}

/** GET a public http(s) URL, following up to five redirects, each one checked. */
export async function safeGet(start: URL, headers: Record<string, string>, signal: AbortSignal): Promise<SafeResponse> {
  let url = start
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new BlockedAddressError('only http/https links work')
    }
    const res = await once(url, { ...headers, 'accept-encoding': 'gzip, deflate, br' }, signal)
    const status = res.statusCode ?? 0
    const loc = res.headers.location
    if (status >= 300 && status < 400 && loc) {
      res.resume()
      url = new URL(loc, url)
      continue
    }
    return { status, contentType: String(res.headers['content-type'] ?? ''), body: await readBody(res) }
  }
  throw new Error('the link redirected too many times')
}
