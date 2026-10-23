// Task cover photos (server/routes/taskPhotos.js).
//
// A picked photo is redrawn through a canvas before upload, like the branding
// logo (logoImage.js): that drops EXIF — including GPS — and other metadata,
// and caps it at 1600px wide so a phone photo isn't sent at full size. The
// server checks the bytes and strips metadata again, so this is the first
// line, not the only one.

import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

export const TASK_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
// Matches MAX_TASK_PHOTO_BYTES on the server.
export const MAX_TASK_PHOTO_BYTES = 3 * 1024 * 1024
const MAX_INPUT_BYTES = 20 * 1024 * 1024
const MAX_WIDTH = 1600
const MAX_HEIGHT = 2400

export function taskPhotoUrl(photoId) {
  return photoId ? `${apiUrl}/task-photos/file/${encodeURIComponent(photoId)}` : null
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(tr('Could not read that image. Try a JPEG or PNG.')))
    img.src = src
  })
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/**
 * Shrinks and re-encodes a picked file to a metadata-free JPEG.
 * @returns {Promise<Blob>}
 */
export async function prepareTaskPhoto(file) {
  if (!file) throw new Error(tr('Choose a photo.'))
  if (!TASK_PHOTO_TYPES.includes(file.type)) throw new Error(tr('Photo must be a JPEG, PNG, or WebP image.'))
  if (file.size > MAX_INPUT_BYTES) throw new Error(tr('That photo is too large. Use one under 20 MB.'))

  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (!w || !h) throw new Error(tr('Could not read that image. Try a JPEG or PNG.'))
    const scale = Math.min(1, MAX_WIDTH / w, MAX_HEIGHT / h)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * scale))
    canvas.height = Math.max(1, Math.round(h * scale))
    const ctx = canvas.getContext('2d')
    // JPEG has no transparency; a transparent PNG would otherwise turn black.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.85, 0.7, 0.55]) {
      const blob = await toBlob(canvas, 'image/jpeg', quality)
      if (blob && blob.size <= MAX_TASK_PHOTO_BYTES) return blob
    }
    throw new Error(tr('That photo is too large. Use one under 3 MB.'))
  } finally {
    URL.revokeObjectURL(url)
  }
}

function authHeader() {
  return { Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` }
}

/** Adds or replaces a task's cover photo. @returns {Promise<string>} the new photo id */
export async function uploadTaskPhoto(taskId, blob) {
  const res = await fetch(`${apiUrl}/task-photos/${encodeURIComponent(taskId)}`, {
    method: 'PUT',
    headers: { ...authHeader(), 'Content-Type': blob.type || 'image/jpeg' },
    body: blob,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || tr('Could not save the photo.'))
  return data.coverPhotoId
}

export async function deleteTaskPhoto(taskId) {
  const res = await fetch(`${apiUrl}/task-photos/${encodeURIComponent(taskId)}`, { method: 'DELETE', headers: authHeader() })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || tr('Could not remove the photo.'))
}

/**
 * "Post again" copies a photo by downloading the earlier task's picture and
 * uploading it to the new task as its own file — the two tasks never share
 * one, so removing or replacing either can't affect the other.
 */
export async function fetchTaskPhoto(photoId) {
  const res = await fetch(taskPhotoUrl(photoId))
  if (!res.ok) throw new Error(tr('Could not copy the photo.'))
  return res.blob()
}
