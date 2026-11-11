import { useEffect, useRef } from 'react'

// Calls onClose when Escape is pressed while `active` is true, so a dialog can
// be dismissed from the keyboard without tabbing to its Close button (#851).
// The latest onClose is read through a ref, so callers can pass an inline arrow.
export default function useEscapeKey(onClose, active = true) {
  const ref = useRef(onClose)
  ref.current = onClose
  useEffect(() => {
    if (!active) return undefined
    const onKey = (e) => { if (e.key === 'Escape') ref.current?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])
}
