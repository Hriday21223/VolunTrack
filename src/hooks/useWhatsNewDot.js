import { useEffect, useState } from 'react'
import { hasUnseen } from '@/lib/whatsNew.js'

// Whether to show the "What's new" dot (#708); clears when the page is opened.
export function useWhatsNewDot() {
  const [unseen, setUnseen] = useState(hasUnseen)
  useEffect(() => {
    const off = () => setUnseen(hasUnseen())
    window.addEventListener('voluntrack:whats-new-seen', off)
    return () => window.removeEventListener('voluntrack:whats-new-seen', off)
  }, [])
  return unseen
}
