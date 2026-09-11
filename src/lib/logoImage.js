// Turns an image a school admin drops in into a small data: URL for their
// sign-in page logo (server/routes/tenant.js stores it inline).
//
// Re-encoding through a canvas does three jobs at once: it caps the size (the
// logo ships with every sign-in page load), strips EXIF and other metadata,
// and guarantees the stored bytes are a plain raster image whatever the file
// claimed to be — an SVG or GIF goes in, a PNG or WebP comes out.

// Matches MAX_LOGO_DATA_URL on the server.
export const MAX_LOGO_CHARS = 200_000

const MAX_INPUT_BYTES = 5 * 1024 * 1024

// Larger edges first; smaller ones only if a detailed image won't fit.
const EDGES = [256, 160, 96]

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read that image. Try a PNG or JPEG.'))
    }
    img.src = url
  })
}

function render(img, maxEdge) {
  // An SVG with no intrinsic size reports 0 — draw it at the target size.
  const w = img.naturalWidth || maxEdge
  const h = img.naturalHeight || maxEdge
  const scale = Math.min(1, maxEdge / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * scale))
  canvas.height = Math.max(1, Math.round(h * scale))
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas
}

export async function logoFileToDataUrl(file) {
  if (!file) throw new Error('Choose an image.')
  if (!file.type.startsWith('image/')) throw new Error('Logo must be an image — PNG, JPEG, WebP, GIF, or SVG.')
  if (file.size > MAX_INPUT_BYTES) throw new Error('That image is too large. Use one under 5 MB.')

  const img = await loadImage(file)
  for (const edge of EDGES) {
    const canvas = render(img, edge)
    // WebP keeps transparency and is smallest; browsers that can't encode it
    // (older Safari) silently return PNG instead, which the prefix check skips.
    for (const [type, quality] of [['image/webp', 0.9], ['image/png']]) {
      let url
      try {
        url = canvas.toDataURL(type, quality)
      } catch {
        throw new Error('Your browser would not process that image. Try a PNG or JPEG.')
      }
      if (url.startsWith(`data:${type};base64,`) && url.length <= MAX_LOGO_CHARS) return url
    }
  }
  throw new Error('That image is too detailed to use as a logo. Try a simpler or smaller version.')
}
