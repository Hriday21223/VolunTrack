import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import Card from '@/components/Card.jsx'
import Footer from '@/components/Footer.jsx'
import PublicHeader from '@/components/PublicHeader.jsx'
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
      <PublicHeader>
        <Link to="/privacy" className="btn-ghost hidden sm:inline-flex">Privacy</Link>
        <Link to="/login" className="btn-ghost"><ArrowLeft className="w-4 h-4" /> Back to sign in</Link>
      </PublicHeader>

      <main className="max-w-3xl mx-auto px-4 md:px-8 pb-20">
        <h1 className="text-3xl md:text-4xl font-bold text-center">Terms of Service</h1>
        <p className="text-center text-earth-500 dark:text-earth-400 mt-2 text-sm">Last updated: October 23, 2026</p>

        <Card className="mt-10 space-y-6 text-sm text-earth-700 dark:text-earth-200">
          <Section title="Acceptance of Terms">
            <p>By creating an account or using VolunTrack, you agree to these Terms of Service and our{' '}
              <Link to="/privacy" className="text-brand-700 dark:text-brand-300 hover:underline font-medium">Privacy Policy</Link>. If you do not agree, please do not use the app.
            </p>
          </Section>

          <Section title="The Service">
            <p>VolunTrack is a tool for logging volunteer hours, tracking goals and achievements, and — for schools and organizations — reviewing and verifying submitted hours. It is free for students, volunteers, and parents; schools and organizations pay for their accounts, as described under <em>Fees and Payment</em>. It's provided "as is," and we make no guarantee it will be available, error-free, or uninterrupted.</p>
          </Section>

          <Section title="Your Account">
            <p>You're responsible for the accuracy of the information you provide and for keeping your login credentials confidential. If your school has set up single sign-on, you sign in with your school account instead of a VolunTrack password, and your school, not VolunTrack, controls that sign-in. You must be old enough to use this app under the laws of your location, or have permission from a parent, guardian, or supervising school/organization. If you are under 13, you must have parental, guardian, or school/teacher consent to create an account: when you sign up yourself, a parent or guardian approves it by email first. Volunteer Task Maker and parent accounts are for adults 18 and over. The date of birth you enter at sign-up must be your own.</p>
          </Section>

          <Section title="Accurate Logging">
            <p>Volunteer hours, activities, and proof you submit must be truthful and your own. Schools and organizations reviewing submitted hours rely on this accuracy for verification decisions. A signature on an entry must be drawn by the person it belongs to: never sign for a supervisor, task organizer, or anyone else. Supervisors and organizers who sign are confirming that the work happened as described. Submitting false or misleading logs, or signatures, may result in account suspension.</p>
          </Section>

          <Section title="School and Organization Accounts">
            <p>Schools and organizations may access student-submitted logs, proof uploads, and hour totals for the purpose of review and verification. Parents may link to a student account, in read-only form, with the student's consent via a link code.</p>
            <p className="mt-2">A school or organization may set its own rules for how its students log hours — for example, required fields, signatures or its own forms, or allowed sign-in methods — and may connect its own file storage, in which case files uploaded there are held and governed by that school. A student can move to another school; their record transfers only once the receiving school accepts.</p>
          </Section>

          <Section title="Fees and Payment">
            <p>Student, volunteer, and parent accounts are free. School and organization accounts are paid: we send an invoice by email showing the amount, the billing period, and the due date, along with how to pay. Until a school&apos;s payment is verified, its students&apos; submissions and its management tools may be paused.</p>
            <p className="mt-2">We may offer discounts, such as a promotional code or a referral credit for recommending VolunTrack to another school. An offer applies only on the terms stated when it is made, may be limited in number or time, and cannot be combined with another offer on the same invoice or exchanged for cash. The price and any discount on an invoice are fixed once that invoice is sent. Questions about an invoice go to the contact address below.</p>
          </Section>

          <Section title="Intellectual Property">
            <p>VolunTrack, including its source code, design, branding, name, and logo, is owned by Hriday Karnatam and protected by copyright and other laws. All rights are reserved. You are granted a limited, personal, non-transferable right to use the app as offered. You may not copy, modify, reverse engineer, redistribute, host, resell, or create derivative works from any part of the app or its code without prior written permission.</p>
          </Section>

          <Section title="Acceptable Use">
            <p>Don't use VolunTrack to upload harmful content, attempt to access accounts or data that aren't yours, interfere with the service's operation, or use it for anything unlawful.</p>
            <p className="mt-2">Volunteer tasks are seen by students, many of them minors. A task must be a real volunteer opportunity, described honestly, and safe and appropriate for young people. Anyone can report a task or block its organizer; we review reports within 24 hours and may remove a task or stop an organizer from posting.</p>
          </Section>

          <Section title="Posting Volunteer Tasks">
            <p>If you post a task, you are its organizer and are responsible for it: the task must happen as described, and the details you give must be accurate and kept up to date — including the date, place or whether it&apos;s online, any minimum age, wheelchair access and accessibility notes, whether guests may come, the meeting point and the day-of contact. Volunteers and their parents rely on these to decide whether to take part. VolunTrack does not organize, supervise or inspect tasks; keeping volunteers safe on the day is the organizer&apos;s job.</p>
            <p className="mt-2">You may add up to three co-hosts. Add only people you trust to help run the task: they can see its volunteers&apos; names, contact details and attendance and can sign off hours, and you remain responsible for the task. A day-of contact must be someone who has agreed to be listed. A cover photo must be one you have the right to use, and must not show volunteers — especially children — in a way that identifies them without their permission. Answers to questions, messages and thank-you notes you send must be appropriate for young people.</p>
          </Section>

          <Section title="Taking Part in Volunteer Tasks">
            <p>When you sign up for a task, give truthful answers: if it has a minimum age, confirm only if you meet it. If you bring guests, you are responsible for them — they must meet the task&apos;s age requirement and follow the organizer&apos;s instructions, and their hours are not recorded in VolunTrack. If you can&apos;t make it, cancel or tell the organizer through the app so your spot can go to someone else. Ratings and questions must be honest and respectful, and invite only people you know. Taking part in a task is your own decision (or, for a minor, your parent or guardian&apos;s), made with the information the organizer provides.</p>
          </Section>

          <Section title="Content You Post">
            <p>You keep ownership of what you add to VolunTrack — for example entries, task descriptions and photos, questions and answers, ratings, profiles and thank-you notes. You give us permission to store it and show it to the people the app shows it to, only to run the service. We may remove content that breaks these terms, such as after a report.</p>
          </Section>

          <Section title="Emails and Notifications">
            <p>We send emails and in-app notifications needed to use VolunTrack, such as sign-in codes, sign-up decisions, reminders about tasks you joined, and messages from your task&apos;s organizer. Optional ones — such as reminders you set, the parent weekly summary and &ldquo;We miss you&rdquo; emails — can be turned off in Settings or from the link in the email.</p>
          </Section>

          <Section title="Account Termination">
            <p>You may delete your account at any time from Settings, which erases it from your device and from our servers — see <Link to="/privacy" className="text-brand-700 dark:text-brand-300 hover:underline font-medium">Privacy</Link> for the few things that are kept afterwards. School and organization accounts are closed by contacting us instead, so that student records are transferred or removed properly. We may suspend or terminate accounts that violate these terms, including for submitting fraudulent hour logs.</p>
          </Section>

          <Section title="Limitation of Liability">
            <p>VolunTrack is provided "as is" and without warranty. To the extent permitted by law, we're not liable for any damages arising from your use of the app, including reliance on hour totals or verification status for school or program requirements. Information shown with a task — such as its details, an organizer&apos;s rating or the weather forecast — is provided for convenience and may be wrong or out of date; check with the organizer and the conditions on the day. We are not responsible for what happens at a volunteer task, which is run by its organizer.</p>
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
