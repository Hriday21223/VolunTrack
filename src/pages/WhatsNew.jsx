import { useEffect } from 'react'
import { Sparkles } from 'lucide-react'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import { useAuth } from '@/hooks/useAuth.jsx'
import { tr } from '@/lib/i18n.js'
import { fmtDate } from '@/utils/date.js'
import { itemsFor, markSeen } from '@/lib/whatsNew.js'

// What's new (#708): recent features for the viewer's role, newest first.
export default function WhatsNew() {
  const { user } = useAuth()
  useEffect(() => { markSeen(); window.dispatchEvent(new Event('voluntrack:whats-new-seen')) }, [])
  return (
    <AppLayout title={tr("What's new")} subtitle={tr('Recent changes to VolunTrack')}>
      <div className="space-y-4 max-w-2xl">
        {itemsFor(user?.role).map((r) => (
          <Card key={r.id}>
            <p className="text-sm font-semibold flex items-center gap-2"><Sparkles className="w-4 h-4 text-brand-500" aria-hidden="true" />{fmtDate(r.date)}</p>
            <ul className="mt-2 space-y-1.5 list-disc pl-5 text-sm">
              {r.items.map((i) => <li key={i.text}>{tr(i.text)}</li>)}
            </ul>
          </Card>
        ))}
      </div>
    </AppLayout>
  )
}
