// Whether DATABASE_URL points at a database on this machine. Local
// development must never share the live database: test accounts made while
// trying something out would become real, signable accounts on the live site.
// Used by the dev-startup warning in server.js and to gate
// scripts/seed-test-accounts.mjs.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export function isLocalDatabaseUrl(url = process.env.DATABASE_URL) {
  if (!url) return false
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname)
  } catch {
    return false
  }
}
