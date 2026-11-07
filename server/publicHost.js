import dns from 'dns'
import { lookup } from 'dns/promises'
import https from 'https'
import { isIP } from 'net'

// For a URL our server will fetch because a school or organization typed it
// (an S3 endpoint, an SSO issuer): resolve the host and refuse anything that
// isn't a public internet address, so it can't be aimed at our own network,
// localhost, or a cloud metadata service — including through a public name
// that resolves to a private address (127.0.0.1.nip.io and the like).

function privateV4(ip) {
  const [a, b] = ip.split('.').map(Number)
  return a === 0 || a === 10 || a === 127
    || (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT
    || (a === 169 && b === 254) // link-local, cloud metadata
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224 // multicast and reserved
}

function privateV6(ip) {
  const v = ip.toLowerCase()
  if (v === '::' || v === '::1') return true
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return privateV4(mapped[1])
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v)
}

export function isPrivateAddress(ip) {
  const family = isIP(ip)
  if (family === 4) return privateV4(ip)
  if (family === 6) return privateV6(ip)
  return true
}

// Resolves to true only when every address the host resolves to is public.
export async function isPublicHost(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '')
  if (!host) return false
  if (isIP(host)) return !isPrivateAddress(host)
  try {
    const addresses = await lookup(host, { all: true, verbatim: true })
    return addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a.address))
  } catch {
    return false
  }
}

// A connect-time version of the check above, for https.request's `lookup`:
// the address it checks is the address it connects to. Checking a name
// first and fetching it later leaves room for DNS to change in between
// (rebinding), so a name that passed when a school saved its settings could
// point at our own network by the time the server uses it.
function publicOnlyLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err)
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options?.family || 4 }]
    if (list.length === 0 || list.some((a) => isPrivateAddress(a.address))) {
      return callback(Object.assign(new Error('That address points to a private network.'), { code: 'EPRIVATE' }))
    }
    if (options?.all) return callback(null, list)
    return callback(null, list[0].address, list[0].family)
  })
}

// fetch() for a URL a school or organization typed: https only, a public
// address checked at connect time, no redirects followed, a 15-second limit.
// Returns the small part of a fetch Response our callers use.
export function publicFetch(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    let u
    try { u = new URL(url) } catch { return reject(new Error('Bad address.')) }
    if (u.protocol !== 'https:') return reject(new Error('The address must use https.'))
    const host = u.hostname.replace(/^\[|\]$/g, '')
    if (isIP(host) && isPrivateAddress(host)) return reject(new Error('That address points to a private network.'))
    const payload = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(String(body))
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: `${u.pathname}${u.search}`,
      method,
      headers: { ...headers, ...(payload && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-length') ? { 'Content-Length': payload.length } : {}) },
      lookup: publicOnlyLookup,
      timeout: 15_000,
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          headers: { get: (name) => res.headers[String(name).toLowerCase()] ?? null },
          text: async () => text,
        })
      })
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('The request timed out.')))
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}
