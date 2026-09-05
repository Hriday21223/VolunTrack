import { useEffect, useRef, useState } from 'react'
import { X, Download, Loader2 } from 'lucide-react'

/**
 * Full-screen preview for a generated PDF. Schools and orgs review invoices
 * and reports in place instead of downloading a file first — downloading is
 * still one click away, but it is no longer the only way to look at one.
 *
 * `getBlob` is called once on mount and must resolve to a Blob (our export
 * helpers all take `returnBlob: true`). The object URL is revoked on close,
 * otherwise the blob stays in memory for the life of the tab.
 */
export default function PdfPreview({ title, filename, getBlob, onClose }) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const download = () => {
    if (!blobRef.current) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blobRef.current)
    a.download = filename || 'document.pdf'
    a.click()
    // The anchor holds its own URL, so revoke that one rather than the
    // preview's — revoking the preview's would blank the embed.
    URL.revokeObjectURL(a.href)
  }

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title ? `Preview of ${title}` : 'PDF preview'}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
    >
      <div className="relative w-full max-w-5xl rounded-2xl border border-white/10 bg-[#0f1813] p-4 sm:p-6 shadow-soft text-white">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-sm font-medium truncate">{title || 'Preview'}</h2>
          <div className="flex items-center gap-2">
            <button type="button" onClick={download} disabled={!url} className="btn-sm btn-ghost">
              <Download className="w-4 h-4 mr-1" /> Download
            </button>
            <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-earth-400 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl overflow-hidden grid place-items-center" style={{ height: '78vh' }}>
          {error && <p className="text-sm text-red-600 p-6">{error}</p>}
          {!error && !url && <Loader2 className="w-6 h-6 animate-spin text-earth-500" />}
          {/* Some browsers (notably iOS Safari) won't render a PDF inline; the
              Download button above stays the fallback. */}
          {url && <embed src={url} type="application/pdf" className="w-full h-full" />}
        </div>
      </div>
    </div>
  )
}
