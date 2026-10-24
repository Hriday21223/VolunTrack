// A shareable picture of a student's volunteer hours (#478): 1080×1350, the
// size Instagram shows uncropped in a feed. Drawn on a canvas on the device —
// nothing is uploaded — and shared through the phone's share sheet where
// there is one, else downloaded. Every share carries the site's address, which
// is how VolunTrack spreads student to student.
import { tr } from '@/lib/i18n.js'
import { isNativeApp } from '@/lib/platform.js'

export const CARD_WIDTH = 1080
export const CARD_HEIGHT = 1350

const SITE = (isNativeApp && import.meta.env.VITE_SITE_URL) || window.location.origin

// "https://volunteer-track-two.vercel.app" → "volunteer-track-two.vercel.app"
export function siteLabel() {
  try { return new URL(SITE).host } catch { return 'VolunTrack' }
}

function fmt(n) {
  const r = Math.round((Number(n) || 0) * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

// Shrinks the font until `text` fits `maxWidth`, so a long name or cause
// never runs off the card.
function fitText(ctx, text, weight, size, family, maxWidth, min = 28) {
  let s = size
  ctx.font = `${weight} ${s}px ${family}`
  while (s > min && ctx.measureText(text).width > maxWidth) {
    s -= 2
    ctx.font = `${weight} ${s}px ${family}`
  }
  return s
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/**
 * Draws the card. `name` is optional (the student chooses); `causes` are the
 * top categories by hours, already translated for display.
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function drawHoursCard({ name, totalHours, approvedHours, sessions, causes = [] }) {
  // The app's own fonts, if they're loaded; the canvas won't wait for them.
  try { await document.fonts?.ready } catch { /* older browsers */ }
  const DISPLAY = '"Plus Jakarta Sans", Inter, system-ui, sans-serif'
  const BODY = 'Inter, system-ui, sans-serif'

  const canvas = document.createElement('canvas')
  canvas.width = CARD_WIDTH
  canvas.height = CARD_HEIGHT
  const ctx = canvas.getContext('2d')
  const W = CARD_WIDTH
  const H = CARD_HEIGHT
  const pad = 88

  // Background: the app's dark green, with a soft glow behind the number.
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#0b1a12')
  bg.addColorStop(1, '#071117')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  const glow = ctx.createRadialGradient(W / 2, 560, 40, W / 2, 560, 620)
  glow.addColorStop(0, 'rgba(76, 175, 80, 0.30)')
  glow.addColorStop(1, 'rgba(76, 175, 80, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  // Header: logo + wordmark.
  const logo = await loadImage(`${import.meta.env.BASE_URL}logo-icon.webp`)
  let x = pad
  if (logo) {
    ctx.save()
    roundRect(ctx, pad, pad, 84, 84, 18)
    ctx.clip()
    ctx.drawImage(logo, pad, pad, 84, 84)
    ctx.restore()
    x += 108
  }
  ctx.fillStyle = '#ffffff'
  ctx.font = `700 46px ${DISPLAY}`
  ctx.textBaseline = 'middle'
  ctx.fillText('VolunTrack', x, pad + 42)

  // Who, then the big number.
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  let y = 360
  if (name) {
    ctx.fillStyle = '#d7e8d9'
    fitText(ctx, name, 600, 56, DISPLAY, W - pad * 2)
    ctx.fillText(name, W / 2, y)
    y += 70
    ctx.fillStyle = '#9fb8a3'
    ctx.font = `400 38px ${BODY}`
    ctx.fillText(tr('has volunteered'), W / 2, y)
  } else {
    ctx.fillStyle = '#9fb8a3'
    ctx.font = `400 40px ${BODY}`
    ctx.fillText(tr('I have volunteered'), W / 2, y + 40)
  }

  y = 690
  ctx.fillStyle = '#7ed683'
  fitText(ctx, fmt(totalHours), 800, 260, DISPLAY, W - pad * 2, 120)
  ctx.fillText(fmt(totalHours), W / 2, y)
  ctx.fillStyle = '#ffffff'
  ctx.font = `600 54px ${DISPLAY}`
  ctx.fillText(Number(totalHours) === 1 ? tr('hour of service') : tr('hours of service'), W / 2, y + 80)

  // Two small stats.
  y += 210
  const stats = [
    [fmt(approvedHours), tr('hours approved')],
    [String(sessions), Number(sessions) === 1 ? tr('session') : tr('sessions')],
  ]
  const colW = (W - pad * 2) / 2
  stats.forEach(([value, label], i) => {
    const cx = pad + colW * i + colW / 2
    ctx.fillStyle = '#ffffff'
    ctx.font = `700 60px ${DISPLAY}`
    ctx.fillText(value, cx, y)
    ctx.fillStyle = '#9fb8a3'
    ctx.font = `400 32px ${BODY}`
    ctx.fillText(label, cx, y + 48)
  })

  // Top causes as pills, centred on one line (as many as fit, up to 3).
  const pills = causes.slice(0, 3)
  if (pills.length) {
    y += 150
    ctx.font = `600 32px ${BODY}`
    const gap = 18
    const padX = 30
    let shown = pills
    const widthOf = (list) => list.reduce((s, c) => s + ctx.measureText(c).width + padX * 2, 0) + gap * (list.length - 1)
    while (shown.length > 1 && widthOf(shown) > W - pad * 2) shown = shown.slice(0, -1)
    let px = (W - widthOf(shown)) / 2
    for (const c of shown) {
      const w = ctx.measureText(c).width + padX * 2
      ctx.fillStyle = 'rgba(126, 214, 131, 0.14)'
      roundRect(ctx, px, y - 44, w, 64, 32)
      ctx.fill()
      ctx.fillStyle = '#bfe8c1'
      ctx.textAlign = 'left'
      ctx.fillText(c, px + padX, y)
      px += w + gap
    }
    ctx.textAlign = 'center'
  }

  // Footer: the invitation that makes a share worth something to us.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'
  ctx.fillRect(pad, H - 190, W - pad * 2, 2)
  ctx.fillStyle = '#d7e8d9'
  ctx.font = `600 36px ${BODY}`
  ctx.fillText(tr('Track your volunteer hours free'), W / 2, H - 118)
  ctx.fillStyle = '#7ed683'
  ctx.font = `600 34px ${BODY}`
  ctx.fillText(siteLabel(), W / 2, H - 68)

  return canvas
}

export function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(tr('Could not make the image.')))), 'image/png')
  })
}

const FILE_NAME = 'voluntrack-hours.png'

/** True when the share sheet can take an image file here. */
export function canShareImage() {
  try {
    if (!navigator.canShare) return false
    const probe = new File([new Blob([''], { type: 'image/png' })], FILE_NAME, { type: 'image/png' })
    return navigator.canShare({ files: [probe] })
  } catch {
    return false
  }
}

/** Opens the share sheet with the image. Resolves false if the person cancelled. */
export async function shareHoursImage(blob) {
  const file = new File([blob], FILE_NAME, { type: 'image/png' })
  try {
    await navigator.share({
      files: [file],
      text: tr('My volunteer hours, tracked with VolunTrack: {site}', { site: SITE }),
    })
    return true
  } catch (e) {
    if (e?.name === 'AbortError') return false
    throw e
  }
}

export function downloadHoursImage(blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = FILE_NAME
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
