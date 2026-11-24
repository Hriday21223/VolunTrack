import { useEffect, useRef, useState } from 'react'
import { X, Download, Loader2 } from 'lucide-react'
import { tr } from '@/lib/i18n.js'

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
// It gets the built Blob, so the file that's sent is the one that was shown.
// `allowDownload={false}` hides our Download button. `getDownloadBlob`
// (optional) builds a different file for Download than the one shown, e.g. a
// student report shown clean but downloaded with its watermark. With either,
// the browser's own PDF toolbar is hidden (#toolbar=0) so its save button
// doesn't hand out the shown file instead.
export default function PdfPreview({ title, filename, getBlob, onClose, action, allowDownload = true, getDownloadBlob }) {
  const [url, setUrl] = useState(null)
  const [error, setError] = useState('')
  const blobRef = useRef(null)
  // getBlob is nearly always an inline arrow, so its identity changes every
  // render. Keeping it in a ref lets the effect depend on nothing and run
  // exactly once per mount — depending on getBlob instead would re-fire the
  // effect, and its cleanup would cancel the in-flight build every time.
  const getBlobRef = useRef(getBlob)
  getBlobRef.current = getBlob

  useEffect(() => {
    let objectUrl = null
    let cancelled = false

    Promise.resolve()
      .then(() => getBlobRef.current())
      .then((blob) => {
        if (cancelled || !blob) return
        blobRef.current = blob
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || 'Could not build the PDF.')
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
    // Mount-only on purpose; see getBlobRef above.
  }, [])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const download = async () => {
    if (!blobRef.current) return
    const file = getDownloadBlob ? await getDownloadBlob() : blobRef.current
    if (!file) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(file)
    a.download = filename || 'document.pdf'
    a.click()
    // The anchor holds its own URL, so revoke that one rather than the
    // preview's — revoking the preview's would blank the frame.
    URL.revokeObjectURL(a.href)
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
          <h2 className="text-sm font-medium truncate">{title || tr('Preview')}</h2>
          <div className="flex items-center gap-2">
            {action && (
              <button type="button" onClick={() => action.onClick(blobRef.current)} disabled={!url || action.busy} className="btn-sm btn-primary">
                {action.icon}{action.label}
              </button>
            )}
            {allowDownload && (
              <button type="button" onClick={download} disabled={!url} className="btn-sm btn-ghost">
                <Download className="w-4 h-4 mr-1" />{' '}{tr('Download')}
              </button>
            )}
            <button type="button" onClick={onClose} aria-label={tr('Close')} className="p-1 text-earth-400 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl overflow-hidden grid place-items-center" style={{ height: '78vh' }}>
          {error && <p className="text-sm text-red-600 p-6">{error}</p>}
          {!error && !url && <Loader2 className="w-6 h-6 animate-spin text-earth-500" />}
          {/* Some browsers (notably iOS Safari) won't render a PDF inline; the
              Download button above stays the fallback. */}
          {/* Not <embed>: the CSP's object-src 'none' blocks it, which left
              every preview blank on the live site. frame-src allows blob:. */}
          {url && <iframe src={allowDownload && !getDownloadBlob ? url : `${url}#toolbar=0`} title={title || tr('PDF preview')} className="w-full h-full" />}
        </div>
      </div>
    </div>
  )
}
