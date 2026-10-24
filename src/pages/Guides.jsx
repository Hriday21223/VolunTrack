import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowRight, BookOpen, ChevronRight } from 'lucide-react'
import Card from '@/components/Card.jsx'
import Footer from '@/components/Footer.jsx'
import PublicHeader from '@/components/PublicHeader.jsx'
import { useSeo } from '@/hooks/useSeo.js'
import { GUIDES, guideBySlug } from '@/lib/guides.js'
import NotFound from '@/pages/NotFound.jsx'

const SITE_URL = (import.meta.env.VITE_SITE_URL || 'http://localhost:5173').replace(/\/$/, '')

// /guides and /guides/:slug (#487): practical articles for what students and
// parents search for, each ending in a sign-up. Content lives in
// src/lib/guides.js; prerendered by scripts/prerender.mjs and listed in the
// sitemap by scripts/generate-seo-files.mjs.

function Header() {
  return (
    <PublicHeader>
      <Link to="/login" className="btn-ghost">Sign in</Link>
      <Link to="/register" className="btn-primary hidden sm:inline-flex">Get started free</Link>
    </PublicHeader>
  )
}

function SignUpCta() {
  return (
    <Card className="mt-10 text-center">
      <h2 className="text-xl font-bold">Track your hours with VolunTrack</h2>
      <p className="mt-2 text-sm text-earth-500 dark:text-earth-400">Free for students. Log hours in a minute, see your goal, and export a report when it’s due.</p>
      <div className="mt-4 flex flex-wrap justify-center gap-3">
        <Link to="/register" className="btn-primary">Create a free account <ArrowRight className="w-4 h-4" /></Link>
        <Link to="/for-schools" className="btn-ghost">For schools</Link>
      </div>
    </Card>
  )
}

export function GuidesIndex() {
  useSeo({
    title: 'Volunteer Hour Guides',
    description: 'Practical guides for students and parents: tracking NHS service hours, community service hours for high school, and volunteer hours for college applications.',
    path: '/guides',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: 'Volunteer Hour Guides',
      url: `${SITE_URL}/guides`,
      hasPart: GUIDES.map((g) => ({ '@type': 'Article', headline: g.title, url: `${SITE_URL}/guides/${g.slug}` })),
    },
  })
  useEffect(() => { window.scrollTo(0, 0) }, [])

  return (
    <div className="min-h-screen page-shell">
      <Header />
      <main className="max-w-3xl mx-auto px-4 md:px-8 pb-20">
        <h1 className="text-3xl md:text-4xl font-bold text-center">Volunteer hour guides</h1>
        <p className="text-center text-earth-500 dark:text-earth-400 mt-3">Simple, practical advice for logging service hours that count.</p>
        <ul className="mt-10 space-y-4">
          {GUIDES.map((g) => (
            <li key={g.slug}>
              <Link to={`/guides/${g.slug}`} className="block group">
                <Card className="transition group-hover:border-brand-500/50">
                  <h2 className="text-lg font-semibold flex items-center gap-2"><BookOpen className="w-4 h-4 text-brand-500 shrink-0" /> {g.title}</h2>
                  <p className="mt-2 text-sm text-earth-500 dark:text-earth-400">{g.description}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-sm text-brand-600 dark:text-brand-400">Read the guide <ChevronRight className="w-4 h-4" /></span>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
        <SignUpCta />
      </main>
      <Footer />
    </div>
  )
}

function Paragraph({ p }) {
  if (Array.isArray(p)) {
    return (
      <ul className="list-disc pl-6 space-y-1.5">
        {p.map((item) => <li key={item}>{item}</li>)}
      </ul>
    )
  }
  return <p>{p}</p>
}

export function GuidePage() {
  const { slug } = useParams()
  const guide = guideBySlug(slug)
  useSeo(guide ? {
    title: guide.title,
    description: guide.description,
    path: `/guides/${guide.slug}`,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: guide.title,
        description: guide.description,
        dateModified: guide.updated,
        datePublished: guide.updated,
        mainEntityOfPage: `${SITE_URL}/guides/${guide.slug}`,
        author: { '@type': 'Organization', name: 'VolunTrack', url: SITE_URL },
        publisher: { '@type': 'Organization', name: 'VolunTrack', logo: { '@type': 'ImageObject', url: `${SITE_URL}/app-icon.png` } },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
          { '@type': 'ListItem', position: 2, name: 'Guides', item: `${SITE_URL}/guides` },
          { '@type': 'ListItem', position: 3, name: guide.short, item: `${SITE_URL}/guides/${guide.slug}` },
        ],
      },
    ],
  } : { title: 'Guide not found', path: '/guides' })
  useEffect(() => { window.scrollTo(0, 0) }, [slug])

  if (!guide) return <NotFound />
  const others = GUIDES.filter((g) => g.slug !== guide.slug)

  return (
    <div className="min-h-screen page-shell">
      <Header />
      <main className="max-w-3xl mx-auto px-4 md:px-8 pb-20">
        <nav aria-label="Breadcrumb" className="text-sm text-earth-500 dark:text-earth-400">
          <Link to="/" className="hover:underline">Home</Link>{' / '}
          <Link to="/guides" className="hover:underline">Guides</Link>
        </nav>
        <article>
          <h1 className="mt-3 text-3xl md:text-4xl font-bold leading-tight">{guide.title}</h1>
          <p className="mt-2 text-xs text-earth-500 dark:text-earth-400">Updated {new Date(`${guide.updated}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
          <p className="mt-6 text-lg text-earth-700 dark:text-earth-200">{guide.intro}</p>
          <Card className="mt-8 space-y-8 text-earth-700 dark:text-earth-200">
            {guide.sections.map((s) => (
              <section key={s.heading} className="space-y-3">
                <h2 className="text-xl font-semibold text-earth-900 dark:text-white">{s.heading}</h2>
                {s.body.map((p, i) => <Paragraph key={i} p={p} />)}
              </section>
            ))}
          </Card>
        </article>
        <SignUpCta />
        <section className="mt-10">
          <h2 className="text-lg font-semibold">More guides</h2>
          <ul className="mt-3 space-y-2">
            {others.map((g) => (
              <li key={g.slug}><Link to={`/guides/${g.slug}`} className="text-brand-600 dark:text-brand-400 hover:underline">{g.title}</Link></li>
            ))}
          </ul>
        </section>
      </main>
      <Footer />
    </div>
  )
}
