import { useEffect, useState } from 'react'
import { Share2, Download, X, ImageIcon } from 'lucide-react'
import { drawHoursCard, canvasToBlob, canShareImage, shareHoursImage, downloadHoursImage } from '@/lib/hoursCard.js'
import { isNativeApp } from '@/lib/platform.js'
import { tr } from '@/lib/i18n.js'

// "Share my hours" (#478): a preview of the picture, a switch to leave the
// name off, and Share (the phone's sheet) or Download. The picture is made on
// this device; nothing is uploaded. In the apps, where a web view may not
// share or download files, pressing and holding the preview saves it.
export default function ShareHoursModal({ name, totalHours, approvedHours, sessions, causes, onClose }) {
  const [showName, setShowName] = useState(Boolean(name))
  const [image, setImage] = useState(null) // { url, blob }
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const shareable = canShareImage()

  useEffect(() => {
    let cancelled = false
    let url = null
    drawHoursCard({ name: showName ? name : '', totalHours, approvedHours, sessions, causes })
      .then(canvasToBlob)
      .then((blob) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setImage({ url, blob })
      })
      .catch((e) => !cancelled && setMsg(e.message))
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [showName, name, totalHours, approvedHours, sessions, causes])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const onShare = async () => {
    if (!image) return
    setBusy(true)
    setMsg('')
    try {
      await shareHoursImage(image.blob)
    } catch {
      // The sheet refused the file after all: save it instead.
      downloadHoursImage(image.blob)
      setMsg(tr('Saved the picture. Share it from your photos or downloads.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/80 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-labelledby="share-hours-title">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0f1813] p-5 text-white shadow-soft max-h-[95vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="share-hours-title" className="font-display font-semibold text-lg flex items-center gap-2"><ImageIcon className="w-5 h-5 text-brand-400" /> {tr('Share my hours')}</h2>
            <p className="text-sm text-earth-400">{tr('A picture of your hours for Instagram, a story, or a college application.')}</p>
          </div>
          <button onClick={onClose} className="btn-ghost p-1" aria-label={tr('Close')}><X className="w-5 h-5" /></button>
        </div>

        <div className="mt-4 rounded-xl overflow-hidden border border-white/10 bg-black/30 aspect-[4/5] grid place-items-center">
          {image
            ? <img src={image.url} alt={tr('Your volunteer hours: {n} hours of service', { n: Math.round(totalHours * 10) / 10 })} className="w-full h-full object-contain" />
            : <span className="text-sm text-earth-400">{tr('Making your picture…')}</span>}
        </div>

        {name && (
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} />
            {tr('Show my name')}
          </label>
        )}

        {msg && <p className="mt-3 text-sm text-emerald-300" role="status">{msg}</p>}

        <div className="mt-4 flex flex-col sm:flex-row gap-2">
          {shareable && (
            <button type="button" className="btn-primary flex-1" onClick={onShare} disabled={!image || busy}>
              <Share2 className="w-4 h-4" />{' '}{tr('Share')}
            </button>
          )}
          {!isNativeApp && (
            <button type="button" className={`${shareable ? 'btn-secondary' : 'btn-primary'} flex-1`} onClick={() => image && downloadHoursImage(image.blob)} disabled={!image}>
              <Download className="w-4 h-4" />{' '}{tr('Download')}
            </button>
          )}
        </div>
        {isNativeApp && !shareable && (
          <p className="mt-3 text-xs text-earth-400">{tr('Press and hold the picture to save it to your photos.')}</p>
        )}
      </div>
    </div>
  )
}
