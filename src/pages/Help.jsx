import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, School, Clock, Calendar, Trophy, FileText, MapPin, Users, CheckCircle, HelpCircle, Mail, ClipboardList, Phone, XCircle, Hand, ChevronDown, ShieldCheck, Zap, Building2, MessageSquare, Star, Bell, CreditCard, AlertTriangle, UserCheck, Link2, Lock, Terminal, Download, FileSignature } from 'lucide-react'
import AppLayout from '@/components/AppLayout.jsx'
import Footer from '@/components/Footer.jsx'
import PublicHeader from '@/components/PublicHeader.jsx'
import { useAuth } from '@/hooks/useAuth.jsx'
import { useSeo } from '@/hooks/useSeo.js'

const TABS = [
  { id: 'quickstart', label: 'Quick Start', icon: Zap },
  { id: 'student', label: 'Student', icon: BookOpen },
  { id: 'parent', label: 'Parent', icon: Users },
  { id: 'volunteer', label: 'Volunteer', icon: Hand },
  { id: 'school', label: 'School', icon: School },
  { id: 'school_staff', label: 'Co-Admin', icon: UserCheck },
  { id: 'organization', label: 'Organization', icon: Building2 },
  { id: 'admin', label: 'Admin', icon: ShieldCheck },
  { id: 'faq', label: 'FAQ', icon: HelpCircle },
]

// Single source for the FAQ accordion below and the FAQPage structured data
// injected via useSeo() — so an AI answer engine can cite these verbatim and
// the page never drifts from its schema.
const FAQ_ITEMS = [
  { q: 'Is my data private?', a: "Yes. Your hours are stored in a secure database, protected by your password and, if you turn them on, two-factor authentication or a passkey. They're visible only to you, the school you join, and parents you invite. Signature drawings stay on your device — the server only records that an entry was signed. We never sell your data or show ads." },
  { q: 'Do I need an account?', a: "Yes — a free account is how your hours are saved, synced across your devices, and shared with your school. Sign up with your name, email, password (at least 8 characters) and date of birth, then enter the 6-digit code we email you to confirm your address; the code expires after 10 minutes. If you're under 13, a parent or guardian approves the account by email first." },
  { q: 'How does supervisor verification work?', a: 'When you log hours, add your supervisor\'s email and they get a one-time link to approve or reject those specific hours — no account needed. Approving asks them to sign; rejecting skips that step. If your school requires signatures, Log Hours asks whether the person signing is next to you: if yes, they sign on your device; if not, you get a ready-made email with the signing link to send yourself (or have VolunTrack send it). On a laptop, they can scan a QR code and sign on their phone. Hours on an Opportunities task are signed off by the organizer from their own account instead. Each log then shows Pending, Approved, or Rejected.' },
  { q: 'How do I let a parent see my hours?', a: 'In Settings → Family, generate a link code and share it with your parent. They enter it in their own Settings → Family. Each code works once, and the same card lists every parent who can see your hours, with a Remove button. They\'ll only see hours you log from the moment they link — anything earlier stays private — and they can\'t change anything. Linked parents also get a weekly progress email, which they can unsubscribe from at any time from a link in the email.' },
  { q: 'What\'s the difference between a school account and an organization account?', a: 'A school account manages one school\'s students, report reviews, announcements, and co-admins. An organization account sits above multiple schools: it adds them and tracks their setup and payment status, but each school still runs its own dashboard.' },
  { q: 'Can more than one person manage a school account?', a: 'Yes. The primary school account can add up to 10 co-admins from School setup \u2192 Co-admins, entering each person\'s name, email, and a temporary password they change after signing in. Co-admins share the dashboard \u2014 reviewing reports, managing students, and sending announcements \u2014 but don\'t get the School setup tab, so they can\'t add or remove other co-admins, change the school code, configure sign-in, or handle billing.' },
  { q: 'How does a school or organization sign up?', a: 'Contact us through the Contact page. We\'ll send a quote along with a one-time registration code (or, if you prefer, an invite link). Enter the code at the School or Organization sign-up page to create the account and choose your own password. Each code works once and expires, so ask us for a new one if yours has run out.' },
  { q: 'Who sets the price for a school or organization account?', a: 'The VolunTrack admin, based on your size and how you\'ll use it. You\'ll get a quote before you sign up, and invoices arrive by email with a downloadable PDF.' },
  { q: 'How do I join a school?', a: 'Ask your school administrator for their school code. Go to Settings → Join school and enter it — your account links immediately. A school can also invite you by email: you\'ll see the invite in Settings → Join school, and nothing is shared unless you accept.' },
  { q: 'How do I report a volunteer task?', a: 'On the Opportunities page, tap Report under the task, choose what is wrong, and send it. You can also block the organizer, which hides all of their tasks and stops their messages; see or undo blocks in Settings → Blocked organizers. We review every report within 24 hours. The organizer is not told who reported.' },
  { q: 'How do I leave my school?', a: 'Go to Settings → School → Leave school. Your school stops seeing your hours and the reports you sent them, and your hours stay in your account. Moving to a different school is different: enter the new school\'s code there instead, and your hours move with you once they accept.' },
  { q: 'Where can I find volunteer opportunities?', a: 'Open the Opportunities page. It lists public tasks posted by schools and organizations, sorted by distance if you allow location access. Sign up in one click; once the organizer approves you, pick the task when you log your hours and the organizer signs them off on their My Tasks page.' },
  { q: 'My school requires signatures — what do I do?', a: 'Log Hours shows a Signatures section with exactly what your school asks for: your own signature, your supervisor\'s (in person or by a link you email), or your school\'s form. If it\'s a Google Form, fill it in right on the page and tick the box; for any other form, download it, get it signed, and upload a photo or scan.' },
  { q: 'I volunteer at the same place every week. Do I have to type it all again?', a: 'No. Log Hours shows a Log again card with your last few regular activities. Tap one and the activity, times, location, organization and supervisor are copied into a new entry dated today. Check the times and save. Signatures and proof files aren\'t copied, because each visit needs its own.' },
  { q: 'Can I log hours for a past date?', a: 'Yes. Set any past date when you add the entry — there\'s no cutoff. If you tend to forget, the Reminders page lets you schedule recurring nudges, delivered as browser notifications and in-app toasts.' },
  { q: 'How do I sync across devices?', a: 'Sign in on the new device with your email and password and your hours come with you. To skip typing your password, go to Settings on a signed-in device and generate a sync PIN (the card is called Mobile sync PIN on a computer, Laptop sync PIN on a phone). On the new device, choose Use sync PIN on the login page and enter the 5-digit code, or scan its QR code. A sync PIN works once and expires after 15 minutes.' },
  { q: 'How do I enable two-factor authentication (2FA)?', a: 'Go to Settings → Two-Factor Authentication, scan the QR code with an authenticator app, confirm with the 6-digit code it shows, and save your backup codes. You\'ll enter a code each time you sign in. You can also add a passkey in Settings → Passkeys — instead of an authenticator app or as well as one — so after your password you confirm with Face ID, Touch ID, your fingerprint or your device PIN instead of typing a code.' },
  { q: 'I lost my authenticator — how do I log in?', a: 'On the login screen, after entering your password, click \'Use a backup code instead\' and enter one of the 10 backup codes you saved during 2FA setup. Each code works once. If you don\'t have any, use the password reset flow from the login page.' },
  { q: 'How do I generate a PDF report?', a: 'Go to the Reports page, narrow it by category or dates if you like, and click \'Download PDF.\' The same page has \'Export CSV\' for spreadsheets and \'Print certificate\' for a certificate of service. If you\'re linked to a school, you can also submit a report directly and track its approve/reject status.' },
  { q: 'Can I undo a deleted log entry?', a: 'No — once a log entry is deleted, it cannot be recovered. Make sure you really want to delete it before confirming.' },
  { q: 'How do I change my password?', a: 'Go to Settings → Change password. Enter your current password and a new one (at least 8 characters). Click \'Update password.\'' },
  { q: 'What categories can I use when logging hours?', a: 'Community Service, Environmental, Education & Tutoring, Health & Wellness, Animal Welfare, Arts & Culture, Sports & Coaching, Religious & Faith, Political & Advocacy, Disaster Relief, and Other. Pick the one that best fits your activity.' },
  { q: 'How do volunteer badges work?', a: 'You earn badges automatically as you log hours — 12 in all. They include your first hour; 10, 50 and 100 hours; reaching your goal; logging on 3 and on 7 different days; trying 3 and 5 categories; 5 hours in one month; a weekend session; and logging in two different months. Check the Achievements page to see your progress.' },
  { q: 'Is there a mobile app?', a: 'Android and iPhone apps are on their way to Google Play and the App Store. Until then, VolunTrack is a Progressive Web App (PWA) — open it in your phone\'s browser and tap \'Add to Home Screen\' to install it like an app. It works offline after the first visit, and anything that needs the server catches up once you\'re back online.' },
  { q: 'I have a bug or feature request.', a: 'Visit the Contact page to send us a message, or open an issue on GitHub: https://github.com/Hriday21223/VolunTrack/issues' },
]

// Drives the Quick Start panel below and the HowTo structured data.
const QUICKSTART_STEPS = [
  { name: 'Create your account', text: 'Go to the Sign Up page and pick a role: Student if you\'re logging your own hours, Volunteer Task Maker if you\'re organizing events for others, or Parent if you want to follow a student\'s hours. Enter your date of birth, then the 6-digit code we email you to confirm your address. If you\'re under 13, a parent or guardian approves the account by email first. Schools and multi-school organizations have their own signup pages.' },
  { name: 'Join your school (optional)', text: 'If your school uses VolunTrack, ask an administrator for a school code. Open Settings, find "Join school," and enter the code. Your school can also invite you by email; accept it in Settings.' },
  { name: 'Log your first hours', text: 'Click Log Hours (or the + button on mobile). Fill in the date, hours, activity, and category, and optionally a supervisor email so they can verify the hours. Click Save — your hours appear on the dashboard, calendar, and reports instantly.' },
  { name: 'Set a goal', text: 'Go to Settings and scroll to Goals. Set a target (e.g. "50 hours by June") to track your progress with a visual ring on the dashboard.' },
  { name: 'Explore your dashboard', text: 'Return to Home to see your total hours, goal progress, weekly chart, recent activity, and earned badges — all in one place.' },
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

function HandbookIntro({ title, children }) {
  return (
    <div className="mb-8">
      <h2 className="text-2xl font-bold text-white mb-2">{title}</h2>
      <p className="text-sm text-earth-400">{children}</p>
    </div>
  )
}

// ── Quick Start ──────────────────────────────────────────────────────────────

function QuickStart() {
  return (
    <div>
      <HandbookIntro title="Quick Start">
        Get up and running in a couple of minutes. Follow these steps and you'll be tracking hours in no time.
      </HandbookIntro>

      <Section title="1. Create your account">
        <p>Go to the <Link to="/register" className="text-brand-400 hover:underline">Sign Up</Link> page and pick a role: <strong>Student</strong> if you're logging your own hours, <strong>Volunteer Task Maker</strong> if you're organizing events for others, or <strong>Parent</strong> if you want to follow a student's hours. Enter your date of birth, then the 6-digit code we email you to confirm your address — it expires after 10 minutes. If you're under 13, a parent or guardian approves the account by email first. Schools and multi-school organizations have their own signup pages (linked from the login screen).</p>
      </Section>

      <Section title="2. Join your school (optional)">
        <p>If your school uses VolunTrack, ask an administrator for a school code. Open <Link to="/settings" className="text-brand-400 hover:underline">Settings</Link>, find "Join school," and enter the code. Your school can also invite you by email: the invite shows up under Join school, and nothing is shared until you accept.</p>
      </Section>

      <Section title="3. Log your first hours">
        <p>Click <Link to="/log" className="text-brand-400 hover:underline">Log Hours</Link> (or the <strong>+</strong> button on mobile). Fill in:</p>
        <div className="mt-3 space-y-2">
          <Step icon={Calendar} label="Date" description="When you volunteered." />
          <Step icon={Clock} label="Hours" description="How long you volunteered." />
          <Step icon={ClipboardList} label="Activity" description="What you did (e.g. 'Food bank sorting')." />
          <Step icon={BookOpen} label="Category" description="Education, Environment, Health, Community, and more." />
          <Step icon={UserCheck} label="Supervisor email (optional)" description="Add one and they'll get a link to verify these hours." />
        </div>
        <p className="mt-3">Click Save and you're done. Your hours appear on the dashboard, calendar, and reports instantly.</p>
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
          <Step icon={ShieldCheck} label="Enable 2FA" description="Settings → Two-Factor Authentication for extra security." />
        </div>
      </Section>
    </div>
  )
}

// ── Student Handbook ─────────────────────────────────────────────────────────

function StudentHandbook() {
  return (
    <div>
      <HandbookIntro title="Student Handbook">
        Track volunteer hours, get them verified, earn badges, find nearby tasks, and stay connected with your school.
      </HandbookIntro>

      <Section title="Dashboard Overview">
        <p>Your dashboard shows everything at a glance: total hours, goal progress, weekly activity chart, recent badges, and your latest volunteer sessions. If you're linked to a school, you'll also see school announcements and any payment notices.</p>
      </Section>

      <Section title="Logging Hours">
        <p>Use the Log Hours page to record every volunteer session. Fill in the date, activity name, category, hours, and optional notes or location. You can also add a supervisor's email so those hours can be verified.</p>
        <p className="mt-2">All logs are saved securely and appear instantly on your dashboard, calendar, and reports.</p>
      </Section>

      <Section title="Supervisor Verification">
        <p>When you add a supervisor's email to a log entry, that person gets a one-time email link to approve or reject those specific hours — no account needed on their end. Approving asks them to sign. On a laptop, they can tap <strong>Sign on your phone or iPad instead</strong> and scan a QR code to sign with a finger.</p>
        <p className="mt-2">Each log then shows a status badge:</p>
        <div className="mt-3 space-y-2">
          <Step icon={Clock} label="Pending" description="The request has been sent and is waiting on your supervisor." />
          <Step icon={CheckCircle} label="Approved" description="Your supervisor confirmed the hours. These are the hours schools and parents can rely on." />
          <Step icon={XCircle} label="Rejected" description="Your supervisor declined. Check the details with them and re-log if needed." />
        </div>
      </Section>

      <Section title="When Your School Requires Signatures">
        <p>Some schools require every entry to be signed, or to come with their own form. Log Hours then shows a <strong>Signatures</strong> section telling you exactly what's needed:</p>
        <div className="mt-3 space-y-2">
          <Step icon={FileSignature} label="Your signature" description="Sign in the box before you save." />
          <Step icon={UserCheck} label="Supervisor next to you?" description="Yes — hand them your device to sign. No — after saving you get a ready-made email with the signing link to send them (or let VolunTrack send it)." />
          <Step icon={Hand} label="Opportunities task" description="Pick the task, and the organizer signs it off on their My Tasks page. Nothing to send." />
          <Step icon={FileText} label="School form" description="A Google Form opens right on the page — fill it in and tick the box. Any other form: download, sign, and upload a photo or scan." />
        </div>
      </Section>

      <Section title="Calendar View">
        <p>The Calendar page shows all your logged hours in a monthly layout. Each day with logged hours displays the total. Click any day to see a breakdown of activities. Use it to spot gaps and track consistency.</p>
      </Section>

      <Section title="Achievements & Badges">
        <p>As you log hours, you'll earn badges for milestones like your first log, hitting weekly goals, or reaching total-hour thresholds. Badges appear as celebratory toasts and are collected on the Achievements page.</p>
      </Section>

      <Section title="Reports">
        <p>Generate a PDF report of all your logged hours from the Reports page. You can preview, download, or print it. If you're linked to a school, you can submit the report directly for review, and see its approve/reject status there.</p>
      </Section>

      <Section title="Volunteer Opportunities">
        <p>Click the <strong>Volunteer</strong> button on your dashboard to browse open volunteer tasks sorted by distance. Tasks near you appear first. You can sign up, and once the organizer approves you, their phone number is revealed so you can coordinate. When you log the hours, link them to the task and the organizer signs them off.</p>
        <p className="mt-2">You can also post your own tasks from the <Link to="/my-tasks" className="text-brand-400 hover:underline">My Tasks</Link> page.</p>
      </Section>

      <Section title="School Announcements">
        <p>If you're linked to a school, your dashboard shows announcements sent by your school admin. Check them regularly for updates, deadlines, and important info.</p>
        <p className="mt-2">VolunTrack itself may also show a notice at the top of your dashboard — for example, planned maintenance — and email it to you. Close it with the × once you've read it.</p>
      </Section>

      <Section title="Family Sharing">
        <p>Want a parent to be able to follow your logged hours and verification status? Go to <Link to="/settings" className="text-brand-400 hover:underline">Settings → Family</Link> and generate a link code. Share that code with your parent — they'll enter it in their own account to link to yours.</p>
        <p className="mt-2">Only hours you log from the moment your parent links are visible to them; earlier entries stay private. Your parent can only view your hours — they can't edit or delete anything.</p>
      </Section>

      <Section title="Signing in on another device">
        <div className="mt-3 space-y-2">
          <Step icon={Lock} label="Email and password" description="Sign in with the same email and password on any device; your hours sync automatically." />
          <Step icon={Link2} label="Sync PIN" description="Settings → generate a sync PIN on a signed-in device, then on the login page choose 'Use sync PIN' on the other. It works once and expires after 15 minutes." />
        </div>
      </Section>

      <Section title="Two-Factor Authentication (2FA)">
        <p>For extra security, enable 2FA in <Link to="/settings" className="text-brand-400 hover:underline">Settings</Link>. Scan the QR code with an authenticator app (like Google Authenticator or Authy) and confirm with the 6-digit code it shows; after that, you'll enter a code each time you sign in. You can also add a passkey in Settings → Passkeys, instead of an authenticator app or as well as one, and confirm with Face ID, Touch ID, your fingerprint or your device PIN.</p>
        <p className="mt-2">Setup gives you 10 backup codes — save these somewhere safe. Each backup code can be used once if you lose access to your authenticator or passkey.</p>
      </Section>

      <Section title="Profile & Settings">
        <p>Your Profile page shows your account info, total hours, and earned badges. In Settings you can change your password, manage your school link, set goals, enable 2FA or add a passkey, generate a sync PIN, and manage reminders.</p>
      </Section>
    </div>
  )
}

// ── Parent Handbook ──────────────────────────────────────────────────────────

function ParentHandbook() {
  return (
    <div>
      <HandbookIntro title="Parent Handbook">
        A parent account is view-only. You can follow your linked children's logged hours and verification status — you can't add, edit, or delete anything.
      </HandbookIntro>

      <Section title="Getting Started">
        <p>Sign up on the <Link to="/register" className="text-brand-400 hover:underline">register</Link> page and choose <strong>"I'm a Parent"</strong>. Once you're in, your first task is to link a child.</p>
      </Section>

      <Section title="Linking a Child">
        <div className="mt-3 space-y-2">
          <Step icon={Users} label="1. Ask your child for a code" description="They open Settings → Family on their account and generate a link code." />
          <Step icon={Link2} label="2. Enter it in your Settings" description="Go to your own Settings → Family and enter that code." />
          <Step icon={CheckCircle} label="3. Their card appears" description="You can link more than one child — each gets its own card on your Family dashboard." />
        </div>
        <p className="mt-3">Only hours your child logs from the moment you link are visible to you; anything earlier stays private.</p>
      </Section>

      <Section title="The Family Dashboard">
        <p>Each linked child gets a card showing their total hours and a table of every session: date, activity, verification status, and hours. Use the verification badges to see which hours a supervisor has confirmed.</p>
        <p className="mt-2">If the dashboard can't load, that's almost always a temporary connection issue — use "Try again" rather than assuming something is wrong with the link.</p>
      </Section>

      <Section title="What you can't do">
        <p>Parent accounts can't edit or delete logs, message the school, or see entries from before linking. If something needs to change, ask your child or their school to make the change.</p>
      </Section>

      <Section title="Unlinking">
        <p>Either side can unlink at any time from Settings → Family. Unlinking stops any further sharing immediately.</p>
      </Section>
    </div>
  )
}

// ── Volunteer Handbook ───────────────────────────────────────────────────────

function VolunteerHandbook() {
  return (
    <div>
      <HandbookIntro title="Volunteer Task Maker Handbook">
        Post volunteer opportunities, manage signups, sign off your volunteers' hours, and track tasks by location.
      </HandbookIntro>

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
          <Step icon={Clock} label="Log hours" description="Once approved, log hours for the volunteer — saved to their account with your task as the source." />
        </div>
      </Section>

      <Section title="Signing Off Volunteers' Hours">
        <p>When a volunteer logs hours and links them to your task, the entry appears under <strong>My students</strong> on My Tasks.</p>
        <div className="mt-3 space-y-2">
          <Step icon={FileSignature} label="Sign & approve" description="Opens a signature box — sign, then Confirm approval. Your signature is saved with the entry." />
          <Step icon={XCircle} label="Reject" description="Declines the hours. No signature needed." />
        </div>
        <p className="mt-3">If the volunteer changes the date, hours, or activity afterward, your approval is cleared and they'll need it signed again.</p>
      </Section>

      <Section title="Contact Details Privacy">
        <p>Your phone number is <strong>never shown publicly</strong>. It's only visible to you and to volunteers you specifically approve. Your email is never shown publicly either — it's only filled in as the supervisor on Log Hours for volunteers you've approved.</p>
      </Section>
    </div>
  )
}

// ── School Handbook ──────────────────────────────────────────────────────────

function SchoolHandbook() {
  return (
    <div>
      <HandbookIntro title="School Handbook">
        Manage your school dashboard, review student submissions, verify hours, send announcements, add co-admins, and track billing.
      </HandbookIntro>

      <Section title="School Dashboard Overview">
        <p>The school dashboard has tabs for <strong>Students</strong>, <strong>Reports</strong>, <strong>Volunteer</strong>, <strong>School setup</strong>, and an announcements (chat) button. Your payment status and any admin notices show at the top. Co-admins share this dashboard but don't see School setup — see the <strong>Co-Admin</strong> handbook.</p>
      </Section>

      <Section title="Getting Your School Set Up">
        <p>Either register on the school signup page, or accept an invite email from your organization or the VolunTrack admin. The invite link lets you set a password and pick your school code; it expires after 3 days.</p>
      </Section>

      <Section title="Managing Students">
        <p>The Students tab shows everyone linked to your school. There are two ways to add students:</p>
        <div className="mt-3 space-y-2">
          <Step icon={School} label="Share your school code" description="Students enter it in Settings → Join school." />
          <Step icon={Mail} label="Invite by email" description="Invite a student from the Students tab; they join once they accept in their Settings." />
        </div>
      </Section>

      <Section title="Reviewing Report Submissions">
        <p>When students submit reports, they appear in the Reports tab with the student's name, date, and status.</p>
        <div className="mt-3 space-y-2">
          <Step icon={FileText} label="View submission" description="Open the PDF to check it." />
          <Step icon={CheckCircle} label="Approve or reject" description="Mark it approved or rejected, with optional notes." />
          <Step icon={Mail} label="Student sees status" description="They can check their submission status on their own Reports page." />
        </div>
        <p className="mt-3">Schools can also upload their own verification documents from the same tab.</p>
      </Section>

      <Section title="Requirements & Signatures">
        <p>In <strong>School setup → Requirements</strong>, decide how your students must log hours. Each section either follows your organization (or VolunTrack's defaults) or uses your own rules:</p>
        <div className="mt-3 space-y-2">
          <Step icon={ClipboardList} label="Hour-entry rules" description="Require proof, a supervisor, a location, or the organization; set hour limits, how far back entries can be dated, and allowed categories." />
          <Step icon={HelpCircle} label="Extra questions" description="Add your own questions to the bottom of the Log Hours form." />
          <Step icon={Trophy} label="Service-hour requirement" description="The total each student works toward, with per-grade overrides and a deadline." />
          <Step icon={FileSignature} label="Signatures" description="No signature, a signature from the supervisor, the student, or both — or your own form. Paste a Google Form link and students fill it in without leaving VolunTrack; any other link is a form they download, sign, and upload." />
        </div>
        <p className="mt-3">Your hours CSV includes a <strong>Signed how</strong> column — signed in person, by a link the student sent, by a link VolunTrack emailed, or by a task organizer — so you can weigh each sign-off.</p>
      </Section>

      <Section title="Announcements">
        <p>The speech-bubble button in the dashboard's tab row opens the announcement composer, which sends to all your students. Type a message and click Send — it appears instantly on every student's dashboard. Previously sent announcements are listed below the composer.</p>
      </Section>

      <Section title="Co-admins (Staff)">
        <p>The primary school account can add up to <strong>10</strong> co-admins from <strong>School setup → Co-admins</strong>. You enter their name, email, and a temporary password — there's no invite email, so pass the password on yourself and have them change it in Settings after their first sign-in.</p>
        <p className="mt-2">Co-admins share your dashboard — reviewing reports, managing students, and sending announcements — but School setup stays yours alone, so they can't add or remove co-admins, rotate the school code, configure sign-in, or touch billing. Remove one at any time from the same tab; their access ends immediately. Full details are in the <strong>Co-Admin</strong> handbook.</p>
      </Section>

      <Section title="Posting Volunteer Tasks">
        <p>The Volunteer tab lets your school post public volunteer tasks, the same way individual organizers do. Students browsing opportunities will see them sorted by distance.</p>
      </Section>

      <Section title="Payment & Billing">
        <p>Your payment status is shown at the top of the dashboard. Pricing is set by the VolunTrack admin based on your school's size and usage.</p>
        <div className="mt-3 space-y-2">
          <Step icon={Bell} label="Payment notices" description="The admin may send notices with an amount and due date." />
          <Step icon={CreditCard} label="Invoices" description="Invoices arrive by email; download each as a PDF from the dashboard." />
          <Step icon={Calendar} label="Due-date countdown" description="A banner appears within 10 days of a set deadline." />
        </div>
        <p className="mt-3">If an account is unpaid and locked, the dashboard stays restricted until the admin verifies payment.</p>
      </Section>
    </div>
  )
}

// ── School Co-Admin Handbook ─────────────────────────────────────────

function SchoolStaffHandbook() {
  return (
    <div>
      <HandbookIntro title="School Co-Admin Handbook">
        A co-admin helps run a school's dashboard day to day — reviewing reports, managing students, and sending announcements. You share the school admin's dashboard, minus the setup and billing controls.
      </HandbookIntro>

      <Section title="Getting Your Account">
        <p>You can't sign yourself up as a co-admin. Your school's primary admin creates the account for you from <strong>School setup → Co-admins</strong>, entering your name, email, and a temporary password.</p>
        <p className="mt-2">Sign in on the normal login page with that email and password, then change the password from <Link to="/settings" className="text-brand-400 hover:underline">Settings</Link> right away. A school can have up to <strong>10</strong> co-admins.</p>
        <p className="mt-2">If your school signs in through its own Google or Microsoft account (SSO), the admin can set the connection's default role to co-admin, and matching staff get a co-admin account automatically on first sign-in.</p>
      </Section>

      <Section title="What You Can Do">
        <div className="mt-3 space-y-2">
          <Step icon={FileText} label="Review reports" description="Open student submissions in the Reports tab and approve or reject them with notes, and upload the school's own verification documents." />
          <Step icon={Download} label="Export hours" description="Reports → Hours exports every student's logged hours for a date range as a CSV." />
          <Step icon={Users} label="Manage students" description="See the full student list, share the school code, and invite students by email." />
          <Step icon={MessageSquare} label="Send announcements" description="Post to every student's dashboard from the announcements button." />
          <Step icon={Hand} label="Post volunteer tasks" description="Publish public volunteer opportunities from the Volunteer tab, the same way the school admin does." />
        </div>
      </Section>

      <Section title="What Only the Primary Admin Can Do">
        <p>The <strong>School setup</strong> tab doesn't appear for co-admins. It holds the things that change the school account itself:</p>
        <div className="mt-3 space-y-2">
          <Step icon={ShieldCheck} label="Add or remove co-admins" description="Including you — a co-admin can't add or remove another." />
          <Step icon={Lock} label="Sign-in (SSO) and custom domain" description="Connecting the school's identity provider and claiming a domain." />
          <Step icon={CreditCard} label="Billing" description="Viewing billing details and submitting the bank confirmation number for a payment." />
          <Step icon={School} label="Changing the school code" description="Rotating the join code students use, so a code already handed out can't be invalidated from under the admin." />
        </div>
      </Section>

      <Section title="If the School Account Is Unpaid">
        <p>When a school's payment hasn't been verified, the whole dashboard is locked for co-admins too — you'll see the payment screen instead of your tabs. Only the primary admin can enter the bank confirmation number, so ask them to complete it; access unlocks for everyone once the VolunTrack admin verifies the payment.</p>
      </Section>

      <Section title="Your Account & Security">
        <p>Co-admin accounts use the same <Link to="/settings" className="text-brand-400 hover:underline">Settings</Link> as any other account: change your password, and enable two-factor authentication or add a passkey. Because you can read every student's records, 2FA is worth turning on.</p>
        <p className="mt-2">If you leave the role, the primary admin removes you from School setup → Co-admins and your access ends immediately.</p>
      </Section>
    </div>
  )
}

// ── Organization Handbook ────────────────────────────────────────────────────

function OrganizationHandbook() {
  return (
    <div>
      <HandbookIntro title="Organization Handbook">
        An organization account sits above multiple schools. It's deliberately minimal — it adds schools and tracks their status. Everything else happens on each school's own dashboard.
      </HandbookIntro>

      <Section title="Getting Started">
        <p>Register on the organization signup page (linked from the login screen). Once you're in, the dashboard has two tabs: <strong>Schools</strong> and <strong>Invites</strong>.</p>
      </Section>

      <Section title="Adding Schools">
        <p>On the Schools tab, click <strong>Add a school</strong> and enter the school's name and an admin email. They get an email with a link — expiring in 3 days — to set their own password and school code.</p>
      </Section>

      <Section title="Your Schools List">
        <p>Each school you've added shows its code, contact email, student count, date added, and payment status:</p>
        <div className="mt-3 space-y-2">
          <Step icon={CreditCard} label="Unpaid / Pending review / Paid / Rejected" description="Payment status is managed by the VolunTrack admin, not the organization." />
          <Step icon={Users} label="Student count" description="How many students have linked to that school so far." />
        </div>
      </Section>

      <Section title="Invites Tab">
        <p>Track the invites you've sent: <strong>Pending</strong> (not set up yet), <strong>Set up</strong> (the school finished onboarding), or <strong>Expired</strong> (the link lapsed — send a new one).</p>
      </Section>

      <Section title="Invoices">
        <p>Invoices from the VolunTrack admin appear on the Schools tab. Download each as a PDF for your records.</p>
      </Section>

      <Section title="What the org dashboard doesn't do">
        <p>No student lists, no PDF review, no announcements, no co-admin management. For any of that, open the individual school's own dashboard.</p>
      </Section>
    </div>
  )
}

// ── Admin Handbook ───────────────────────────────────────────────────────────

function AdminHandbook() {
  return (
    <div>
      <HandbookIntro title="Admin Handbook">
        The admin dashboard lives at <code className="text-brand-300">/admin</code> and is restricted to accounts with the admin role. It has ten tabs.
      </HandbookIntro>

      <Section title="Inbox">
        <p>Contact-form messages land here, threaded by conversation. Each thread comes with an AI-drafted reply you can edit, copy, or send by email. You can also delete an entire conversation.</p>
      </Section>

      <Section title="Reviews">
        <p>The moderation queue for the public testimonials on the About page.</p>
        <div className="mt-3 space-y-2">
          <Step icon={Star} label="Approve & schedule" description="Set a start date and an auto-remove window (1–365 days) for a review to go public." />
          <Step icon={XCircle} label="Unpublish" description="Pull a live or scheduled review back out of public view." />
          <Step icon={AlertTriangle} label="Delete" description="Remove a review permanently." />
        </div>
      </Section>

      <Section title="Schools">
        <p>Every school on the platform, with full billing and account controls:</p>
        <div className="mt-3 space-y-2">
          <Step icon={CreditCard} label="Verify payments" description="Mark paid, reject with a reason (emailed to the school), or reset to unpaid." />
          <Step icon={FileText} label="Price, due date & invoices" description="Set a price and billing period, set a due date, and send an emailed invoice with a PDF." />
          <Step icon={Bell} label="Notices" description="Send a payment notice to one school or broadcast to all." />
          <Step icon={MessageSquare} label="Internal notes & history" description="Leave admin-only notes and review each school's payment history." />
          <Step icon={Terminal} label="Export / delete" description="Export the list as CSV, or delete a school (which unlinks its students)." />
        </div>
      </Section>

      <Section title="Invites">
        <p>Create school or organization invites, resend them, or delete them — the same invite emails the organization dashboard sends. One-time registration codes for school and organization sign-up are made and revoked here too.</p>
      </Section>

      <Section title="Organizations">
        <p>Every organization, with the same payment, notes, price, due-date, invoice, and history tools as Schools. Deleting an organization unlinks its schools rather than deleting them.</p>
      </Section>

      <Section title="Incidents">
        <p>Backend and database health checks surface here automatically. Resolve an incident once it's fixed, or log one manually. This feeds the public status page.</p>
        <p className="mt-2">At the top, <strong>Live checks</strong> shows the live-site test robot's recent runs. Every 6 hours it loads every public page and, signed in as its own test account, the main student pages. When a check fails twice in a row you get an email — with an AI-written guess at the cause, to check before acting — and the public status page lists an incident until it passes again.</p>
      </Section>

      <Section title="Settings">
        <p>Edits the office-hours text shown on the public Contact page (days, hours, and an optional note), the payment instructions on invoices, the join offer, and the email provider key.</p>
      </Section>

      <Section title="Users">
        <p>How many people have registered, by account type and by where they signed up (website, Android or iPhone app). Test accounts aren't counted.</p>
      </Section>

      <Section title="API">
        <p>Live backend health checks plus a list of every registered API route currently serving traffic.</p>
      </Section>

      <Section title="Blueprint">
        <p>How the app is built, end to end, with saved links to the services behind it.</p>
      </Section>
    </div>
  )
}

// ── FAQ ──────────────────────────────────────────────────────────────────────

function Faq() {
  return (
    <div>
      <HandbookIntro title="Frequently Asked Questions">
        Quick answers to common questions.
      </HandbookIntro>

      <div className="space-y-3">
        {FAQ_ITEMS.map(({ q, a }) => (
          <FaqItem key={q} question={q} answer={a} />
        ))}
      </div>
    </div>
  )
}

// ── Main Help Component ──────────────────────────────────────────────────────

const PANELS = {
  quickstart: QuickStart,
  student: StudentHandbook,
  parent: ParentHandbook,
  volunteer: VolunteerHandbook,
  school: SchoolHandbook,
  school_staff: SchoolStaffHandbook,
  organization: OrganizationHandbook,
  admin: AdminHandbook,
  faq: Faq,
}

// FAQPage + HowTo structured data, built from the same content rendered on
// this page so answer engines (ChatGPT, Perplexity, Google AI Overviews)
// can lift the question/answer pairs and the step-by-step directly. Module
// constant — it never changes, so useSeo's effect stays stable across the
// tab switches that re-render this component.
const HELP_JSON_LD = [
  {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_ITEMS.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  },
  {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: 'How to track volunteer hours with VolunTrack',
    description: 'Set up VolunTrack and log your first verified volunteer hours in a few minutes.',
    step: QUICKSTART_STEPS.map(({ name, text }, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name,
      text,
    })),
  },
]

export default function Help() {
  useSeo({
    title: 'Help & Handbooks',
    description: 'Guides, FAQs, and handbooks for students, parents, volunteers, schools, co-admins, organizations, and admins using VolunTrack.',
    path: '/help',
    jsonLd: HELP_JSON_LD,
  })

  const { user } = useAuth()
  const [tab, setTab] = useState('quickstart')
  const Panel = PANELS[tab] || QuickStart

  const content = (
    <div className="max-w-5xl mx-auto lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-10">
      <nav
        aria-label="Handbook sections"
        className="flex gap-1 overflow-x-auto pb-2 -mx-4 px-4 lg:mx-0 lg:px-0 lg:pb-0 lg:flex-col lg:overflow-visible lg:sticky lg:top-24 lg:self-start"
      >
        <p className="hidden lg:block px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-earth-500">Handbooks</p>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition whitespace-nowrap shrink-0 lg:w-full ${
              tab === t.id ? 'bg-brand-600 text-white' : 'text-earth-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <t.icon className="w-3.5 h-3.5 shrink-0" />
            {t.label}
          </button>
        ))}
      </nav>

      <div className="min-w-0 mt-6 lg:mt-0">
        <Panel />
      </div>
    </div>
  )

  if (user) {
    return (
      <AppLayout title="Help & Handbooks" subtitle="Guides, FAQs, and handbooks for every role">
        {content}
      </AppLayout>
    )
  }

  // Help is public (it's in the site footer), but the app sidebar only leads a
  // signed-out visitor to pages that bounce them home — so they get the same
  // plain header and footer as Terms and Privacy instead.
  return (
    <div className="min-h-screen page-shell">
      <PublicHeader>
        <Link to="/login" className="btn-ghost">Sign in</Link>
        <Link to="/register" className="btn-primary">Get started</Link>
      </PublicHeader>
      <main className="px-4 md:px-8 pb-20">
        <div className="max-w-5xl mx-auto mb-6">
          <h1 className="text-3xl md:text-4xl font-bold">Help &amp; Handbooks</h1>
          <p className="text-earth-500 dark:text-earth-400 mt-1">Guides, FAQs, and handbooks for every role</p>
        </div>
        {content}
      </main>
      <Footer />
    </div>
  )
}
