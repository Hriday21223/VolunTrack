import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Compass, Home, HelpCircle } from 'lucide-react'
import Card from '@/components/Card.jsx'
import Footer from '@/components/Footer.jsx'
import PublicHeader from '@/components/PublicHeader.jsx'
import { useAuth } from '@/hooks/useAuth.jsx'
import { useSeo } from '@/hooks/useSeo.js'

// Shown for any address the app doesn't have. It used to redirect to the home
// page, which hid a mistyped or broken link instead of saying so.
export default function NotFound() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  useSeo({ title: 'Page not found', description: "This page doesn't exist on VolunTrack.", path: pathname })

  // Keep search engines from indexing a page that only says "not found".
  useEffect(() => {
    const tag = document.createElement('meta')
    tag.name = 'robots'
    tag.content = 'noindex'
    document.head.appendChild(tag)
    return () => tag.remove()
  }, [])

  return (
    <div className="min-h-screen page-shell flex flex-col">
      <PublicHeader />
      <main className="flex-1 grid place-items-center px-4 pb-20">
        <Card className="max-w-md w-full text-center">
          <div className="w-12 h-12 rounded-full bg-brand-100 dark:bg-brand-900/30 grid place-items-center text-brand-700 dark:text-brand-300 mx-auto">
            <Compass className="w-6 h-6" />
          </div>
          <p className="mt-4 text-sm font-semibold text-brand-700 dark:text-brand-300">404</p>
          <h1 className="text-2xl font-bold mt-1">Page not found</h1>
          <p className="text-sm text-earth-500 dark:text-earth-400 mt-2 break-all">
            There&apos;s no page at <span className="font-mono">{pathname}</span>. The link may be mistyped, or the page may have moved.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-2 justify-center">
            <Link to="/" className="btn-primary inline-flex items-center justify-center">
              <Home className="w-4 h-4 mr-2" /> {user ? 'Go to your dashboard' : 'Go to the home page'}
            </Link>
            <Link to="/help" className="btn-ghost inline-flex items-center justify-center">
              <HelpCircle className="w-4 h-4 mr-2" /> Help
            </Link>
          </div>
        </Card>
      </main>
      <Footer />
    </div>
  )
}
