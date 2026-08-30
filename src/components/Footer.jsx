import { Link } from 'react-router-dom'
import { Instagram } from 'lucide-react'
import { cn } from '@/utils/cn.js'

const LINKS = [
  { to: '/about', label: 'About' },
  { to: '/contact', label: 'Contact' },
  { to: '/status', label: 'Status' },
  { to: '/help', label: 'Help' },
  { to: '/terms', label: 'Terms' },
  { to: '/privacy', label: 'Privacy' },
]

// Shared footer for the public (logged-out) pages. `tone="dark"` is for
// About, whose background is always dark regardless of theme; the default
// tone is theme-aware for the legal/status pages that follow the app theme.
export default function Footer({ tone = 'auto', className }) {
  const dark = tone === 'dark'
  return (
    <footer
      className={cn(
        'border-t text-sm',
        dark
          ? 'border-white/10 text-earth-400'
          : 'border-earth-200 text-earth-500 dark:border-white/10 dark:text-earth-400',
        className,
      )}
    >
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-8 flex flex-wrap items-center justify-between gap-4">
        <span>&copy; {new Date().getFullYear()} VolunTrack. All rights reserved.</span>
        <div className="flex flex-wrap items-center gap-4">
          {LINKS.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className={cn('transition-colors', dark ? 'hover:text-white' : 'hover:text-earth-900 dark:hover:text-white')}
            >
              {l.label}
            </Link>
          ))}
          <a
            href="https://www.instagram.com/volunteertrackofficial/"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'inline-flex items-center gap-1.5 transition-colors',
              dark ? 'hover:text-white' : 'hover:text-earth-900 dark:hover:text-white',
            )}
            aria-label="Instagram"
          >
            <Instagram className="w-4 h-4" />
            @volunteertrackofficial
          </a>
        </div>
      </div>
    </footer>
  )
}
