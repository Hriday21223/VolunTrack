import { useRef, useEffect, useState, useCallback } from 'react'
import { Eraser } from 'lucide-react'

// Draw-to-sign pad, backed by a canvas. Stores/emits the result as a base64
// PNG data URL (same shape FileDrop.jsx uses for the proof upload), so it
// slots into the existing save/sync/export pipeline without a new format.
export default function SignaturePad({ value, onChange }) {
  const canvasRef = useRef(null)
  const drawingRef = useRef(false)
  const lastPointRef = useRef(null)
  const [hasStroke, setHasStroke] = useState(!!value)

  // Backs the canvas at 2x device pixels for a crisp line, while the CSS
  // size stays fixed — a plain low-res canvas looks noticeably blurry for
  // something as detail-sensitive as a signature.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const { width, height } = canvas.getBoundingClientRect()
    canvas.width = width * dpr
    canvas.height = height * dpr
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1c3720'

    if (value) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0, width, height)
      img.src = value
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const getPoint = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const touch = e.touches?.[0]
    return {
      x: (touch?.clientX ?? e.clientX) - rect.left,
      y: (touch?.clientY ?? e.clientY) - rect.top,
    }
  }

  const start = (e) => {
    e.preventDefault()
    drawingRef.current = true
    lastPointRef.current = getPoint(e)
  }

  const draw = (e) => {
    if (!drawingRef.current) return
    e.preventDefault()
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const point = getPoint(e)
    ctx.beginPath()
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y)
    ctx.lineTo(point.x, point.y)
    ctx.stroke()
    lastPointRef.current = point
    setHasStroke(true)
  }

  const stop = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    const canvas = canvasRef.current
    // Downscale to a modest fixed-width PNG — a signature doesn't need
    // full canvas resolution, and this keeps the stored payload small
    // (well under the server's 200KB-per-signature cap).
    const out = document.createElement('canvas')
    out.width = 400
    out.height = 150
    out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height)
    onChange(out.toDataURL('image/png'))
  }

  const clear = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const { width, height } = canvas.getBoundingClientRect()
    ctx.clearRect(0, 0, width, height)
    setHasStroke(false)
    onChange('')
  }, [onChange])

  return (
    <div>
      <div className="relative rounded-lg border border-earth-300 dark:border-earth-800 bg-white overflow-hidden" style={{ height: 150 }}>
        <canvas
          ref={canvasRef}
          className="w-full h-full touch-none cursor-crosshair"
          onMouseDown={start}
          onMouseMove={draw}
          onMouseUp={stop}
          onMouseLeave={stop}
          onTouchStart={start}
          onTouchMove={draw}
          onTouchEnd={stop}
        />
        {!hasStroke && (
          <span className="absolute inset-0 grid place-items-center text-sm text-earth-400 pointer-events-none">
            Sign here
          </span>
        )}
      </div>
      {hasStroke && (
        <button type="button" onClick={clear} className="btn-ghost text-xs mt-2 inline-flex items-center gap-1.5">
          <Eraser className="w-3.5 h-3.5" /> Clear signature
        </button>
      )}
    </div>
  )
}
