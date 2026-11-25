import { useEffect, useRef, useState } from 'react'
import { X, Download, Loader2 } from 'lucide-react'
import { tr } from '@/lib/i18n.js'
import { guardScreen } from '@/lib/screenGuard.js'
import { useAuth } from '@/hooks/useAuth.jsx'
import { isNativeApp } from '@/lib/platform.js'
import { loadPdfJs } from '@/lib/paperLogPdf.js'

// Pages drawn at most; longer files say so and are complete in Download.
const MAX_PREVIEW_PAGES = 40

// The pages as pictures (pdf.js), not the browser's PDF viewer: the viewer
// can save the clean preview with Cmd/Ctrl+S even with its toolbar hidden,
// and pictures also show on iPhones, whose browser won't show a PDF inline.
// Right-click is turned off on them so "Save image" isn't one click away.
function PdfPages({ blob, title, onError, onMore }) {
  const box = useRef(null)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const onMoreRef = useRef(onMore)
  onMoreRef.current = onMore
  useEffect(() => {
    const el = box.current
    let cancelled = false
    let doc = null
    ;(async () => {
      const pdfjs = await loadPdfJs()
      doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise
      if (cancelled) return
      if (doc.numPages > MAX_PREVIEW_PAGES) onMoreRef.current?.(doc.numPages)
      const width = Math.max(280, el.clientWidth - 32)
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      for (let n = 1; n <= Math.min(doc.numPages, MAX_PREVIEW_PAGES); n++) {
        const page = await doc.getPage(n)
        if (cancelled) return
        const fit = width / page.getViewport({ scale: 1 }).width
        const viewport = page.getViewport({ scale: fit * dpr })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        canvas.style.width = `${Math.round(viewport.width / dpr)}px`
        canvas.style.maxWidth = '100%'
        canvas.style.height = 'auto'
        canvas.className = 'block mx-auto mb-4 bg-white shadow'
        canvas.setAttribute('role', 'img')
        canvas.setAttribute('aria-label', `${title || 'PDF'}: ${tr('Page {n} of {total}', { n, total: doc.numPages })}`)
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
        if (cancelled) return
        el.appendChild(canvas)
      }
    })().catch((e) => { if (!cancelled) onErrorRef.current?.(e?.message || 'Could not show the PDF.') })
    return () => {
      cancelled = true
      doc?.destroy()
      el.replaceChildren()
    }
  }, [blob, title])
  return (
    <div
      ref={box}
      onContextMenu={(e) => e.preventDefault()}
      className="absolute inset-0 overflow-auto overscroll-contain p-4 bg-earth-100 select-none"
    />
  )
}

/**
 * Full-screen preview for a generated PDF. Schools and orgs review invoices
 * and reports in place instead of downloading a file first — downloading is
 * still one click away, but it is no longer the only way to look at one.
 *
 * `getBlob` is called once on mount and must resolve to a Blob (our export
 * helpers all take `returnBlob: true`). The object URL is revoked on close,
 * otherwise the blob stays in memory for the life of the tab.
 */
// `action` (optional): an extra button for the header, e.g. "Send to school".
// `note` (optional): one line under the title.
// `allowDownload={false}` hides our Download button.
// Previews are clean and downloads are watermarked: getBlob is called with
// { watermark: false } for what's shown and { watermark: true } for Download
// (every PDF builder in src/lib/export.js takes `watermark`). The preview is
// drawn as pictures (PdfPages), never handed to the browser's PDF viewer,
// so there's no clean file in the page to save. In the phone apps the preview is also guarded
// (src/lib/screenGuard.js): Android blocks screenshots while it's open, and
// iOS shows a "Screenshots aren't allowed" page in the screenshot instead,
// closes the preview after one, and hides it while the screen is recorded.
export default function PdfPreview({ title, note, filename, getBlob, onClose, action, allowDownload = true }) {
  const [blob, setBlob] = useState(null)
  const [morePages, setMorePages] = useState(0)
  const [error, setError] = useState('')
  // iOS: true while the screen is being recorded or mirrored.
  // Screenshot covers are for students, families, schools and organizers,
  // not VolunTrack's own admins (the owner's choice, Nov 24).
  const { user } = useAuth()
  const guarded = user?.role !== 'admin'
  const [captured, setCaptured] = useState(false)
  // Website: true while a screenshot looks likely (see the effect below).
  const [shielded, setShielded] = useState(false)
  const blobRef = useRef(null)
  // getBlob is nearly always an inline arrow, so its identity changes every
  // render. Keeping it in a ref lets the effect depend on nothing and run
  // exactly once per mount — depending on getBlob instead would re-fire the
  // effect, and its cleanup would cancel the in-flight build every time.
  const getBlobRef = useRef(getBlob)
  getBlobRef.current = getBlob

  useEffect(() => {
    let cancelled = false

    Promise.resolve()
      .then(() => getBlobRef.current({ watermark: false }))
      .then((b) => {
        if (cancelled || !b) return
        blobRef.current = b
        setBlob(b)
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || 'Could not build the PDF.')
      })

    return () => { cancelled = true }
    // Mount-only on purpose; see getBlobRef above.
  }, [])

  // Phone apps only: block screenshots on Android; on iOS close after one and
  // hide the document while the screen is recorded. Off again on close.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (!guarded) return undefined
    return guardScreen({
      onScreenshot: () => onCloseRef.current?.(),
      onCaptured: setCaptured,
    })
  }, [guarded])

  // Website: browsers never say when a screenshot is taken, so hide the
  // document when one is likely and show "Screenshots aren't allowed here":
  //  - Cmd/Ctrl+Shift held: every Mac screenshot shortcut (Cmd+Shift+3/4/5)
  //    starts with it, so the page is hidden before the number is pressed;
  //  - Print Screen (Windows): only reported after the capture, so this
  //    blanks it for the next ones;
  //  - the window losing focus (a screenshot tool opening, another app).
  // A blur only counts when the document as a whole has lost focus. Phone apps use
  // the native guard above instead.
  useEffect(() => {
    if (isNativeApp || !guarded) return undefined
    let keysHeld = false
    let printUntil = 0
    // Focus is re-checked on a short timer rather than trusted to blur/focus
    // events, which don't always come back in pairs (the PDF frame taking
    // focus, other windows, the screenshot tool itself).
    const update = () => {
      const away = !document.hasFocus() || document.hidden
      setShielded(keysHeld || Date.now() < printUntil || away)
    }
    const onDown = (e) => {
      if (e.shiftKey && (e.metaKey || e.ctrlKey || e.key === 'Meta')) keysHeld = true
      if (e.key === 'PrintScreen') printUntil = Date.now() + 2000
      update()
    }
    const onUp = (e) => {
      if (!(e.shiftKey && (e.metaKey || e.ctrlKey))) keysHeld = false
      update()
    }
    const timer = setInterval(update, 250)
    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keyup', onUp, true)
    window.addEventListener('blur', update)
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      clearInterval(timer)
      window.removeEventListener('keydown', onDown, true)
      window.removeEventListener('keyup', onUp, true)
      window.removeEventListener('blur', update)
      window.removeEventListener('focus', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [guarded])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const download = async () => {
    if (!blobRef.current) return
    const file = await getBlobRef.current({ watermark: true })
    if (!file) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(file)
    a.download = filename || 'document.pdf'
    a.click()
    // Not straight away: some browsers (Safari) are still reading the file
    // after click() returns, and revoking now cancels the download.
    const href = a.href
    setTimeout(() => URL.revokeObjectURL(href), 60_000)
  }

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title ? `Preview of ${title}` : tr('PDF preview')}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
    >
      <div className="relative w-full max-w-5xl rounded-2xl border border-white/10 bg-[#0f1813] p-4 sm:p-6 shadow-soft text-white">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h2 className="text-sm font-medium truncate">{title || tr('Preview')}</h2>
            {note && <p className="text-xs text-earth-400 truncate">{note}</p>}
            {morePages > 0 && <p className="text-xs text-earth-400">{tr('Showing the first {n} of {total} pages. Download the file for all of them.', { n: MAX_PREVIEW_PAGES, total: morePages })}</p>}
          </div>
          <div className="flex items-center gap-2">
            {action && (
              <button type="button" onClick={() => action.onClick()} disabled={!blob || action.busy} className="btn-sm btn-primary">
                {action.icon}{action.label}
              </button>
            )}
            {allowDownload && (
              <button type="button" onClick={download} disabled={!blob} className="btn-sm btn-ghost">
                <Download className="w-4 h-4 mr-1" />{' '}{tr('Download')}
              </button>
            )}
            <button type="button" onClick={onClose} aria-label={tr('Close')} className="p-1 text-earth-400 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="relative bg-white rounded-xl overflow-hidden grid place-items-center" style={{ height: '78vh' }}>
          {error && <p className="text-sm text-red-600 p-6">{error}</p>}
          {!error && !blob && <Loader2 className="w-6 h-6 animate-spin text-earth-500" />}
          {blob && captured && <p className="text-sm text-earth-600 p-6 text-center">{tr('Hidden while your screen is being recorded.')}</p>}
          {/* Kept mounted while shielded (just hidden) so the pages aren't
              drawn again and the scroll place is kept when it comes back. */}
          {blob && !captured && !error && (
            // Pinned to the frame (absolute, not h-full: a grid item grows to
            // its content, which left the pages taller than the frame and
            // nothing to scroll).
            <div className="absolute inset-0">
              <div className="absolute inset-0" style={shielded ? { visibility: 'hidden' } : undefined}>
                <PdfPages blob={blob} title={title} onError={setError} onMore={setMorePages} />
              </div>
              {shielded && (
                <div className="absolute inset-0 grid place-items-center bg-[#0b120e] text-white text-lg font-semibold p-6 text-center">
                  {tr('Screenshots aren’t allowed here.')}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
