import { useEffect, useState } from 'react'
import { Handshake, ChevronDown, ExternalLink, MapPin } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { tr } from '@/lib/i18n.js'
import { taskMapsUrl } from '@/lib/taskDetails.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

// Opportunities → Partners (#611): the nonprofits the organization that owns
// the student's school has approved. Hidden when there are none.
export default function PartnersCard() {
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let token = null
    try { token = localStorage.getItem('voluntrack:auth_token') } catch { /* private mode */ }
    if (!token) return
    let live = true
    fetch(`${apiUrl}/school/partners`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d) setData(d) })
      .catch(() => {})
    return () => { live = false }
  }, [])

  if (!data?.partners?.length) return null
  return (
    <Card padded={false} className="p-3">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full flex items-center justify-between gap-2 text-sm font-medium">
        <span className="flex items-center gap-2">
          <Handshake className="w-4 h-4 text-brand-400" />
          {tr('Partners ({n})', { n: data.partners.length })}
        </span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <p className="text-xs text-earth-500 mt-2">
            {data.organizationName
              ? tr('Places {org} works with. Hours you serve at them count toward your goals.', { org: data.organizationName })
              : tr('Places your school works with. Hours you serve at them count toward your goals.')}
          </p>
          <ul className="mt-2 space-y-2">
            {data.partners.map((p) => (
              <li key={p.id} className="rounded-xl border border-white/10 px-3 py-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  {p.name}
                  {p.website && <a href={p.website} target="_blank" rel="noopener noreferrer" className="text-brand-400" aria-label={tr('Website')}><ExternalLink className="w-3.5 h-3.5" /></a>}
                </p>
                {p.address && (
                  <a href={taskMapsUrl({ location: p.address })} target="_blank" rel="noopener noreferrer" className="text-xs text-earth-500 hover:text-brand-400 inline-flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> {p.address}
                  </a>
                )}
                {(p.causes || []).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">{p.causes.map((c) => <span key={c} className="chip text-xs">{tr(c)}</span>)}</div>
                )}
                {p.contactName && <p className="text-xs text-earth-500 mt-1">{[p.contactName, p.contactEmail].filter(Boolean).join(' · ')}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}
