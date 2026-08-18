import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { useSeo } from '@/hooks/useSeo.js'

export default function Privacy() {
  useSeo({
    title: 'Privacy Policy',
    description: 'How VolunTrack collects, uses, and protects your data.',
    path: '/privacy',
  })

  useEffect(() => { window.scrollTo(0, 0) }, [])

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-earth-50 to-earth-100 dark:from-[#0f1813] dark:via-[#0f1813] dark:to-[#14201a]">
      <header className="px-4 md:px-8 py-5 flex items-center justify-between">
        <Link to="/login" className="flex items-center gap-2.5">
          <img src={`${import.meta.env.BASE_URL}logo-icon.webp`} alt="VolunTrack" className="w-9 h-9 object-contain" />
          <span className="font-display font-bold text-lg">VolunTrack</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link to="/terms" className="btn-ghost hidden sm:inline-flex">Terms</Link>
          <Link to="/login" className="btn-ghost"><ArrowLeft className="w-4 h-4" /> Back to sign in</Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 md:px-8 pb-20">
        <h1 className="text-3xl md:text-4xl font-bold text-center">Privacy Policy</h1>
        <p className="text-center text-earth-500 dark:text-earth-400 mt-2 text-sm">Last updated: July 7, 2026</p>

        <Card className="mt-10 space-y-6 text-sm text-earth-700 dark:text-earth-200">
          <Section title="Data We Collect">
            <ul className="list-disc pl-5 space-y-1.5">
              <li><strong>Name and email address</strong> — required to create and manage your account.</li>
              <li><strong>Volunteer hours, activity descriptions, and locations</strong> — the core data you log in the app.</li>
              <li><strong>Approximate location</strong> — used only when you log hours, to auto-fill the location field. You can always edit or clear it.</li>
              <li><strong>Camera access</strong> — used only for scanning QR codes when syncing your account across devices. No images are ever uploaded or stored.</li>
            </ul>
          </Section>

          <Section title="How We Use Your Data">
            <p>Your data is used exclusively to provide the VolunTrack service: tracking volunteer hours, generating reports, and managing school/organization participation.</p>
          </Section>

          <Section title="Data Storage">
            <p>Data is stored in a PostgreSQL database and, for offline/demo mode, in your browser's local storage. Communications with the server are encrypted via HTTPS.</p>
          </Section>

          <Section title="Analytics">
            <p>We use privacy-friendly, anonymous page-view analytics (Vercel Analytics) to understand overall usage. It does not use cookies and does not track you individually across sites.</p>
          </Section>

          <Section title="Data Retention">
            <p>We retain your data until you delete your account. When you delete your account, all associated data — including volunteer logs, goals, achievements, and uploaded PDFs — is permanently removed.</p>
          </Section>

          <Section title="Account Deletion">
            <p>You can delete your account and all associated data at any time from the Settings page in the app. You will be prompted to confirm by typing "delete" before the action completes.</p>
          </Section>

          <Section title="Third-Party Sharing">
            <p>We do not sell, trade, or share your personal data with third parties.</p>
          </Section>

          <Section title="Children's Privacy">
            <p>VolunTrack is used by students and volunteers of all ages. We only collect information that is necessary for the service. If you believe a child has provided more information than necessary, please contact us.</p>
          </Section>

          <Section title="Changes to This Policy">
            <p>We may update this policy from time to time. Changes will be posted here with an updated date.</p>
          </Section>

          <Section title="Contact">
            <p>If you have questions about this policy, please contact us at{' '}
              <a href="mailto:volunteertrackinfo@gmail.com" className="text-brand-700 dark:text-brand-300 hover:underline font-medium">volunteertrackinfo@gmail.com</a>.
            </p>
          </Section>
        </Card>
      </main>
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
