/* eslint-env serviceworker */
/* global self, clients */

// Imported into the Workbox-generated service worker via
// vite.config.js -> VitePWA -> workbox.importScripts. The PWA plugin uses the
// generateSW strategy, which cannot host custom code directly, and switching
// to injectManifest would mean owning precache wiring we currently get for
// free — so the push handlers live here instead.

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    // A push with a non-JSON body is not ours; show nothing rather than a
    // notification full of garbage.
    return
  }

  const title = payload.title || 'VolunTrack reminder'
  const options = {
    body: payload.body || 'Time to check on your volunteer work.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    // Collapses repeats of the same occurrence into one notification if the
    // push service happens to deliver twice.
    tag: payload.tag || 'voluntrack-reminder',
    data: { url: payload.url || '/reminders' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/reminders'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // Focus an existing tab rather than piling up new ones.
      for (const client of windows) {
        if ('focus' in client) {
          client.navigate(target)
          return client.focus()
        }
      }
      return clients.openWindow ? clients.openWindow(target) : undefined
    }),
  )
})
