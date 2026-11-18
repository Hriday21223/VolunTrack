import { X } from 'lucide-react'
import useEscapeKey from '@/hooks/useEscapeKey.js'

// The admin's look at an email before it goes out (#942). `email` comes from
// the server's preview routes, built by the same code that sends it. The frame
// is fully sandboxed: it shows the message and can't run or reach anything.
export default function EmailPreview({ email, onClose }) {
  useEscapeKey(onClose)
  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222;margin:20px;overflow-wrap:anywhere}</style></head><body>${email.html}</body></html>`
  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Email preview"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0f1813] p-4 sm:p-5 shadow-soft text-white">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0 text-sm space-y-0.5">
            <p className="text-xs uppercase tracking-wider text-amber-300 font-semibold">Preview, not sent</p>
            <p className="break-words"><span className="text-earth-400">To:</span> {email.to}</p>
            <p className="break-words"><span className="text-earth-400">Subject:</span> {email.subject}</p>
            {email.note && <p className="text-xs text-earth-400">{email.note}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-earth-400 hover:text-white transition-colors shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
        <iframe title="Email preview" sandbox="" srcDoc={doc} className="w-full bg-white rounded-xl" style={{ height: '65vh' }} />
      </div>
    </div>
  )
}
