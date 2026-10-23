import { useEffect, useId, useRef, useState } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import { tr } from '@/lib/i18n.js'
import { prepareTaskPhoto, uploadTaskPhoto, deleteTaskPhoto, taskPhotoUrl, TASK_PHOTO_TYPES } from '@/lib/taskPhoto.js'

/**
 * Cover photo picker for the My Tasks forms.
 *
 * Without `taskId` (the "Post a task" form) the choice is held until the task
 * exists: `value` is `{ blob }` for a newly picked photo, `{ photoId }` for
 * one copied by "Post again", or null; the form uploads it after posting.
 *
 * With `taskId` (editing) a change is saved straight away and `onSaved` gets
 * the new photo id, or null once removed.
 */
export default function TaskPhotoPicker({ value, onChange, taskId, photoId, onSaved }) {
  const inputId = useId()
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(null)

  const live = Boolean(taskId)
  const blob = live ? null : value?.blob

  // An object URL for a picked-but-not-uploaded photo, released when it changes.
  useEffect(() => {
    if (!blob) { setPreview(null); return undefined }
    const url = URL.createObjectURL(blob)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [blob])

  const shownId = live ? photoId : value?.photoId
  const src = preview || taskPhotoUrl(shownId)

  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    setBusy(true)
    try {
      const prepared = await prepareTaskPhoto(file)
      if (live) onSaved(await uploadTaskPhoto(taskId, prepared))
      else onChange({ blob: prepared })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setError('')
    if (!live) { onChange(null); return }
    setBusy(true)
    try {
      await deleteTaskPhoto(taskId)
      onSaved(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <label className="label text-xs" htmlFor={inputId}>{tr('Cover photo (optional)')}</label>
      {src ? (
        <div className="relative aspect-video w-full max-w-sm overflow-hidden rounded-xl bg-earth-100 dark:bg-white/5">
          <img src={src} alt={tr('Cover photo preview')} className="w-full h-full object-cover" />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2 mt-2">
        <button type="button" className="btn-sm btn-ghost" disabled={busy} onClick={() => inputRef.current?.click()}>
          <ImagePlus className="w-3.5 h-3.5 mr-1" /> {busy ? tr('Saving photo…') : src ? tr('Change photo') : tr('Add a photo')}
        </button>
        {src && (
          <button type="button" className="btn-sm btn-ghost text-red-400" disabled={busy} onClick={remove}>
            <Trash2 className="w-3.5 h-3.5 mr-1" /> {tr('Remove photo')}
          </button>
        )}
      </div>
      <input id={inputId} ref={inputRef} type="file" accept={TASK_PHOTO_TYPES.join(',')} className="sr-only" onChange={pick} />
      <p className="text-xs text-earth-500 mt-1">{tr("Don't upload photos where volunteers can be identified without their permission.")}</p>
      {error && <p className="text-xs text-red-400 mt-1" role="alert">{error}</p>}
    </div>
  )
}
