import { useEffect, useState } from 'react'
import { Code2, Copy, ExternalLink } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

// Opportunities widget (#695): the code a school or organization pastes on
// its own website to list its upcoming volunteer events.
export default function EmbedWidgetCard() {
  const [data, setData] = useState(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    fetch(`${apiUrl}/embed/code`, { headers: { Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => {})
  }, [])
  if (!data) return null
  const copy = async () => {
    try { await navigator.clipboard.writeText(data.snippet); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* select it by hand */ }
  }
  return (
    <Card className="mb-4">
      <h3 className="font-display font-semibold flex items-center gap-2"><Code2 className="w-4 h-4 text-brand-600" aria-hidden="true" />{tr('Show your events on your website')}</h3>
      <p className="text-sm text-earth-500 dark:text-earth-400 mt-1">{tr('Paste this code into your school or district website. It lists your upcoming volunteer events with a "Sign up on VolunTrack" button, and updates by itself.')}</p>
      <textarea readOnly value={data.snippet} rows={3} onFocus={(e) => e.target.select()} className="input mt-2 font-mono text-xs" aria-label={tr('Website code')} />
      <div className="flex flex-wrap gap-2 mt-2">
        <button type="button" className="btn-secondary btn-sm" onClick={copy}><Copy className="w-4 h-4 mr-1" />{' '}{copied ? tr('Copied') : tr('Copy code')}</button>
        <a href={data.url} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm"><ExternalLink className="w-4 h-4 mr-1" />{' '}{tr('Preview')}</a>
      </div>
    </Card>
  )
}
