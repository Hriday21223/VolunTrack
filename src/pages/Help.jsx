import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, School, Globe, Clock, Calendar, Trophy, FileText, User, Settings, MapPin, Users, CheckCircle, HelpCircle, ArrowRight, Mail, Shield, ClipboardList, Phone, XCircle, Hand, ChevronDown, ShieldCheck, Zap } from 'lucide-react'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import { useSeo } from '@/hooks/useSeo.js'

const TABS = [
  { id: 'quickstart', label: 'Quick Start', icon: Zap },
  { id: 'student', label: 'Student', icon: BookOpen },
  { id: 'volunteer', label: 'Volunteer', icon: Hand },
  { id: 'school', label: 'School', icon: School },
  { id: 'faq', label: 'FAQ', icon: HelpCircle },
]

function Section({ title, children }) {
  return (
    <div className="mb-6">
      <h3 className="text-lg font-semibold text-white mb-3">{title}</h3>
      <div className="space-y-2 text-sm text-earth-300 leading-relaxed">{children}</div>
    </div>
  )
}

function Step({ icon: Icon, label, description }) {
  return (
    <div className="flex gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="w-8 h-8 rounded-lg bg-brand-500/10 grid place-items-center shrink-0">
        {Icon && <Icon className="w-4 h-4 text-brand-400" />}
      </div>
      <div>
        <p className="font-medium text-white text-sm">{label}</p>
        <p className="text-xs text-earth-400 mt-0.5">{description}</p>
      </div>
    </div>
  )
}

function FaqItem({ question, answer }) {
  const [open, setOpen] = useState(false)
  return (
    <button onClick={() => setOpen(!open)} className="w-full text-left rounded-xl border border-white/10 bg-white/5 p-4 transition hover:bg-white/10">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-white text-sm">{question}</p>
        <ChevronDown className={`w-4 h-4 text-earth-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </div>
      {open && <p className="mt-3 text-sm text-earth-300 leading-relaxed">{answer}</p>}
    </button>
  )
}

// ── Quick Start ──────────────────────────────────────────────────────────────

function QuickStart() {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white mb-2">Quick Start</h2>
        <p className="text-sm text-earth-400">Get up and running in 60 seconds. Follow these steps and you'll be tracking hours in no time.</p>
      </div>

      <Section title="1. Create your account">
        <p>Go to the <Link to="/register" className="text-brand-400 hover:underline">Sign Up</Link> page. Enter your name, email, and a password. Choose <strong>Student</strong> if you're logging your own hours, or <strong>Volunteer Task Maker</strong> if you're organizing events for others.</p>
      </Section>

      <Section title="2. Join your school (optional)">
        <p>If your school uses VolunTrack, ask your administrator for a school code. Go to <Link to="/settings" className="text-brand-400 hover:underline">Settings</Link>, scroll to "School partnership," and enter the code. This links your account so you can submit reports directly to your school.</p>
      </Section>

      <Section title="3. Log your first hours">
        <p>Click <Link to="/log" className="text-brand-400 hover:underline">Log Hours</Link> (or the <strong>+</strong> button on mobile). Fill in:</p>
        <div className="mt-3 space-y-2">
          <Step icon={Calendar} label="Date" description="When you volunteered." />
          <Step icon={Clock} label="Hours" description="How long you volunteered." />
          <Step icon={ClipboardList} label="Activity" description="What you did (e.g. 'Food bank sorting')." />
          <Step icon={BookOpen} label="Category" description="Pick from: Education, Environment, Health, Community, etc." />
        </div>
        <p className="mt-3">Click Save and you're done! Your hours appear on the dashboard, calendar, and reports instantly.</p>
      </Section>

      <Section title="4. Set a goal">
        <p>Go to <Link to="/settings" className="text-brand-400 hover:underline">Settings</Link> and scroll to Goals. Set a target (e.g. "50 hours by June") to track your progress with a visual ring on the dashboard.</p>
      </Section>

      <Section title="5. Explore your dashboard">
        <p>Return to <Link to="/" className="text-brand-400 hover:underline">Home</Link> to see your total hours, goal progress, weekly chart, recent activity, and earned badges — all in one place.</p>
      </Section>

      <Section title="Keep going">
        <div className="mt-3 space-y-2">
          <Step icon={Trophy} label="Earn badges" description="Hit milestones like 10, 25, 50 hours to unlock achievements." />
          <Step icon={FileText} label="Generate reports" description="Export a PDF of all your hours for school or scholarships." />
          <Step icon={ShieldCheck} label="Enable 2FA" description="Go to Settings → Two-Factor Authentication for extra security." />
        </div>
      </Section>
    </div>
  )
}

// ── Student Handbook ─────────────────────────────────────────────────────────

function StudentHandbook() {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white mb-2">Student Handbook</h2>
        <p className="text-sm text-earth-400">Track volunteer hours, earn badges, find nearby tasks, and stay connected with your school.</p>
      </div>

      <Section title="Dashboard Overview">
        <p>Your dashboard shows everything at a glance: total hours, goal progress, weekly activity chart, recent badges, and your latest volunteer sessions. If you're linked to a school, you'll also see school announcements and payment notices.</p>
      </Section>

      <Section title="Logging Hours">
        <p>Use the Log Hours page to record every volunteer session. Fill in the date, activity name, category, hours, and optional notes or location. You can also add supervisor contact information for verification.</p>
        <p className="mt-2">All logs are saved securely and appear instantly on your dashboard, calendar, and reports.</p>
      </Section>

      <Section title="Calendar View">
        <p>The Calendar page shows all your logged hours in a monthly layout. Each day with logged hours displays the total. Click any day to see a breakdown of activities. Use it to spot gaps and track consistency.</p>
      </Section>

      <Section title="Achievements & Badges">
        <p>As you log hours, you'll earn badges for milestones like your first log, hitting weekly goals, or reaching total hour thresholds. Badges appear as celebratory toasts and are collected on the Achievements page.</p>
      </Section>

      <Section title="Reports">
        <p>Generate a PDF report of all your logged hours from the Reports page. You can preview, download, or print the report. If you're linked to a school, you can submit the report directly for review.</p>
      </Section>

      <Section title="Volunteer Opportunities">
        <p>Click the <strong>Volunteer</strong> button on your dashboard to browse open volunteer tasks sorted by distance. Tasks near you appear first. You can sign up, and once the organizer approves you, their phone number is revealed so you can coordinate.</p>
        <p className="mt-2">You can also post your own tasks from the <Link to="/my-tasks" className="text-brand-400 hover:underline">My Tasks</Link> page.</p>
      </Section>

      <Section title="School Announcements">
        <p>If you're linked to a school, your dashboard shows announcements sent by your school admin. Check them regularly for updates, deadlines, and important info.</p>
      </Section>

      <Section title="Family Sharing">
        <p>Want a parent to be able to follow your logged hours and verification status? Go to <Link to="/settings" className="text-brand-400 hover:underline">Settings → Family</Link> and generate a link code. Share that code with your parent — they'll enter it in their own account to link to yours.</p>
        <p className="mt-2">Only hours logged from the moment you generate the code onward are visible to them; earlier entries stay private. Your parent can only view your hours — they can't edit or delete anything.</p>
      </Section>

      <Section title="Two-Factor Authentication (2FA)">
        <p>For extra security, you can enable 2FA in <Link to="/settings" className="text-brand-400 hover:underline">Settings</Link> using an authenticator app (like Google Authenticator or Authy). Once enabled, you'll need to enter a 6-digit code every time you sign in.</p>
        <p className="mt-2">Setup gives you 10 backup codes — save these somewhere safe. Each backup code can be used once if you lose access to your authenticator.</p>
      </Section>

      <Section title="Profile & Settings">
        <p>Your Profile page shows your account info, total hours, and earned badges. In Settings you can change your password, manage your school link, set goals, enable 2FA, and manage reminders.</p>
      </Section>
    </div>
  )
}

// ── School Handbook ──────────────────────────────────────────────────────────

function SchoolHandbook() {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white mb-2">School Handbook</h2>
        <p className="text-sm text-earth-400">Manage your school dashboard, review student submissions, send announcements, and track billing.</p>
      </div>

      <Section title="School Dashboard Overview">
        <p>Your school dashboard has tabs for Reports, Students, Chat, and Volunteer. Navigate between them to manage each area. Your payment status and admin notices are shown at the top.</p>
      </Section>

      <Section title="Managing Students">
        <p>The Students tab shows all students linked to your school. Share your school code with students — they enter it in their Settings page to join.</p>
      </Section>

      <Section title="Reviewing PDF Submissions">
        <p>When students submit reports, they appear in the Reports tab. Each shows the student's name, date, and status.</p>
        <div className="mt-3 space-y-2">
          <Step icon={FileText} label="View submission" description="Click 'View' to open the PDF." />
          <Step icon={CheckCircle} label="Approve or reject" description="Mark as approved or rejected with optional notes." />
          <Step icon={Mail} label="Student sees status" description="The student can check their submission status on their Reports page." />
        </div>
      </Section>

      <Section title="Chat (Announcements)">
        <p>The Chat tab lets you send announcements to all your students. Type a message and click Send. It appears instantly on every student's dashboard.</p>
      </Section>

      <Section title="Payment & Billing">
        <p>Your payment status is shown at the top of the dashboard. The system admin may send payment notices. If a due date is set, a countdown banner appears within 10 days of the deadline.</p>
      </Section>
    </div>
  )
}

// ── Volunteer Handbook ───────────────────────────────────────────────────────

function VolunteerHandbook() {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white mb-2">Volunteer Task Maker Handbook</h2>
        <p className="text-sm text-earth-400">Post volunteer opportunities, manage signups, log hours for your team, and track tasks by location.</p>
      </div>

      <Section title="Getting Started">
        <p>When you create an account, choose <strong>"I'm a Volunteer Task Maker"</strong>. You'll skip school-related fields and go straight to posting tasks.</p>
        <div className="mt-3 space-y-2">
          <Step icon={Hand} label="Sign up as a Task Maker" description="Select 'Volunteer Task Maker' on the register page." />
          <Step icon={ClipboardList} label="Post your first task" description="Go to My Tasks and fill in the details. Your location is captured for proximity sorting." />
          <Step icon={Users} label="Manage signups" description="Review, approve, and log hours for volunteers." />
        </div>
      </Section>

      <Section title="Posting a Task">
        <p>Go to <strong>My Tasks</strong> and fill in the form. You'll need:</p>
        <div className="mt-3 space-y-2">
          <Step icon={FileText} label="Title & description" description="Name your task and explain what volunteers will do." />
          <Step icon={MapPin} label="Location" description="Where the task takes place." />
          <Step icon={Phone} label="Phone number" description="Required. Only shared with volunteers you approve." />
          <Step icon={Calendar} label="Date, time & slots" description="When it happens and how many volunteers you need." />
        </div>
      </Section>

      <Section title="Managing Signups">
        <p>The <strong>My Tasks</strong> page is your organizer hub. Each task shows who signed up:</p>
        <div className="mt-3 space-y-2">
          <Step icon={CheckCircle} label="Approve" description="Accepts the volunteer and reveals your phone number to them." />
          <Step icon={XCircle} label="Reject" description="Declines the volunteer. They'll see the status." />
          <Step icon={Clock} label="Log hours" description="Once approved, log hours for the volunteer — saved to their account." />
        </div>
      </Section>

      <Section title="Phone Number Privacy">
        <p>Your phone number is <strong>never shown publicly</strong>. It's only visible to you and to volunteers you specifically approve.</p>
      </Section>
    </div>
  )
}

// ── FAQ ──────────────────────────────────────────────────────────────────────

function Faq() {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white mb-2">Frequently Asked Questions</h2>
        <p className="text-sm text-earth-400">Quick answers to common questions.</p>
      </div>

      <div className="space-y-3">
        <FaqItem
          question="Is my data private?"
          answer="Yes. Your volunteer logs, goals, and profile are stored locally on your device. If you create a server account, your data is stored in a secure database. We never sell or share your data."
        />
        <FaqItem
          question="How do I enable two-factor authentication (2FA)?"
          answer="Go to Settings, then find the Two-Factor Authentication card. Click Enable 2FA, scan the QR code with an authenticator app like Google Authenticator or Authy, enter the 6-digit code to confirm, and save your backup codes. You'll need to enter a code each time you sign in."
        />
        <FaqItem
          question="I lost my authenticator — how do I log in?"
          answer="On the login screen, after entering your password, click 'Use a backup code instead' and enter one of the 10 backup codes you saved during 2FA setup. Each code works once. If you don't have backup codes, use the password reset flow from the login page."
        />
        <FaqItem
          question="How do I join a school?"
          answer="Ask your school administrator for their school code. Go to Settings → School partnership (or scroll down on the Settings page) and enter the code. Your account will be linked immediately."
        />
        <FaqItem
          question="Can I use VolunTrack without an account?"
          answer="Yes! The app works entirely in your browser using local storage. No account is needed to log hours, set goals, or earn badges. However, you won't have cross-device sync, school integration, or cloud backup."
        />
        <FaqItem
          question="How do I sync across devices?"
          answer="Create a server account (register with email + password). On your first device, go to Settings → Mobile/Laptop sync PIN → Generate PIN. On your second device, go to the login page → Use sync PIN → Enter the 5-digit code. Your data will sync automatically."
        />
        <FaqItem
          question="How do I generate a PDF report?"
          answer="Go to the Reports page and click 'Generate Report.' You can preview the PDF, download it, or print it. If you're linked to a school, you can also submit it directly."
        />
        <FaqItem
          question="Can I undo a deleted log entry?"
          answer="No — once a log entry is deleted, it cannot be recovered. Make sure you really want to delete it before confirming."
        />
        <FaqItem
          question="How do I change my password?"
          answer="Go to Settings → Change password. Enter your current password and your new password (at least 8 characters). Click 'Update password.'"
        />
        <FaqItem
          question="What categories can I use when logging hours?"
          answer="Categories include: Education, Environment, Health, Community, Animals, Arts, Sports, Technology, Religion, and Other. Pick the one that best fits your volunteer activity."
        />
        <FaqItem
          question="How do volunteer badges work?"
          answer="You earn badges automatically as you log hours. Milestones include your first log, 10, 25, 50, 100, and 200 hours, plus weekly streaks. Check the Achievements page to see your progress."
        />
        <FaqItem
          question="Is there a mobile app?"
          answer="VolunTrack is a Progressive Web App (PWA). Open it in your phone's browser and tap 'Add to Home Screen' to install it like a native app. It works offline after the first visit."
        />
        <FaqItem
          question="I have a bug or feature request."
          answer="Visit the Contact page to send us a message, or open an issue on GitHub: https://github.com/Hriday21223/VolunteerTrack/issues"
        />
      </div>
    </div>
  )
}

// ── Main Help Component ──────────────────────────────────────────────────────

export default function Help() {
  useSeo({
    title: 'Help & Handbooks',
    description: 'Guides, FAQs, and handbooks for students, volunteers, and schools using VolunTrack.',
    path: '/help',
  })

  const [tab, setTab] = useState('quickstart')

  return (
    <AppLayout
      title="Help & Handbooks"
      subtitle="Guides, FAQs, and handbooks for every role"
      action={
        <div className="flex gap-1 bg-white/5 rounded-xl p-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
                tab === t.id ? 'bg-brand-600 text-white' : 'text-earth-400 hover:text-white'
              }`}
            >
              <t.icon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>
      }
    >
      {tab === 'quickstart' && <QuickStart />}
      {tab === 'student' && <StudentHandbook />}
      {tab === 'volunteer' && <VolunteerHandbook />}
      {tab === 'school' && <SchoolHandbook />}
      {tab === 'faq' && <Faq />}
    </AppLayout>
  )
}
