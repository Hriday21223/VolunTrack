import { useEffect, useState } from 'react'
import { Trophy, X } from 'lucide-react'
import { BADGES } from '@/lib/achievements.js'
import { cn } from '@/utils/cn.js'
import { tr } from '@/lib/i18n.js'

/** Slides a list of newly-earned badges in from the bottom. */
export default function BadgeToasts({ badgeIds, onDone }) {
  const [visible, setVisible] = useState(badgeIds)

  useEffect(() => { setVisible(badgeIds) }, [badgeIds])

  useEffect(() => {
    if (!visible.length) return
    const t = setTimeout(() => {
      setVisible([])
      onDone?.()
    }, 5000)
    return () => clearTimeout(t)
  }, [visible, onDone])

  if (!visible.length) return null

  return (
    <div className="fixed bottom-20 md:bottom-6 right-4 md:right-6 z-50 space-y-2 animate-slide-up">
      {visible.map((id) => {
        const b = BADGES.find((x) => x.id === id)
        if (!b) return null
        return (
          <div
            key={id}
            className={cn(
              'flex items-center gap-3 pl-3 pr-2 py-2 rounded-2xl shadow-soft',
              'bg-gradient-to-br from-amber-50 to-amber-100 border border-amber-200',
              'dark:from-amber-900/30 dark:to-amber-800/20 dark:border-amber-700/40',
            )}
          >
            <div className="w-10 h-10 rounded-xl bg-amber-500 text-white grid place-items-center animate-pop">
              <Trophy className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium text-amber-700 dark:text-amber-300">{tr('Achievement earned!')}</div>
              <div className="text-sm font-semibold text-amber-900 dark:text-amber-100 truncate">{b.title}</div>
            </div>
            <button
              onClick={() => setVisible((v) => v.filter((x) => x !== id))}
              className="p-1 rounded-md text-amber-700/70 hover:bg-amber-200/50"
              aria-label={tr('Dismiss')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
