// Shared checks for images people upload: the branding logo
// (routes/tenant.js) and task cover photos (routes/taskPhotos.js).

// SVG is deliberately absent: it is inert inside <img>, but an SVG opened
// directly is a document that can run script.
//
// An explicit switch rather than a lookup table keyed by the matched type, so
// no method is ever chosen by a request-derived name (CodeQL
// js/unvalidated-dynamic-method-call), and anything unexpected is refused.
export function hasImageMagic(type, b) {
  switch (type) {
    case 'png':
      return b.length > 8 && b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG'
    case 'jpeg':
      return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
    case 'webp':
      return b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'
    default:
      return false
  }
}

// JPEG segments that may carry camera, location or editing metadata: APP1
// (EXIF incl. GPS, XMP), APP3–APP13, APP15 and comments. APP0 (JFIF), APP2
// (ICC colour profile) and APP14 (Adobe colour transform) change how the
// picture renders, so they stay.
function dropJpegMarker(marker) {
  return marker === 0xe1 || (marker >= 0xe3 && marker <= 0xed) || marker === 0xef || marker === 0xfe
}

function stripJpeg(b) {
  const out = [b.subarray(0, 2)]
  let i = 2
  while (i < b.length) {
    if (b[i] !== 0xff) return null
    // Fill bytes before a marker are legal.
    while (i < b.length && b[i] === 0xff) i += 1
    if (i >= b.length) return null
    const marker = b[i]
    const start = i - 1
    i += 1
    // Standalone markers have no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(b.subarray(start, i))
      continue
    }
    if (marker === 0xd9) { out.push(b.subarray(start, i)); break }
    if (i + 2 > b.length) return null
    const len = b.readUInt16BE(i)
    if (len < 2 || i + len > b.length) return null
    const end = i + len
    if (marker === 0xda) {
      // Start of scan: the compressed picture runs to the end of the file.
      out.push(b.subarray(start))
      return Buffer.concat(out)
    }
    if (!dropJpegMarker(marker)) out.push(b.subarray(start, end))
    i = end
  }
  return Buffer.concat(out)
}

// PNG text chunks and eXIf can hold the same kind of metadata.
const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME'])

function stripPng(b) {
  const out = [b.subarray(0, 8)]
  let i = 8
  while (i + 12 <= b.length) {
    const len = b.readUInt32BE(i)
    const type = b.toString('ascii', i + 4, i + 8)
    const end = i + 12 + len
    if (end > b.length) return null
    if (!PNG_DROP.has(type)) out.push(b.subarray(i, end))
    i = end
    if (type === 'IEND') return Buffer.concat(out)
  }
  return null
}

function stripWebp(b) {
  const chunks = []
  let i = 12
  while (i + 8 <= b.length) {
    const type = b.toString('ascii', i, i + 4)
    const len = b.readUInt32LE(i + 4)
    const end = i + 8 + len + (len % 2)
    if (i + 8 + len > b.length) return null
    if (type !== 'EXIF' && type !== 'XMP ') {
      let chunk = Buffer.from(b.subarray(i, Math.min(end, b.length)))
      // VP8X flags announce EXIF (0x08) and XMP (0x04); they're gone now.
      if (type === 'VP8X' && chunk.length > 8) chunk[8] &= ~0x0c
      chunks.push(chunk)
    }
    i = end
  }
  if (!chunks.length) return null
  const body = Buffer.concat(chunks)
  const header = Buffer.alloc(12)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(body.length + 4, 4)
  header.write('WEBP', 8, 'ascii')
  return Buffer.concat([header, body])
}

/**
 * Drops metadata (EXIF incl. GPS, XMP, text comments) from an image without
 * re-encoding it — sharp isn't a runtime dependency, and the browser already
 * re-encodes through a canvas before upload (src/lib/taskPhoto.js). This is
 * the server's own guarantee for a client that skips that step.
 * @returns {Buffer|null} the cleaned image, or null if it couldn't be parsed.
 */
export function stripImageMetadata(type, b) {
  try {
    switch (type) {
      case 'jpeg': return stripJpeg(b)
      case 'png': return stripPng(b)
      case 'webp': return stripWebp(b)
      default: return null
    }
  } catch {
    return null
  }
}
