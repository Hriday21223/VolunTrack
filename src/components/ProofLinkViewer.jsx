import { X, ExternalLink } from 'lucide-react'
import useEscapeKey from '@/hooks/useEscapeKey.js'
import { cleanProofLink, drivePreviewUrl } from '@proofLink'
import { tr } from '@/lib/i18n.js'

// A student's proof link shown inside VolunTrack (#957). Only Google Drive and
// Google Docs links get here: drivePreviewUrl() rebuilds Google's own preview
// address from the file id, and the CSP's frame-src allows just those two
// hosts. The frame runs Google's viewer (it needs scripts and its own
// origin), may open the file in a new tab, and can't navigate this page.
// What it shows still follows the file's Google sharing.
export default function ProofLinkViewer({ link, title, onClose }) {
  useEscapeKey(onClose)
  const preview = drivePreviewUrl(link)
  const original = cleanProofLink(link).url
  if (!preview || !original) return null
  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={tr('Proof')}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-3xl rounded-2xl border border-white/10 bg-[#0f1813] p-4 sm:p-5 shadow-soft text-white">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0 text-sm">
            <p className="font-semibold break-words">{title || tr('Proof')}</p>
            <p className="text-xs text-earth-400">{tr('From Google Drive. If it doesn’t show, ask the student to set sharing to “Anyone on the internet with the link can view”.')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={tr('Close')} className="p-1 text-earth-400 hover:text-white transition-colors shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
        <iframe
          title={tr('Proof')}
          src={preview}
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          allow="fullscreen"
          className="w-full bg-white rounded-xl"
          style={{ height: '70vh' }}
        />
        <a href={original} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-300 hover:underline mt-2">
          <ExternalLink className="w-3 h-3" />{' '}{tr('Open in Google Drive instead')}
        </a>
      </div>
    </div>
  )
}
