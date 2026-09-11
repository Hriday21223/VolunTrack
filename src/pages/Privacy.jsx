import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import Card from '@/components/Card.jsx'
import Footer from '@/components/Footer.jsx'
import { useSeo } from '@/hooks/useSeo.js'

export default function Privacy() {
  useSeo({
    title: 'Privacy Policy',
    description: 'How VolunTrack collects, uses, and protects your data.',
    path: '/privacy',
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
          <Link to="/terms" className="btn-ghost hidden sm:inline-flex">Terms</Link>
          <Link to="/login" className="btn-ghost"><ArrowLeft className="w-4 h-4" /> Back to sign in</Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 md:px-8 pb-20">
        <h1 className="text-3xl md:text-4xl font-bold text-center">Privacy Policy</h1>
        <p className="text-center text-earth-500 dark:text-earth-400 mt-2 text-sm">Last updated: September 11, 2026</p>

        <Card className="mt-10 space-y-6 text-sm text-earth-700 dark:text-earth-200">
          <Section title="Data We Collect">
            <ul className="list-disc pl-5 space-y-1.5">
              <li><strong>Name and email address</strong> — required to create and manage your account.</li>
              <li><strong>Volunteer hours, activity descriptions, and locations</strong> — the core data you log in the app.</li>
              <li><strong>Verification details</strong> — when you ask someone to verify an entry, the supervisor&apos;s name and email, the organization&apos;s name, address and phone, and the signature the supervisor draws when they approve.</li>
              <li><strong>Proof of service</strong> — photos or documents you attach to an entry. See <em>Proof files</em> below for where these are held.</li>
              <li><strong>Access records</strong> — when a school or organization staff member opens a student&apos;s record, we record who did it and when, along with the IP address and browser, so that access to a minor&apos;s record can be accounted for.</li>
              <li><strong>Approximate location</strong> — used only when you log hours, to auto-fill the location field. You can always edit or clear it.</li>
              <li><strong>Camera access</strong> — used only for scanning QR codes when syncing your account across devices. No images are ever uploaded or stored.</li>
            </ul>
          </Section>

          <Section title="How We Use Your Data">
            <p>Your data is used exclusively to provide the VolunTrack service: tracking volunteer hours, generating reports, and managing school/organization participation.</p>
          </Section>

          <Section title="Data Storage">
            <p>Without an account, VolunTrack runs entirely in your browser: your hours stay in that browser&apos;s local storage and never reach us.</p>
            <p className="mt-2">When you create an account, your name, email address and a hashed version of your password are stored in our PostgreSQL database. From then on the hours you log are also saved to our servers as you enter them — this is what lets your school, a linked parent, and your other devices see them. That happens as soon as you are signed in; it is not limited to schools that have set up their own storage. Your browser keeps its own copy as well. Traffic between the app and our servers is encrypted with HTTPS.</p>
          </Section>

          <Section title="Proof Files">
            <p>Where your school or organization has connected its own storage, proof photos and documents upload straight from your device to <em>their</em> storage, and we keep only a reference to the file — we never hold the file itself. Those files are then controlled by that school, under their own policies, and we cannot delete them for you.</p>
            <p className="mt-2">Where no such storage is connected, a proof file you attach stays on your device, and a report you submit to your school is stored by us until it is deleted.</p>
          </Section>

          <Section title="Analytics">
            <p>We use privacy-friendly, anonymous page-view analytics (Vercel Analytics) to understand overall usage. It does not use cookies and does not track you individually across sites.</p>
          </Section>

          <Section title="Data Retention">
            <p>We keep your data for as long as your account exists.</p>
            <p className="mt-2">Some things outlive an account on purpose, or are beyond our reach:</p>
            <ul className="list-disc pl-5 space-y-1.5 mt-2">
              <li><strong>Access records</strong> are kept for up to 400 days, so that access to student records stays accountable after the fact. The account holder&apos;s identity is removed from them when an account is erased.</li>
              <li><strong>Proof files in a school&apos;s own storage</strong> belong to that school. Ask them to delete those.</li>
              <li><strong>Transcripts you have exported</strong> are files you chose to hand to someone. We cannot withdraw a copy someone else holds.</li>
            </ul>
          </Section>

          <Section title="Account Deletion">
            <p>You can delete your account from the Settings page in the app. You will be prompted to confirm by typing &quot;delete&quot; before the action completes.</p>
            <p className="mt-2"><strong>This clears VolunTrack data from the device you are using.</strong> Erasing the copy held on our servers is not yet automatic: email us at the address below and we will delete it, subject to the exceptions under <em>Data Retention</em>. We are working on making this happen automatically.</p>
          </Section>

          <Section title="Third-Party Sharing">
            <p>We do not sell or trade your personal data. We share it only with the schools, organizations, or linked parent accounts you explicitly connect to (for example, via a school code or family link code), and only for the purpose of hour tracking and verification.</p>
          </Section>

          <Section title="Service Providers">
            <p>We use trusted cloud infrastructure providers — for database hosting, backend hosting, email delivery, and analytics — strictly to run the service. They process your data on our behalf and do not use it for their own purposes.</p>
          </Section>

          <Section title="Children's Privacy">
            <p>VolunTrack is used by students and volunteers of all ages. We only collect information that is necessary for the service. If you are under 13, you must have parental, guardian, or school/teacher consent to create an account. If you believe a child has provided more information than necessary, please contact us.</p>
          </Section>

          <Section title="Changes to This Policy">
            <p>We may update this policy from time to time. Changes will be posted here with an updated date.</p>
          </Section>

          <Section title="Contact">
            <p>If you have questions about this policy, or want the data held on our servers deleted, please contact us at{' '}
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
