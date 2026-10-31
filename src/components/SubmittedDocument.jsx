import { useEffect, useState } from 'react'
import { Download, ExternalLink } from 'lucide-react'
import { tr } from '@/lib/i18n.js'

// A document a student submitted to their school, shown to that school.
//
// The type comes from the student's upload, so it's never trusted as is: a
// file declared text/html, turned into a same-origin blob URL, would run as a
// page on our origin with the school admin signed in. Only a PDF or an image
// is shown in place, each as that type; anything else can only be downloaded.
//
// <embed>/<object> aren't used: the site's CSP has object-src 'none', which
// blocks them outright and left this viewer blank. A PDF goes in an <iframe>
// on a blob: URL (allowed by frame-src blob:).
const SHOWN_AS = {
  'application/pdf': 'pdf',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
}

function base64ToBlob(base64, type) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type })
}

export default function SubmittedDocument({ doc }) {
  const declared = String(doc.fileType || 'application/pdf').toLowerCase()
  const kind = SHOWN_AS[declared] || 'download'
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (doc.url || !doc.fileData) return undefined
    let objectUrl = null
    try {
      objectUrl = URL.createObjectURL(base64ToBlob(doc.fileData, kind === 'download' ? 'application/octet-stream' : declared))
      setUrl(objectUrl)
    } catch {
      setFailed(true)
    }
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [doc.url, doc.fileData, declared, kind])

  // In the school's own storage: a short-lived link to their bucket, which
  // our CSP can't (and shouldn't) list as a frame source, so it opens in a tab.
  if (doc.url) {
    return (
      <div className="grid place-items-center h-full p-6 text-center text-earth-700">
        <div>
          <p className="mb-3">{tr('This document is kept in your school\'s own storage.')}</p>
          <a href={doc.url} target="_blank" rel="noopener noreferrer" className="btn-primary inline-flex">
            <ExternalLink className="w-4 h-4 mr-2" />{' '}{tr('Open document')}
          </a>
          <p className="text-xs mt-2 text-earth-500">{tr('The link works for a few minutes.')}</p>
        </div>
      </div>
    )
  }
  if (failed) return <p className="p-6 text-center text-earth-700">{tr('This document couldn\'t be read.')}</p>
  if (!url) return null
  if (kind === 'pdf') return <iframe src={url} title={doc.filename || tr('Submitted document')} className="w-full h-full" />
  if (kind === 'image') return <img src={url} alt={doc.filename || tr('Submitted document')} className="w-full h-full object-contain" />
  return (
    <div className="grid place-items-center h-full p-6 text-center text-earth-700">
      <a href={url} download={doc.filename || 'document'} className="btn-primary inline-flex">
        <Download className="w-4 h-4 mr-2" />{' '}{tr('Download')}{' '}{doc.filename || 'document'}
      </a>
    </div>
  )
}
