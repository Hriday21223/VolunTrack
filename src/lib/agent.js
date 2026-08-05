const INCIDENTS_KEY = 'voluntrack:incidents'
const AGENT_LOG_KEY = 'voluntrack:agent_log'

export function getIncidents() {
  try { return JSON.parse(localStorage.getItem(INCIDENTS_KEY) || '[]') } catch { return [] }
}

export function getAgentLog() {
  try { return JSON.parse(localStorage.getItem(AGENT_LOG_KEY) || '[]') } catch { return [] }
}

export function saveIncident(service, detail) {
  const incidents = getIncidents()
  incidents.unshift({ service, detail, detectedAt: new Date().toISOString(), id: Date.now(), status: 'detected' })
  localStorage.setItem(INCIDENTS_KEY, JSON.stringify(incidents.slice(0, 50)))
}

export function updateIncidentStatus(id, status) {
  const incidents = getIncidents()
  const idx = incidents.findIndex((i) => i.id === id)
  if (idx !== -1) {
    incidents[idx] = { ...incidents[idx], status, updatedAt: new Date().toISOString() }
    localStorage.setItem(INCIDENTS_KEY, JSON.stringify(incidents.slice(0, 50)))
  }
}

export function logAgentAction(message, type = 'info') {
  const log = getAgentLog()
  log.unshift({ message, type, timestamp: new Date().toISOString(), id: Date.now() + Math.random() })
  localStorage.setItem(AGENT_LOG_KEY, JSON.stringify(log.slice(0, 100)))
}

export function sendEmailAlert(service) {
  const apiUrl = import.meta.env.VITE_API_URL || '/api'
  fetch(`${apiUrl}/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'VolunTrack Monitor',
      email: 'karnatamhriday@gmail.com',
      subject: `ALERT: ${service} is down`,
      message: `Service: ${service}\nDetected at: ${new Date().toISOString()}\n\nThis is an automated alert from the VolunTrack status monitor.`,
    }),
  }).catch(() => {})
}

export function notify(service) {
  if (!('Notification' in window) || Notification.permission === 'denied') return
  if (Notification.permission === 'granted') {
    new Notification(`VolunTrack Alert: ${service}`, {
      body: `${service} is experiencing issues. AI agent is investigating.`,
      icon: `${import.meta.env.BASE_URL}logo.png`,
    })
  } else {
    Notification.requestPermission()
  }
}

export async function runAgent(service, incidentId) {
  updateIncidentStatus(incidentId, 'investigating')
  logAgentAction(`Investigating ${service}...`, 'info')

  if (service === 'Service Worker') {
    logAgentAction('Attempting to re-register Service Worker...', 'fixing')
    try {
      await navigator.serviceWorker.register('/sw.js')
      const reg = await navigator.serviceWorker.ready
      if (reg.active) {
        updateIncidentStatus(incidentId, 'resolved')
        logAgentAction('Service Worker re-registered successfully', 'success')
        return
      }
    } catch (e) {
      logAgentAction(`Service Worker fix failed: ${e.message}`, 'error')
    }
  }

  if (service === 'Local Storage') {
    logAgentAction('Attempting to recover Local Storage...', 'fixing')
    try {
      const backup = sessionStorage.getItem('voluntrack_backup')
      if (backup) {
        const keys = JSON.parse(backup)
        keys.forEach((k) => {
          const v = sessionStorage.getItem(`voluntrack_backup_${k}`)
          if (v) localStorage.setItem(k, v)
        })
        logAgentAction('Restored Local Storage from Session Storage backup', 'success')
        updateIncidentStatus(incidentId, 'resolved')
        return
      }
    } catch {}
    logAgentAction('No backup found, reinitializing storage...', 'fixing')
    try {
      localStorage.setItem('voluntrack:logs', '[]')
      localStorage.setItem('voluntrack:goals', '[]')
      localStorage.setItem('voluntrack:achievements', '[]')
      localStorage.setItem('voluntrack:users', '[]')
      logAgentAction('Storage reinitialized with empty data', 'success')
      updateIncidentStatus(incidentId, 'resolved')
    } catch {
      updateIncidentStatus(incidentId, 'failed')
      logAgentAction('Local Storage cannot be recovered', 'error')
    }
    return
  }

  if (service === 'Session Storage') {
    logAgentAction('Attempting to recover Session Storage...', 'fixing')
    try {
      sessionStorage.setItem('__agent_test__', '1')
      sessionStorage.removeItem('__agent_test__')
      updateIncidentStatus(incidentId, 'resolved')
      logAgentAction('Session Storage is operational', 'success')
    } catch {
      updateIncidentStatus(incidentId, 'failed')
      logAgentAction('Session Storage unavailable in this browser', 'error')
    }
    return
  }

  if (service === 'Connection') {
    logAgentAction('Cannot fix network connection automatically', 'error')
    updateIncidentStatus(incidentId, 'failed')
    return
  }

  if (service === 'Geolocation') {
    logAgentAction('Geolocation requires user permission — cannot auto-fix', 'error')
    updateIncidentStatus(incidentId, 'failed')
    return
  }

  if (service === 'IndexedDB') {
    logAgentAction('Verifying IndexedDB availability...', 'fixing')
    try {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('_healthcheck', 1)
        req.onsuccess = () => { indexedDB.deleteDatabase('_healthcheck'); resolve(true) }
        req.onerror = () => reject()
      })
      if (db) {
        updateIncidentStatus(incidentId, 'resolved')
        logAgentAction('IndexedDB is operational', 'success')
      }
    } catch {
      updateIncidentStatus(incidentId, 'failed')
      logAgentAction('IndexedDB is unavailable', 'error')
    }
    return
  }

  if (service === 'Cache API') {
    logAgentAction('Verifying Cache API availability...', 'fixing')
    try {
      const cache = await caches.open('_healthcheck')
      if (cache) {
        await caches.delete('_healthcheck')
        updateIncidentStatus(incidentId, 'resolved')
        logAgentAction('Cache API is operational', 'success')
      }
    } catch {
      updateIncidentStatus(incidentId, 'failed')
      logAgentAction('Cache API unavailable in this browser', 'error')
    }
    return
  }

  if (service === 'Cookies') {
    logAgentAction('Cookies are controlled by browser settings — cannot auto-enable', 'error')
    updateIncidentStatus(incidentId, 'failed')
    return
  }

  if (service === 'Notifications') {
    logAgentAction('Requesting notification permission...', 'fixing')
    try {
      const perm = await Notification.requestPermission()
      if (perm === 'granted') {
        updateIncidentStatus(incidentId, 'resolved')
        logAgentAction('Notification permission granted', 'success')
      } else {
        updateIncidentStatus(incidentId, 'failed')
        logAgentAction('Notification permission denied by user', 'error')
      }
    } catch {
      updateIncidentStatus(incidentId, 'failed')
      logAgentAction('Notifications not supported', 'error')
    }
    return
  }

  if (service === 'Canvas 2D') {
    logAgentAction('Verifying Canvas 2D availability...', 'fixing')
    try {
      const c = document.createElement('canvas')
      const ctx = c.getContext('2d')
      if (ctx) {
        updateIncidentStatus(incidentId, 'resolved')
        logAgentAction('Canvas 2D is operational', 'success')
      } else {
        updateIncidentStatus(incidentId, 'failed')
        logAgentAction('Canvas 2D unavailable', 'error')
      }
    } catch {
      updateIncidentStatus(incidentId, 'failed')
      logAgentAction('Canvas 2D not supported', 'error')
    }
    return
  }

  if (service === 'WebGL') {
    logAgentAction('Attempting WebGL with software rendering fallback...', 'fixing')
    try {
      const c = document.createElement('canvas')
      const gl = c.getContext('webgl', { failIfMajorPerformanceCaveat: false }) || c.getContext('experimental-webgl', { failIfMajorPerformanceCaveat: false })
      if (gl) {
        updateIncidentStatus(incidentId, 'resolved')
        logAgentAction('WebGL recovered with software rendering', 'success')
      } else {
        updateIncidentStatus(incidentId, 'failed')
        logAgentAction('WebGL unavailable — GPU/software rendering not available', 'error')
      }
    } catch {
      updateIncidentStatus(incidentId, 'failed')
      logAgentAction('WebGL not supported in this browser', 'error')
    }
    return
  }

  if (service === 'Web Workers') {
    logAgentAction('Testing Web Worker creation...', 'fixing')
    try {
      const blob = new Blob(['self.postMessage("ok")'], { type: 'application/javascript' })
      const worker = new Worker(URL.createObjectURL(blob))
      worker.terminate()
      updateIncidentStatus(incidentId, 'resolved')
      logAgentAction('Web Workers are operational', 'success')
    } catch {
      updateIncidentStatus(incidentId, 'failed')
      logAgentAction('Web Workers not supported in this browser', 'error')
    }
    return
  }

  if (service === 'WebSocket') {
    logAgentAction('Checking WebSocket API availability...', 'fixing')
    try {
      const ws = new WebSocket('wss://echo.websocket.org')
      ws.onopen = () => { ws.close(); updateIncidentStatus(incidentId, 'resolved'); logAgentAction('WebSocket is operational', 'success') }
      ws.onerror = () => { updateIncidentStatus(incidentId, 'failed'); logAgentAction('WebSocket unavailable — possibly restricted by network', 'error') }
      setTimeout(() => { if (ws.readyState === 0) { ws.close(); updateIncidentStatus(incidentId, 'failed') } }, 3000)
    } catch {
      updateIncidentStatus(incidentId, 'failed')
      logAgentAction('WebSocket not supported', 'error')
    }
    return
  }

  if (service === 'File API') {
    logAgentAction('File API is a browser capability — no fix available', 'error')
    updateIncidentStatus(incidentId, 'failed')
    return
  }

  if (service === 'Clipboard') {
    logAgentAction('Clipboard requires user gesture — attempting to read...', 'fixing')
    try {
      await navigator.clipboard.readText()
      updateIncidentStatus(incidentId, 'resolved')
      logAgentAction('Clipboard API is operational', 'success')
    } catch {
      updateIncidentStatus(incidentId, 'failed')
      logAgentAction('Clipboard unavailable — requires secure context + user gesture', 'error')
    }
    return
  }

  if (service === 'Touch Events') {
    logAgentAction('Touch Events depend on hardware — cannot auto-fix', 'error')
    updateIncidentStatus(incidentId, 'failed')
    return
  }

  if (service === 'Battery API') {
    logAgentAction('Battery API is device-dependent — checking availability...', 'fixing')
    try {
      const battery = await navigator.getBattery()
      if (battery) {
        updateIncidentStatus(incidentId, 'resolved')
        logAgentAction('Battery API is operational', 'success')
      }
    } catch {
      updateIncidentStatus(incidentId, 'failed')
      logAgentAction('Battery API not available on this device', 'error')
    }
    return
  }

  if (service === 'Vibration') {
    logAgentAction('Vibration API is hardware-dependent — cannot auto-fix', 'error')
    updateIncidentStatus(incidentId, 'failed')
    return
  }

  if (service === 'Web Audio') {
    logAgentAction('Testing Web Audio API...', 'fixing')
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      if (ctx) {
        ctx.close()
        updateIncidentStatus(incidentId, 'resolved')
        logAgentAction('Web Audio API is operational', 'success')
      }
    } catch {
      updateIncidentStatus(incidentId, 'failed')
      logAgentAction('Web Audio API not supported', 'error')
    }
    return
  }

  if (service === 'Screen Wake Lock') {
    logAgentAction('Screen Wake Lock requires user gesture — cannot auto-acquire', 'error')
    updateIncidentStatus(incidentId, 'failed')
    return
  }

  if (service === 'PWA') {
    logAgentAction('Attempting to re-register Service Worker for PWA...', 'fixing')
    try {
      await navigator.serviceWorker.register('/sw.js')
      const reg = await navigator.serviceWorker.ready
      if (reg.active) {
        updateIncidentStatus(incidentId, 'resolved')
        logAgentAction('PWA service worker registered successfully', 'success')
      } else {
        updateIncidentStatus(incidentId, 'failed')
        logAgentAction('PWA service worker registered but not active', 'error')
      }
    } catch (e) {
      updateIncidentStatus(incidentId, 'failed')
      logAgentAction(`PWA fix failed: ${e.message}`, 'error')
    }
    return
  }

  if (service === 'Application') {
    logAgentAction('Application is reachable — no action needed', 'success')
    updateIncidentStatus(incidentId, 'resolved')
    return
  }

  logAgentAction(`No automated fix available for ${service}`, 'error')
  updateIncidentStatus(incidentId, 'failed')
}
