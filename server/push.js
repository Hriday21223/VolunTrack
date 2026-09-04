import webpush from 'web-push'

// Web Push delivery. Opt-in exactly like server/turnstile.js and
// server/cloudflare.js: with the VAPID keys unset every call reports
// "not configured" and the reminder routes degrade to a clear 503, so local
// dev and any deployment without keys keep working unchanged.
//
// Generate a keypair with:  npx web-push generate-vapid-keys

let configured = null

export function pushConfigured() {
  if (configured === null) {
    const pub = process.env.VAPID_PUBLIC_KEY
    const priv = process.env.VAPID_PRIVATE_KEY
    configured = Boolean(pub && priv)
    if (configured) {
      // The subject must be a mailto: or https: URL identifying the sender;
      // push services reject anything else.
      webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:volunteertrackinfo@gmail.com',
        pub,
        priv,
      )
    }
  }
  return configured
}

export function vapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null
}

/**
 * @returns {Promise<{ ok: boolean, gone: boolean, error?: string }>}
 * `gone` means the push service says this subscription is dead (404/410) and
 * the caller should delete it — otherwise the table fills with endpoints that
 * can never receive anything.
 */
export async function sendPush(subscription, payload) {
  if (!pushConfigured()) return { ok: false, gone: false, error: 'Push is not configured.' }
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
      { TTL: 60 * 60 },
    )
    return { ok: true, gone: false }
  } catch (error) {
    const status = error?.statusCode
    return { ok: false, gone: status === 404 || status === 410, error: error?.message || String(error) }
  }
}
