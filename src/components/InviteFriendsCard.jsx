import { useState } from 'react'
import { UserPlus, Copy, Check, Share2 } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { useData } from '@/hooks/useData.jsx'
import { inviteUrl } from '@/lib/invite.js'
import { tr } from '@/lib/i18n.js'
import { cn } from '@/utils/cn.js'

// Invite a friend (#493): the student's personal link, Copy and Share, and
// how many friends joined — a count only. Nothing renders for an account that
// can't invite (useData leaves `invite` null for under-13s and other roles).
export default function InviteFriendsCard({ className }) {
  const { invite } = useData()
  const [copied, setCopied] = useState(false)
  if (!invite?.code) return null

  const url = inviteUrl(invite.code)
  const joined = invite.joined
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* the link is on screen to select */ }
  }
  const share = async () => {
    try {
      await navigator.share({ title: 'VolunTrack', text: tr('I track my volunteer hours on VolunTrack. It is free. Join me:'), url })
    } catch { /* cancelled */ }
  }

  let status
  if (joined === 0) status = tr('Earn the Bring a Friend badge when a friend joins with your link.')
  else if (joined < 5) status = tr('{n} of 5 friends joined. Reach 5 for the Team Builder badge.', { n: joined })
  else status = tr('{n} friends joined. Thank you for spreading the word!', { n: joined })

  return (
    <Card className={cn(className)}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="font-display font-semibold flex items-center gap-2"><UserPlus className="w-4 h-4 text-brand-500" /> {tr('Invite friends')}</h3>
          <p className="mt-1 text-sm text-earth-500 dark:text-earth-400">{tr('Volunteering is better together. Send friends your link so they can track their hours too.')}</p>
        </div>
        {joined > 0 && (
          <span className="chip-brand shrink-0">{joined === 1 ? tr('1 friend joined') : tr('{n} friends joined', { n: joined })}</span>
        )}
      </div>

      <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
        <code className="flex-1 min-w-0 overflow-x-auto whitespace-nowrap rounded-lg bg-earth-100 dark:bg-earth-800 px-3 py-2 font-mono text-sm">{url}</code>
        <div className="flex gap-2 shrink-0">
          <button type="button" className="btn-sm btn-ghost" onClick={copy}>
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? tr('Copied') : tr('Copy')}
          </button>
          {canShare && (
            <button type="button" className="btn-sm btn-primary" onClick={share}>
              <Share2 className="w-3.5 h-3.5" /> {tr('Share')}
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-xs text-earth-500 dark:text-earth-400">{status}</p>
    </Card>
  )
}
