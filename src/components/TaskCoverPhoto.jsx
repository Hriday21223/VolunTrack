import { useState } from 'react'
import { taskPhotoUrl } from '@/lib/taskPhoto.js'

/**
 * A task's cover photo, 16:9 and cropped to fill. Renders nothing for a task
 * without one, or if the picture fails to load (removed by a moderator, say).
 */
export default function TaskCoverPhoto({ photoId, title, className = '' }) {
  const [failed, setFailed] = useState(null)
  if (!photoId || failed === photoId) return null
  return (
    <div className={`aspect-video overflow-hidden bg-earth-100 dark:bg-white/5 ${className}`}>
      <img
        src={taskPhotoUrl(photoId)}
        alt={title || ''}
        loading="lazy"
        decoding="async"
        className="w-full h-full object-cover"
        onError={() => setFailed(photoId)}
      />
    </div>
  )
}
