// Wallet cards that update themselves (#730). Hours change in many places
// (new entries, approvals, send-backs, deletes), so instead of hooking each
// one, a check every 15 minutes recomputes what each saved card would show
// and, when it changed, updates the Google card in place and tells every
// phone holding the Apple card to fetch it again (an empty APNs push with the
// pass type as topic, sent with the pass certificate). Off until the wallet
// keys are set.
import http2 from 'node:http2'
import { query, hasDatabase } from './db.js'
import {
  walletSummary, cardFingerprint, updateGoogleCard, googleWalletConfigured,
  appleWalletConfigured, appleWebServiceUrl, applePushCredentials,
} from './wallet.js'

const EVERY_MS = 15 * 60 * 1000
const BATCH = 500

/** Sends the "your pass changed" push to each token; returns tokens Apple says are gone. */
async function pushApple(tokens) {
  if (!tokens.length) return []
  const { cert, key } = applePushCredentials()
  const session = http2.connect('https://api.push.apple.com:443', { cert, key })
  session.on('error', (e) => console.error('wallet push connection failed:', e.message))
  const gone = []
  try {
    await Promise.all(tokens.map((token) => new Promise((resolve) => {
      const req = session.request({
        ':method': 'POST',
        ':path': `/3/device/${token}`,
        'apns-topic': process.env.APPLE_PASS_TYPE_ID,
        'content-type': 'application/json',
      })
      req.setTimeout(10_000, () => { req.close(); resolve() })
      req.on('response', (h) => { if (h[':status'] === 410 || h[':status'] === 400) gone.push(token) })
      req.on('error', () => resolve())
      req.on('close', resolve)
      req.end('{}')
    })))
  } finally {
    session.close()
  }
  return gone
}

/** One pass over the saved cards. Returns counts only. */
export async function runWalletUpdates() {
  const google = googleWalletConfigured()
  const apple = appleWalletConfigured() && Boolean(appleWebServiceUrl())
  if (!google && !apple) return { checked: 0, changed: 0 }
  const { rows } = await query(
    `SELECT user_id, serial, apple, google, shown FROM wallet_cards
      WHERE checked_at IS NULL OR checked_at < now() - interval '10 minutes'
      ORDER BY checked_at NULLS FIRST LIMIT $1`,
    [BATCH],
  )
  let changed = 0
  for (const card of rows) {
    try {
      const s = await walletSummary(card.user_id)
      if (!s) continue
      const fp = cardFingerprint(s)
      if (fp === card.shown) {
        await query('UPDATE wallet_cards SET checked_at = now() WHERE user_id = $1', [card.user_id])
        continue
      }
      changed += 1
      await query('UPDATE wallet_cards SET shown = $2, updated_at = now(), checked_at = now() WHERE user_id = $1', [card.user_id, fp])
      if (google && card.google) await updateGoogleCard(card.user_id, s)
      if (apple && card.apple) {
        const { rows: devices } = await query('SELECT DISTINCT push_token FROM wallet_apple_devices WHERE serial = $1', [card.serial])
        const gone = await pushApple(devices.map((d) => d.push_token))
        if (gone.length) await query('DELETE FROM wallet_apple_devices WHERE push_token = ANY($1)', [gone])
      }
    } catch (error) {
      console.error('wallet update failed:', error.message)
    }
  }
  return { checked: rows.length, changed }
}

let timer = null
export function startWalletUpdates() {
  if (timer || !hasDatabase()) return
  timer = setInterval(() => { runWalletUpdates().catch((e) => console.error('wallet updates failed:', e.message)) }, EVERY_MS)
  timer.unref?.()
}
