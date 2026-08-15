import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Target, Trophy, FileText, Calendar, Sparkles, ShieldCheck, Users, Instagram, Clock, ChevronDown, Star, CheckCircle, BarChart3, Building2, Heart, TreePine, BookOpen as Book, Stethoscope, PawPrint, Palette, Dumbbell, Church, Megaphone, Ambulance, Globe, School, GraduationCap, Building, TrendingUp, Smartphone, Download, Lock, Bell, Gift, Zap, Menu, X } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { useSeo } from '@/hooks/useSeo.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

// Reviewers who don't opt to sign their name are shown as "VolunTrack
// <role>" instead — never a real name unless they explicitly added one.
const ROLE_LABELS = {
  student: 'Student',
  volunteer: 'Volunteer',
  school: 'School Admin',
  school_staff: 'School Co-Admin',
  parent: 'Parent',
  org: 'Organization Admin',
  admin: 'Team',
}
const roleLabel = (role) => ROLE_LABELS[role] || 'Volunteer'

const FEATURES = [
  { icon: Calendar,  title: 'Simple hour logging', body: 'Log activity, time, location, and proof so your volunteer work is always ready to share.' },
  { icon: Target,    title: 'Goal progress', body: 'Set a target and watch the progress ring fill as your hours add up.' },
  { icon: Trophy,    title: 'Achievements', body: 'Earn badges for consistency, milestones, and service across categories.' },
  { icon: FileText,  title: 'Reports & certificates', body: 'Export polished PDFs, CSVs, and printable certifications in seconds.' },
]

const DETAILED_FEATURES = [
  { icon: Smartphone, title: 'Mobile-friendly design', body: 'Log hours on the go from any device. The interface adapts to your phone, tablet, or laptop so you can record service whenever and wherever.' },
  { icon: Download, title: 'Export ready for anything', body: 'Generate clean PDF reports, CSV data exports, and printable certificates formatted for NHS, honor societies, scholarships, and school requirements.' },
  { icon: Lock, title: 'Private by design', body: 'Your data stays in your browser\'s local storage. No cloud uploads, no third-party servers, no tracking. You stay in control of your information.' },
  { icon: Bell, title: 'Smart reminders', body: 'Set custom reminders so you never forget to log a session. Get notified when you\'re approaching a goal milestone or when a badge is within reach.' },
  { icon: Gift, title: 'Badge rewards system', body: 'Earn achievements for consistency, category variety, hour milestones, and special challenges. Badges make service tracking motivating and fun.' },
  { icon: TrendingUp, title: 'Visual progress tracking', body: 'Monitor your monthly trends with bar charts, watch goal rings fill up, and see your all-time stats at a glance on a single dashboard.' },
]

const STEPS = [
  { icon: Users, title: 'Create your account', body: 'Sign up free in under a minute. No credit card needed.' },
  { icon: Clock, title: 'Log your hours', body: 'Record activity, duration, location, and supervisor details on the go.' },
  { icon: BarChart3, title: 'Track progress', body: 'Watch your monthly totals, goal rings, and achievements fill up.' },
  { icon: Trophy, title: 'Earn & export', body: 'Unlock badges and export polished reports for school or scholarships.' },
]

const CATEGORIES = [
  { icon: Heart,     label: 'Community Service', color: 'bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200' },
  { icon: TreePine,  label: 'Environmental', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200' },
  { icon: Book,      label: 'Education & Tutoring', color: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200' },
  { icon: Stethoscope, label: 'Health & Wellness', color: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200' },
  { icon: PawPrint,  label: 'Animal Welfare', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' },
  { icon: Palette,   label: 'Arts & Culture', color: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/40 dark:text-fuchsia-200' },
  { icon: Dumbbell,  label: 'Sports & Coaching', color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200' },
  { icon: Church,    label: 'Religious & Faith', color: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200' },
  { icon: Megaphone, label: 'Political & Advocacy', color: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200' },
  { icon: Ambulance, label: 'Disaster Relief', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200' },
]

const AUDIENCES = [
  {
    icon: GraduationCap, title: 'Students',
    body: 'Track required service hours for NHS, honor societies, scholarships, and college applications. Export proof-ready reports in seconds.',
    perks: ['Goal-based hour tracking', 'PDF & CSV exports', 'Badge milestones'],
  },
  {
    icon: School, title: 'School clubs & organizations',
    body: 'Manage group service requirements, monitor member participation, and generate reports for advisors and administrators.',
    perks: ['Member oversight', 'Progress monitoring', 'Bulk reporting'],
  },
  {
    icon: Building, title: 'Schools & districts',
    body: 'Adopt VolunTrack across your entire school or district. Give students a standardized way to log, verify, and report service hours.',
    perks: ['District-wide tracking', 'Admin dashboards', 'Partnership support'],
  },
  {
    icon: Globe, title: 'Nonprofits & community groups',
    body: 'Track volunteer contributions, manage tasks, and generate impact reports for grants, boards, and stakeholders.',
    perks: ['Task management', 'Impact reporting', 'Volunteer coordination'],
  },
]

const FAQS = [
  { q: 'Is VolunTrack free?', a: 'Yes, all features are completely free. There are no paid tiers or hidden costs.' },
  { q: 'Can I export my hours for school requirements?', a: 'Absolutely. You can export polished PDF reports, CSV files, and printable certificates with all your logged hours, supervisor details, and categories.' },
  { q: 'Is my data private?', a: 'By default, your data is stored entirely in your browser\'s local storage and never leaves your device. If you create an account to sync across devices or link to a school, your data is stored in a secure database and protected by password authentication and optional two-factor authentication. We never sell or share your data.' },
  { q: 'Can schools and organizations use VolunTrack?', a: 'Yes. Schools can create an account and share a join code so students link their hours to the school for review and approval. Organization accounts (for managing multiple schools) are set up by invitation — contact us to get started.' },
  { q: 'What if I forget to log a session?', a: 'You can log past sessions anytime. We also offer reminders so you never miss recording your volunteer work.' },
  { q: 'Does VolunTrack work offline?', a: 'Yes. VolunTrack is a Progressive Web App — after your first visit, it keeps working without an internet connection, and any local-mode data stays available offline.' },
  { q: 'What if I switch devices?', a: 'If you\'re using local-only mode, your data stays on that device. To carry it over, create an account and generate a sync PIN in Settings on your first device, then enter that PIN on the login screen of your new device to pull your data across.' },
  { q: 'Do I need to create an account?', a: 'No. VolunTrack works fully in your browser with no account required. Creating an account is only needed for cross-device sync, school/organization linking, or account recovery.' },
  { q: 'Is there a mobile app?', a: 'There\'s no separate app to install from a store. VolunTrack is a Progressive Web App, so you can open it in your phone\'s browser and tap "Add to Home Screen" for an app-like experience.' },
]


function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-white/10 last:border-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-4 py-5 text-left text-sm font-medium text-earth-200 hover:text-white transition-colors"
      >
        {q}
        <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="pb-5 text-sm text-earth-400 leading-7">
          {a}
        </div>
      )}
    </div>
  )
}

export default function About() {
  const [navOpen, setNavOpen] = useState(false)
  const [testimonials, setTestimonials] = useState([])

  useEffect(() => {
    fetch(`${apiUrl}/reviews/public`)
      .then((r) => (r.ok ? r.json() : { reviews: [] }))
      .then((d) => setTestimonials(d.reviews || []))
      .catch(() => {})
  }, [])

  // Rendered at both "/" and "/about" for logged-out visitors — canonicalize
  // to "/" so search engines don't treat them as duplicate pages.
  useSeo({
    title: 'Volunteer Hour Tracker for Students & Schools',
    description: 'VolunTrack is a calm volunteer hour tracker. Log hours, set goals, earn badges, and generate reports for school or community service.',
    canonicalPath: '/',
  })

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  // Re-runs when testimonials load in, since that section is only mounted
  // (and only then has a `[data-animate]` element for this observer to find)
  // once the async fetch above resolves with at least one approved review.
  useEffect(() => {
    const els = document.querySelectorAll('[data-animate]')
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('animate-visible')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.08 }
    )
    els.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [testimonials])

  return (
    <div className="min-h-screen relative overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(168,85,247,0.22),transparent_28%),radial-gradient(circle_at_top_right,rgba(34,197,94,0.18),transparent_20%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.2),transparent_22%),linear-gradient(180deg,#071017_0%,#0a1d25_40%,#0f1f15_100%)] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(255,255,255,0.08),transparent_14%),radial-gradient(circle_at_80%_20%,rgba(59,130,246,0.18),transparent_18%),radial-gradient(circle_at_50%_80%,rgba(168,85,247,0.14),transparent_16%)]" />
      <div className="relative px-4 md:px-8 py-5">
        <header className="relative flex items-center justify-between gap-3 animate-fade-in-up">
          <Link to="/login" className="flex items-center gap-3">
            <img src={`${import.meta.env.BASE_URL}logo-icon.webp`} alt="VolunTrack" className="w-11 h-11 object-contain" />
            <div>
              <p className="text-sm uppercase tracking-[0.35em] text-earth-500 dark:text-earth-400">VolunTrack</p>
              <p className="font-display font-bold text-lg text-earth-900 dark:text-earth-100">Volunteer hour tracking</p>
            </div>
          </Link>

          <div className="hidden md:flex items-center gap-3">
            <Link to="/about" className="btn-ghost">About</Link>
            <Link to="/contact" className="btn-ghost">Contact</Link>
            <Link to="/status" className="btn-ghost">Status</Link>
            <Link to="/login" className="btn-ghost">Sign in</Link>
            <Link to="/register" className="btn-primary">Get started</Link>
          </div>

          <button
            onClick={() => setNavOpen((v) => !v)}
            className="md:hidden btn-ghost p-2"
            aria-label={navOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={navOpen}
          >
            {navOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>

          {navOpen && (
            <div className="md:hidden absolute top-full right-0 mt-2 w-56 rounded-xl border border-white/10 bg-[#0a1a14] shadow-xl z-50 flex flex-col p-2 gap-1">
              <Link to="/about" className="btn-ghost w-full justify-start" onClick={() => setNavOpen(false)}>About</Link>
              <Link to="/contact" className="btn-ghost w-full justify-start" onClick={() => setNavOpen(false)}>Contact</Link>
              <Link to="/status" className="btn-ghost w-full justify-start" onClick={() => setNavOpen(false)}>Status</Link>
              <Link to="/login" className="btn-ghost w-full justify-start" onClick={() => setNavOpen(false)}>Sign in</Link>
              <Link to="/register" className="btn-primary w-full justify-center" onClick={() => setNavOpen(false)}>Get started</Link>
            </div>
          )}
        </header>

        <main className="max-w-[1400px] mx-auto px-4 md:px-8 pb-20">

          <section data-animate className="mt-16 md:mt-24 text-center max-w-4xl mx-auto">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand-700/30 bg-brand-900/20 px-4 py-1.5 text-xs font-medium text-brand-300 mb-6">
              <Zap className="w-3.5 h-3.5 animate-float" /> Free for students — no credit card needed
            </div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-white leading-tight">
              Track your volunteer hours, earn rewards, and showcase your impact.
            </h1>
            <p className="mt-5 text-lg md:text-xl text-earth-300 max-w-2xl mx-auto leading-8">
              VolunTrack gives students and organizations a clean, private way to log service work, measure progress toward goals, and export polished records for school, scholarship, or club requirements.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
              <Link to="/register" className="btn-primary inline-flex items-center gap-2 justify-center px-8 py-3.5 rounded-xl text-base font-semibold">
                Create your free account <ArrowRight className="w-4 h-4" />
              </Link>
              <Link to="/login" className="btn-secondary inline-flex justify-center px-8 py-3.5 rounded-xl text-base font-semibold">
                Sign in
              </Link>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-5 text-sm text-earth-400">
              <span className="flex items-center gap-1.5"><CheckCircle className="w-4 h-4 text-brand-400" /> No credit card</span>
              <span className="flex items-center gap-1.5"><CheckCircle className="w-4 h-4 text-brand-400" /> Private by design</span>
              <span className="flex items-center gap-1.5"><CheckCircle className="w-4 h-4 text-brand-400" /> Export anytime</span>
            </div>
          </section>

          <section data-animate className="mt-16 text-center">
            <p className="text-sm uppercase tracking-[0.35em] text-brand-600">How it works</p>
            <h2 className="mt-3 text-3xl font-bold text-earth-950 dark:text-white">Get started in four simple steps.</h2>
            <p className="mt-3 text-earth-400 max-w-xl mx-auto">
              From signing up to exporting your first report — VolunTrack makes volunteer tracking effortless.
            </p>
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map(({ icon: Icon, title, body }, i) => (
                <div key={title} className="relative" style={{ animationDelay: `${i * 120}ms` }}>
                  <div className="w-14 h-14 rounded-full bg-brand-900/30 border border-brand-700/30 grid place-items-center text-brand-300 mx-auto mb-4 text-lg font-bold">
                    {i + 1}
                  </div>
                  <div className="w-11 h-11 rounded-3xl bg-brand-900/30 border border-brand-700/30 grid place-items-center text-brand-300 mx-auto mb-4">
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="font-semibold mb-2 text-white text-center">{title}</div>
                  <div className="text-sm leading-6 text-slate-300 text-center max-w-xs mx-auto">{body}</div>
                </div>
              ))}
            </div>
          </section>

          <section data-animate className="mt-20">
            <div className="text-center">
              <p className="text-sm uppercase tracking-[0.35em] text-brand-600">Categories</p>
              <h2 className="mt-3 text-3xl font-bold text-earth-950 dark:text-white">Track every type of service.</h2>
              <p className="mt-3 text-earth-400 max-w-xl mx-auto">
                VolunTrack supports a wide range of volunteer categories so you can log whatever service you do.
              </p>
            </div>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              {CATEGORIES.map(({ icon: Icon, label, color }, i) => (
                <span key={label} className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium ${color}`} style={{ animationDelay: `${i * 60}ms` }}>
                  <Icon className="w-4 h-4" />
                  {label}
                </span>
              ))}
            </div>
          </section>

          <section data-animate className="mt-20">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.35em] text-brand-600">Core features</p>
                <h2 className="mt-3 text-3xl font-bold text-earth-950 dark:text-white">Everything you need to manage service hours and showcase impact.</h2>
              </div>
              <div className="flex flex-wrap gap-3">
                <span className="inline-flex items-center gap-2 rounded-full bg-brand-100 px-4 py-2 text-sm font-semibold text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"><ShieldCheck className="w-4 h-4" /> Private & stores in your local storage</span>
                <span className="inline-flex items-center gap-2 rounded-full bg-earth-100 px-4 py-2 text-sm font-semibold text-earth-700 dark:bg-white/5 dark:text-earth-300"><Users className="w-4 h-4" /> Volunteer Task Maker — post opportunities</span>
              </div>
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map(({ icon: Icon, title, body }, i) => (
                <Card key={title} className="border border-white/10 bg-slate-900/70 text-white" style={{ animationDelay: `${i * 100}ms` }}>
                  <div className="w-11 h-11 rounded-3xl bg-brand-100 grid place-items-center text-brand-700 mb-4">
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="font-semibold mb-2 text-white">{title}</div>
                  <div className="text-sm leading-6 text-slate-300">{body}</div>
                </Card>
              ))}
            </div>
          </section>

          <section data-animate className="mt-20">
            <div className="text-center">
              <p className="text-sm uppercase tracking-[0.35em] text-brand-600">Everything included</p>
              <h2 className="mt-3 text-3xl font-bold text-earth-950 dark:text-white">A deeper look at what you get.</h2>
              <p className="mt-3 text-earth-400 max-w-xl mx-auto">
                VolunTrack is packed with tools designed to make service tracking simple, motivating, and professional.
              </p>
            </div>
            <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {DETAILED_FEATURES.map(({ icon: Icon, title, body }, i) => (
                <Card key={title} className="border border-white/10 bg-slate-900/70 text-white p-6" style={{ animationDelay: `${i * 80}ms` }}>
                  <div className="w-10 h-10 rounded-xl bg-brand-900/40 border border-brand-700/30 grid place-items-center text-brand-300 mb-4">
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="font-semibold mb-2 text-white">{title}</div>
                  <div className="text-sm leading-6 text-slate-300">{body}</div>
                </Card>
              ))}
            </div>
          </section>

          <section data-animate className="mt-20">
            <div className="text-center">
              <p className="text-sm uppercase tracking-[0.35em] text-brand-600">Who it&rsquo;s for</p>
              <h2 className="mt-3 text-3xl font-bold text-earth-950 dark:text-white">Built for everyone who serves.</h2>
              <p className="mt-3 text-earth-400 max-w-xl mx-auto">
                Whether you&rsquo;re a student tracking NHS hours or a nonprofit coordinating volunteers, VolunTrack adapts to your needs.
              </p>
            </div>
            <div className="mt-10 grid gap-6 md:grid-cols-2">
              {AUDIENCES.map(({ icon: Icon, title, body, perks }, i) => (
                <Card key={title} className="border border-white/10 bg-slate-900/70 text-white p-6" style={{ animationDelay: `${i * 100}ms` }}>
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-brand-900/40 border border-brand-700/30 grid place-items-center text-brand-300 shrink-0">
                      <Icon className="w-6 h-6" />
                    </div>
                    <div className="flex-1">
                      <div className="font-semibold text-white text-lg">{title}</div>
                      <p className="mt-2 text-sm leading-6 text-slate-300">{body}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {perks.map((p) => (
                          <span key={p} className="inline-flex items-center gap-1 rounded-full bg-white/5 px-3 py-1 text-xs text-earth-300">
                            <CheckCircle className="w-3 h-3 text-brand-400" /> {p}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </section>

          {testimonials.length > 0 && (
            <section data-animate className="mt-20">
              <div className="text-center">
                <p className="text-sm uppercase tracking-[0.35em] text-brand-600">Testimonials</p>
                <h2 className="mt-3 text-3xl font-bold text-earth-950 dark:text-white">What people are saying.</h2>
              </div>
              <div className="mt-10 grid gap-6 md:grid-cols-3">
                {testimonials.map(({ id, rating, comment, name, role }, i) => (
                  <Card key={id} className="border border-white/10 bg-slate-900/70 text-white p-6" style={{ animationDelay: `${i * 100}ms` }}>
                    <div className="flex gap-1 mb-4">
                      {[...Array(5)].map((_, j) => (
                        <Star key={j} className={`w-4 h-4 ${j < rating ? 'fill-brand-400 text-brand-400' : 'text-earth-700'}`} />
                      ))}
                    </div>
                    <p className="text-sm leading-7 text-slate-300 italic">&ldquo;{comment}&rdquo;</p>
                    <div className="mt-6 pt-4 border-t border-white/10">
                      <div className="font-semibold text-sm text-white">{name || `VolunTrack ${roleLabel(role)}`}</div>
                      {name && <div className="text-xs text-earth-400">{roleLabel(role)}</div>}
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          )}


          <section data-animate className="mt-20">
            <div className="text-center">
              <p className="text-sm uppercase tracking-[0.35em] text-brand-600">FAQ</p>
              <h2 className="mt-3 text-3xl font-bold text-earth-950 dark:text-white">Frequently asked questions.</h2>
            </div>
            <div className="mt-8 max-w-2xl mx-auto">
              <Card className="border border-white/10 bg-slate-900/70 text-white p-6 md:p-8">
                {FAQS.map((faq) => (
                  <FaqItem key={faq.q} q={faq.q} a={faq.a} />
                ))}
              </Card>
            </div>
          </section>

          <section data-animate className="mt-20 rounded-[2rem] bg-gradient-to-br from-brand-600 to-brand-700 p-10 md:p-16 text-center">
            <Sparkles className="w-10 h-10 text-brand-200 mx-auto animate-float" />
            <h2 className="mt-4 text-3xl md:text-4xl font-bold text-white">Ready to start tracking your impact?</h2>
            <p className="mt-3 text-brand-100 max-w-lg mx-auto leading-7">
              Join thousands of students and organizations already using VolunTrack. It&rsquo;s free to get started.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
              <Link to="/register" className="btn-secondary inline-flex items-center gap-2 justify-center bg-white text-brand-700 hover:bg-white/90 px-8 py-3 rounded-xl font-semibold">
                Create your free account <ArrowRight className="w-4 h-4" />
              </Link>
              <Link to="/contact" className="inline-flex items-center gap-2 justify-center border border-white/30 text-white hover:bg-white/10 px-8 py-3 rounded-xl font-semibold transition-colors">
                Talk to us
              </Link>
            </div>
          </section>

          <section data-animate className="mt-16 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <Card className="p-8">
              <h3 className="text-2xl font-semibold text-earth-950 dark:text-white">Built for fast volunteering workflows</h3>
              <p className="mt-4 text-earth-700 dark:text-earth-300 leading-7">
                From your first log to your first service certificate, VolunTrack keeps the experience smooth and distraction-free. It helps learners, clubs, and service coordinators keep reliable records without complicated setup.
              </p>
              <ul className="mt-6 space-y-3 text-sm text-earth-700 dark:text-earth-300">
                <li className="flex items-start gap-3"><CheckCircle className="w-5 h-5 text-brand-500 shrink-0 mt-0.5" /> Save each session with location, category, and supervisor details</li>
                <li className="flex items-start gap-3"><CheckCircle className="w-5 h-5 text-brand-500 shrink-0 mt-0.5" /> Watch your month and goal progress in one dashboard</li>
                <li className="flex items-start gap-3"><CheckCircle className="w-5 h-5 text-brand-500 shrink-0 mt-0.5" /> Export proofs instantly for school or community review</li>
              </ul>
            </Card>
            <Card className="p-8 bg-gradient-to-br from-brand-600 to-brand-700 text-white">
              <div className="space-y-4">
                <div className="text-sm uppercase tracking-[0.35em] text-brand-200">Your path to launch</div>
                <div className="text-3xl font-bold">Phase-driven product growth</div>
                <p className="leading-7 text-brand-100">
                  The first version is live and focused on deployment. Next, we deliver certificates and premium upgrades. Then, we partner with schools and clubs to make VolunTrack a paid service.
                </p>
                <Link to="/register" className="btn-secondary inline-flex items-center gap-2 bg-white text-brand-700 hover:bg-white/90">Join now</Link>
              </div>
            </Card>
          </section>
        </main>

        <footer data-animate className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-8 text-sm text-earth-500 dark:text-earth-400">
          <span>&copy; VolunTrack 2026</span>
          <div className="flex items-center gap-4">
            <Link to="/about" className="hover:text-white">About</Link>
            <Link to="/contact" className="hover:text-white">Contact</Link>
            <Link to="/status" className="hover:text-white">Status</Link>
            <Link to="/help" className="hover:text-white">Help</Link>
            <a
              href="https://www.instagram.com/volunteertrackofficial/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-white"
              aria-label="Instagram"
            >
              <Instagram className="w-4 h-4" />
              @volunteertrackofficial
            </a>
          </div>
        </footer>
      </div>
    </div>
  )
}
