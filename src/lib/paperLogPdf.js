import { tr } from '@/lib/i18n.js'

// Reads a PDF of a paper hours log (#1022 follow-up) for Scan a paper log.
// pdf.js (Mozilla's reader, pdfjs-dist) is loaded only when someone picks a
// PDF, and its worker is served from our own site, like Tesseract's files.
// Nothing is uploaded or stored by this step.
//
// For each page (up to MAX_PAGES):
//  - a typed PDF has a text layer: read it straight out, line by line,
//    so it goes to the same parser as a photo's text, with nothing guessed;
//  - a scanned PDF has no text: draw the page to an image, which then goes
//    through the same reader a photo does.

export const MAX_PAGES = 5
// A page with less text than this is treated as a scan.
const MIN_TEXT_CHARS = 20

let pdfjsPromise = null
// Shared with PdfPreview, which draws previews with it.
export function loadPdfJs() {
  if (!pdfjsPromise) {
    // The legacy build runs on older phone browsers too.
    // Its worker is copied next to Tesseract's files (vite.config.js).
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}tesseract/pdf/pdf.worker.min.js`
      return pdfjs
    })
    pdfjsPromise.catch(() => { pdfjsPromise = null })
  }
  return pdfjsPromise
}

// The page's text as lines: pieces on the same row (close enough in height)
// joined left to right, rows top to bottom.
function textToLines(items) {
  const rows = []
  for (const it of items) {
    const str = String(it.str || '')
    if (!str.trim()) continue
    const x = it.transform[4]
    const y = it.transform[5]
    let row = rows.find((r) => Math.abs(r.y - y) < 4)
    if (!row) { row = { y, parts: [] }; rows.push(row) }
    row.parts.push({ x, str })
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((r) => r.parts.sort((a, b) => a.x - b.x).map((p) => p.str).join('   '))
    .join('\n')
}

/**
 * Returns { pages: [{ text } | { image: Blob }], total } for the first
 * MAX_PAGES pages; `total` is the PDF's page count.
 */
export async function readPdfPages(file) {
  const pdfjs = await loadPdfJs()
  let doc
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  } catch (error) {
    if (error?.name === 'PasswordException') throw new Error(tr('That PDF has a password. Save it without one, or use a photo instead.'))
    throw new Error(tr('Couldn’t open that PDF. Try a photo of the page instead.'))
  }
  try {
    const pages = []
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
      const page = await doc.getPage(n)
      const text = textToLines((await page.getTextContent()).items)
      if (text.replace(/\s/g, '').length >= MIN_TEXT_CHARS) {
        pages.push({ text })
        continue
      }
      // A scan: draw it about 2x so small handwriting stays readable,
      // capped so a huge page doesn't use up a phone's memory.
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min(2.5, 2400 / Math.max(base.width, base.height))
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport }).promise
      const image = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      canvas.width = 0
      canvas.height = 0
      if (image) pages.push({ image: new File([image], `page-${n}.png`, { type: 'image/png' }) })
    }
    return { pages, total: doc.numPages }
  } finally {
    doc.destroy()
  }
}
