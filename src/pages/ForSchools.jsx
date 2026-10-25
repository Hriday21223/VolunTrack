import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, CheckCircle2, QrCode, ClipboardCheck, FileSpreadsheet, GraduationCap, Users,
  ShieldCheck, Languages, Target, Mail, Printer,
} from 'lucide-react'
import Card from '@/components/Card.jsx'
import Footer from '@/components/Footer.jsx'
import PublicHeader from '@/components/PublicHeader.jsx'
import { useSeo } from '@/hooks/useSeo.js'

const SITE_URL = (import.meta.env.VITE_SITE_URL || 'http://localhost:5173').replace(/\/$/, '')
const CONTACT = '/contact?topic=school'
const START_CLUB = '/school/register'

// /for-schools (#491): the page an NHS, Key Club or service-club adviser lands
// on. What they get, how setup goes, and the questions they ask before saying
// yes. Prerendered (scripts/prerender.mjs) and in the sitemap.

const FEATURES = [
  { icon: ClipboardCheck, title: 'Approve hours in one place', text: 'Students log hours with the details you need. You approve or send back each entry, and they see the result straight away.' },
  { icon: Target, title: 'Hour requirements and goals', text: 'Set the hours your club or school requires. Students see how close they are, and you see who is behind.' },
  { icon: QrCode, title: 'QR check-in at events', text: 'Put a code on screen at your event. Students scan in and out, and their hours fill in on their own.' },
  { icon: FileSpreadsheet, title: 'Reports when they are due', text: 'Download hours as CSV, print a graduation report for your seniors, and hand out a verified report students can share.' },
  { icon: GraduationCap, title: 'A new school year in one click', text: 'Move every student up a grade at the start of the year, with an undo if you change your mind.' },
  { icon: Users, title: 'Co-advisers and parents', text: 'Add co-advisers to share the approving. Parents can follow their child’s hours with their own account.' },
  { icon: ShieldCheck, title: 'Built for student privacy', text: 'Parent approval for students under 13, school sign-in (SSO) if you use it, and two-step sign-in for staff.' },
  { icon: Languages, title: 'English and Spanish', text: 'Students and families can use VolunTrack in Spanish, and the flyer and messages come in both languages.' },
]

const STEPS = [
  { title: 'Start a free club', text: 'Create your account in a couple of minutes: pick a password and a code for your students. No credit card and no code from us. For the whole school, ask us for a quote and a registration code instead.' },
  { title: 'Set your requirement', text: 'Enter the hours your club or school requires, if you have a number, so students can see how close they are.' },
  { title: 'Share your join link', text: 'Your dashboard has a starter kit: a join link, a QR code, a printable flyer and messages ready to paste into email or Google Classroom.' },
  { title: 'Approve hours as they come in', text: 'Students who use your link land on your roster. Their hours wait for you on the Students tab.' },
]

const FAQS = [
  { q: 'What does it cost?', a: 'VolunTrack is free for students, volunteers and parents. One club or class with up to 50 students is free too, with every feature. A whole school, or a club with more students, is paid: send us a message and we will reply with a quote. If another school referred you, you both get a discount.' },
  { q: 'Do students need to download an app?', a: 'No. VolunTrack works in any web browser on a phone or computer, so students can sign up the moment they scan your flyer.' },
  { q: 'Can one club use it, not the whole school?', a: 'Yes, and it is free for up to 50 students. Many schools start with one adviser — NHS, Key Club, a service club or a class. The club gets its own account, code and roster, and can move to a school plan later without losing anything.' },
  { q: 'How do students join?', a: 'They open your join link or scan the QR code on your flyer, then create an account or sign in. The code is filled in for them. Students can also type the school code in Settings.' },
  { q: 'What happens to student data?', a: 'Students’ hours belong to them and to your school. We never sell or trade personal data, and we share it only with the school or parent a student connects to. Read the privacy policy for the details schools and districts ask about.' },
  { q: 'How long does setup take?', a: 'About five minutes: create the account, set your requirement, and send the join link.' },
]

export default function ForSchools() {
  useSeo({
    title: 'Volunteer Hour Tracking for Schools and Clubs',
    description: 'Collect, approve and report student service hours in one place. Built for NHS, Key Club and service-club advisers: QR check-in, hour requirements, CSV and graduation reports.',
    path: '/for-schools',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      url: `${SITE_URL}/for-schools`,
      mainEntity: FAQS.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    },
  })
  useEffect(() => { window.scrollTo(0, 0) }, [])

  return (
    <div className="min-h-screen page-shell">
      <PublicHeader>
        <Link to="/login" className="btn-ghost">Sign in</Link>
        <Link to={START_CLUB} className="btn-primary hidden sm:inline-flex">Start free</Link>
      </PublicHeader>

      <main className="max-w-5xl mx-auto px-4 md:px-8 pb-20">
        <section className="text-center max-w-3xl mx-auto pt-4">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400">For advisers, coordinators and counselors</p>
          <h1 className="mt-3 text-3xl md:text-5xl font-bold leading-tight">Student volunteer hours, without the paper forms</h1>
          <p className="mt-4 text-lg text-earth-500 dark:text-earth-400">
            Students log their service hours on their phones. You approve them in one place, and the reports are ready when they are due. Set up for NHS, Key Club or your whole school in about five minutes.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3">
            <Link to={START_CLUB} className="btn-primary">Start a free club <ArrowRight className="w-4 h-4" /></Link>
            <Link to={CONTACT} className="btn-secondary">Get a quote for your school</Link>
          </div>
          <p className="mt-3 text-sm text-earth-500 dark:text-earth-400">Free for one club with up to 50 students. Always free for students and families.</p>
        </section>

        <section className="mt-16" aria-labelledby="features">
          <h2 id="features" className="text-2xl font-bold text-center">What you get</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <Card key={f.title}>
                <h3 className="font-semibold flex items-center gap-2"><f.icon className="w-5 h-5 text-brand-500 shrink-0" /> {f.title}</h3>
                <p className="mt-2 text-sm text-earth-500 dark:text-earth-400">{f.text}</p>
              </Card>
            ))}
          </div>
        </section>

        <section className="mt-16" aria-labelledby="setup">
          <h2 id="setup" className="text-2xl font-bold text-center">Set up in five minutes</h2>
          <ol className="mt-8 grid gap-4 md:grid-cols-2">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <Card className="h-full">
                  <div className="flex items-start gap-3">
                    <span className="w-8 h-8 rounded-full bg-brand-500 text-white grid place-items-center font-bold shrink-0">{i + 1}</span>
                    <div>
                      <h3 className="font-semibold">{s.title}</h3>
                      <p className="mt-1 text-sm text-earth-500 dark:text-earth-400">{s.text}</p>
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-16" aria-labelledby="kit">
          <Card>
            <h2 id="kit" className="text-xl font-bold">Your starter kit</h2>
            <p className="mt-2 text-sm text-earth-500 dark:text-earth-400">Every school account comes with what you need to get students signed up on day one:</p>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2 text-sm">
              {[
                [QrCode, 'A join link and QR code for your school'],
                [Printer, 'A printable flyer, in English or Spanish'],
                [Mail, 'An announcement ready for email or Google Classroom'],
                [CheckCircle2, 'A short message for Remind or a group chat'],
              ].map(([Icon, text]) => (
                <li key={text} className="flex items-center gap-2"><Icon className="w-4 h-4 text-brand-500 shrink-0" /> {text}</li>
              ))}
            </ul>
          </Card>
        </section>

        <section className="mt-16 max-w-3xl mx-auto" aria-labelledby="faq">
          <h2 id="faq" className="text-2xl font-bold text-center">Questions advisers ask</h2>
          <div className="mt-8 space-y-3">
            {FAQS.map((f) => (
              <details key={f.q} className="group rounded-xl border border-earth-200 dark:border-white/10 p-4">
                <summary className="cursor-pointer font-medium">{f.q}</summary>
                <p className="mt-2 text-sm text-earth-500 dark:text-earth-400">{f.a}</p>
              </details>
            ))}
          </div>
          <p className="mt-4 text-center text-sm">
            <Link to="/privacy" className="text-brand-600 dark:text-brand-400 hover:underline">Privacy policy</Link>
            {' · '}
            <Link to="/help" className="text-brand-600 dark:text-brand-400 hover:underline">Help for schools</Link>
          </p>
        </section>

        <Card className="mt-16 text-center">
          <h2 className="text-xl font-bold">Bring VolunTrack to your school</h2>
          <p className="mt-2 text-sm text-earth-500 dark:text-earth-400">Start free with one club today. For the whole school, tell us about it and we will send a quote and a registration code.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <Link to={START_CLUB} className="btn-primary">Start a free club <ArrowRight className="w-4 h-4" /></Link>
            <Link to={CONTACT} className="btn-secondary">Get a quote</Link>
            <Link to="/school/register?plan=school" className="btn-ghost">I have a code</Link>
          </div>
        </Card>
      </main>
      <Footer />
    </div>
  )
}
