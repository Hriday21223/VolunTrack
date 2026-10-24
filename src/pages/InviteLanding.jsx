import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowRight, Clock, Target, FileText, Gift, Loader2 } from 'lucide-react'
import Card from '@/components/Card.jsx'
import Footer from '@/components/Footer.jsx'
import PublicHeader from '@/components/PublicHeader.jsx'
import { useAuth } from '@/hooks/useAuth.jsx'
import { useSeo } from '@/hooks/useSeo.js'
import { tr } from '@/lib/i18n.js'
import { cleanInviteCode, rememberInvite } from '@/lib/invite.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

// /invite/:code (#493): where a friend's invite link lands. Shows the
// inviter's first name only, keeps the code on this device, and sends the
// visitor to sign-up with it. A code that no longer works still gets the
// pitch — the friend is welcome either way.
export default function InviteLanding() {
  const { code: raw = '' } = useParams()
  const code = cleanInviteCode(raw)
  const { user } = useAuth()
  const [inviter, setInviter] = useState(null) // first name, '' when unknown
  const [loading, setLoading] = useState(Boolean(code))

  useSeo({
    title: inviter ? tr('{name} invited you to VolunTrack', { name: inviter }) : tr("You're invited to VolunTrack"),
    description: tr('Track your volunteer hours free: log hours in a minute, see your goal, and download a report when it is due.'),
    path: `/invite/${code}`,
  })

  useEffect(() => {
    if (!code) return
    rememberInvite(code)
    let cancelled = false
    fetch(`${apiUrl}/invites/${encodeURIComponent(code)}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((d) => !cancelled && setInviter(d.firstName || ''))
      .catch(() => !cancelled && setInviter(''))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [code])

  const points = [
    [Clock, tr('Log hours in under a minute, from your phone.')],
    [Target, tr('See how close you are to your goal.')],
    [FileText, tr('Download a report when your hours are due.')],
  ]

  return (
    <div className="min-h-screen page-shell flex flex-col">
      <PublicHeader />
      <main className="flex-1 max-w-xl w-full mx-auto px-4 pb-16">
        <Card className="text-center py-10">
          <div className="mx-auto mb-4 w-12 h-12 rounded-2xl bg-brand-500/15 grid place-items-center">
            <Gift className="w-6 h-6 text-brand-500" />
          </div>
          {loading ? (
            <p className="flex items-center justify-center gap-2 text-earth-500"><Loader2 className="w-4 h-4 animate-spin" /> {tr('Loading…')}</p>
          ) : (
            <>
              <h1 className="text-2xl md:text-3xl font-bold">
                {inviter ? tr('{name} invited you to VolunTrack', { name: inviter }) : tr("You're invited to VolunTrack")}
              </h1>
              <p className="mt-3 text-earth-500 dark:text-earth-400">
                {tr('The free way for students to track volunteer hours.')}
              </p>
              <ul className="mt-6 space-y-2 text-left max-w-sm mx-auto">
                {points.map(([Icon, text]) => (
                  <li key={text} className="flex items-start gap-2 text-sm"><Icon className="w-4 h-4 mt-0.5 text-brand-500 shrink-0" /> {text}</li>
                ))}
              </ul>
              {user ? (
                <div className="mt-8">
                  <p className="text-sm text-earth-500 dark:text-earth-400">{tr('You already have an account.')}</p>
                  <Link to="/" className="btn-secondary mt-3">{tr('Go to my dashboard')}</Link>
                </div>
              ) : (
                <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3">
                  <Link to={code ? `/register?invite=${code}` : '/register'} className="btn-primary">
                    {tr('Create my free account')} <ArrowRight className="w-4 h-4" />
                  </Link>
                  <Link to="/login" className="btn-ghost">{tr('Sign in')}</Link>
                </div>
              )}
            </>
          )}
        </Card>
      </main>
      <Footer />
    </div>
  )
}
