import { lookup } from 'dns/promises'
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
