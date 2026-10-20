import { useRef, useState } from 'react'
import { Upload, FileText, X } from 'lucide-react'
import { cn } from '@/utils/cn.js'
import { tr } from '@/lib/i18n.js'

/**
 * File picker with drag-and-drop.
 * - Accepts images or PDFs (configurable).
 * - Reads the file to a base64 dataURL via FileReader.
 * - Surfaces the dataURL + filename + mimeType to the parent.
 */
export default function FileDrop({ onFile, accept = 'image/*,application/pdf', maxBytes = 1_500_000, value, onClear }) {
  const [hover, setHover] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  const handle = (file) => {
    setError('')
    if (!file) return
    if (file.size > maxBytes) {
      setError(`File is too large. Keep it under ${Math.round(maxBytes / 1024)} KB.`)
      return
    }
    const reader = new FileReader()
    reader.onload = () => onFile({ name: file.name, size: file.size, mimeType: file.type, dataUrl: reader.result })
    reader.onerror = () => setError(tr('Could not read that file. Try another.'))
    reader.readAsDataURL(file)
  }

  return (
    <div>
      {!value ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setHover(true) }}
          onDragLeave={() => setHover(false)}
          onDrop={(e) => {
            e.preventDefault()
            setHover(false)
            handle(e.dataTransfer.files?.[0])
          }}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'rounded-2xl border-2 border-dashed border-earth-200 dark:border-[#243529]',
            'p-6 text-center cursor-pointer transition select-none',
            'hover:border-brand-500 hover:bg-brand-50/40',
            'dark:hover:bg-brand-900/10',
            hover && 'drop-active',
          )}
        >
          <Upload className="w-7 h-7 mx-auto text-brand-600 mb-2" />
          <div className="text-sm font-medium text-earth-800 dark:text-earth-100">
            {tr('Drop a file or click to upload')}
          </div>
          <div className="text-xs text-earth-500 dark:text-earth-400 mt-1">
            {tr('Images or PDFs · up to')}{' '}{Math.round(maxBytes / 1024)}{' '}{tr('KB')}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => handle(e.target.files?.[0])}
          />
        </div>
      ) : (
        <div className="flex items-center gap-3 p-3 rounded-2xl border border-earth-200 dark:border-[#243529] bg-earth-50 dark:bg-[#0f1a14]">
          {value.mimeType?.startsWith('image/') ? (
            <img src={value.dataUrl} alt={value.name} className="w-12 h-12 rounded-lg object-cover" />
          ) : (
            <div className="w-12 h-12 rounded-lg bg-brand-100 dark:bg-brand-900/30 grid place-items-center text-brand-700">
              <FileText className="w-6 h-6" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{value.name}</div>
            <div className="text-xs text-earth-500">{Math.round(value.size / 1024)}{' '}{tr('KB')}</div>
          </div>
          <button
            type="button"
            onClick={onClear}
            className="p-1.5 rounded-lg hover:bg-earth-200 dark:hover:bg-[#243529] text-earth-500"
            aria-label={tr('Remove file')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
    </div>
  )
}
