import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import Card from '@/components/Card.jsx'
import Footer from '@/components/Footer.jsx'
import { useSeo } from '@/hooks/useSeo.js'

export default function Terms() {
  useSeo({
    title: 'Terms of Service',
    description: 'The terms that govern your use of VolunTrack.',
    path: '/terms',
  })

  useEffect(() => { window.scrollTo(0, 0) }, [])

  return (
    <div className="min-h-screen page-shell">
      <header className="px-4 md:px-8 py-5 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5">
          <img src={`${import.meta.env.BASE_URL}logo-icon.webp`} alt="VolunTrack" className="w-9 h-9 object-contain" />
          <span className="font-display font-bold text-lg">VolunTrack</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link to="/privacy" className="btn-ghost hidden sm:inline-flex">Privacy</Link>
          <Link to="/login" className="btn-ghost"><ArrowLeft className="w-4 h-4" /> Back to sign in</Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 md:px-8 pb-20">
        <h1 className="text-3xl md:text-4xl font-bold text-center">Terms of Service</h1>
        <p className="text-center text-earth-500 dark:text-earth-400 mt-2 text-sm">Last updated: August 18, 2026</p>

        <Card className="mt-10 space-y-6 text-sm text-earth-700 dark:text-earth-200">
          <Section title="Acceptance of Terms">
            <p>By creating an account or using VolunTrack, you agree to these Terms of Service and our{' '}
              <Link to="/privacy" className="text-brand-700 dark:text-brand-300 hover:underline font-medium">Privacy Policy</Link>. If you do not agree, please do not use the app.
            </p>
          </Section>

          <Section title="The Service">
            <p>VolunTrack is a free tool for logging volunteer hours, tracking goals and achievements, and — for schools and organizations — reviewing and verifying submitted hours. It's provided "as is," and we make no guarantee it will be available, error-free, or uninterrupted.</p>
          </Section>

          <Section title="Your Account">
            <p>You're responsible for the accuracy of the information you provide and for keeping your login credentials confidential. You must be old enough to use this app under the laws of your location, or have permission from a parent, guardian, or supervising school/organization. If you are under 13, you must have parental, guardian, or school/teacher consent to create an account.</p>
          </Section>

          <Section title="Accurate Logging">
            <p>Volunteer hours, activities, and proof you submit must be truthful and your own. Schools and organizations reviewing submitted hours rely on this accuracy for verification decisions. Submitting false or misleading logs may result in account suspension.</p>
          </Section>

          <Section title="School and Organization Accounts">
            <p>Schools and organizations may access student-submitted logs, proof uploads, and hour totals for the purpose of review and verification. Parents may link to a student account, in read-only form, with the student's consent via a link code.</p>
          </Section>

          <Section title="Intellectual Property">
            <p>VolunTrack, including its source code, design, branding, name, and logo, is owned by Hriday Karnatam and protected by copyright and other laws. All rights are reserved. You are granted a limited, personal, non-transferable right to use the app as offered. You may not copy, modify, reverse engineer, redistribute, host, resell, or create derivative works from any part of the app or its code without prior written permission.</p>
          </Section>

          <Section title="Acceptable Use">
            <p>Don't use VolunTrack to upload harmful content, attempt to access accounts or data that aren't yours, interfere with the service's operation, or use it for anything unlawful.</p>
          </Section>

          <Section title="Account Termination">
            <p>You may delete your account at any time from Settings. We may suspend or terminate accounts that violate these terms, including for submitting fraudulent hour logs.</p>
          </Section>

          <Section title="Limitation of Liability">
            <p>VolunTrack is provided free of charge and without warranty. To the extent permitted by law, we're not liable for any damages arising from your use of the app, including reliance on hour totals or verification status for school or program requirements.</p>
          </Section>

          <Section title="Changes to These Terms">
            <p>We may update these terms from time to time. Changes will be posted here with an updated date. Continued use of the app after changes means you accept the updated terms.</p>
          </Section>

          <Section title="Contact">
            <p>Questions about these terms? Reach us at{' '}
              <a href="mailto:volunteertrackinfo@gmail.com" className="text-brand-700 dark:text-brand-300 hover:underline font-medium">volunteertrackinfo@gmail.com</a>.
            </p>
          </Section>
        </Card>
      </main>

      <Footer />
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <h2 className="font-display font-semibold text-base mb-1.5">{title}</h2>
      {children}
    </div>
  )
}
