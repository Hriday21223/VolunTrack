import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import Card from '@/components/Card.jsx'
import Footer from '@/components/Footer.jsx'
import PublicHeader from '@/components/PublicHeader.jsx'
import { useSeo } from '@/hooks/useSeo.js'
import { tr } from '@/lib/i18n.js'

export default function Privacy() {
  useSeo({
    title: 'Privacy Policy',
    description: 'How VolunTrack collects, uses, and protects your data.',
    path: '/privacy',
  })

  useEffect(() => {
    // Honor a deep link like /privacy#account-deletion; otherwise start at the top.
    const target = window.location.hash && document.getElementById(window.location.hash.slice(1))
    if (target) target.scrollIntoView()
    else window.scrollTo(0, 0)
  }, [])

  return (
    <div className="min-h-screen page-shell">
      <PublicHeader>
        <Link to="/terms" className="btn-ghost hidden sm:inline-flex">Terms</Link>
        <Link to="/login" className="btn-ghost"><ArrowLeft className="w-4 h-4" /> Back to sign in</Link>
      </PublicHeader>

      <main className="max-w-3xl mx-auto px-4 md:px-8 pb-20">
        <h1 className="text-3xl md:text-4xl font-bold text-center">Privacy Policy</h1>
        <p className="text-center text-earth-500 dark:text-earth-400 mt-2 text-sm">Last updated: October 23, 2026</p>

        <Card className="mt-10 space-y-6 text-sm text-earth-700 dark:text-earth-200">
          <Section title="Data We Collect">
            <ul className="list-disc pl-5 space-y-1.5">
              <li><strong>Name and email address</strong> — required to create and manage your account.</li>
              <li><strong>Sign-up code</strong> — when you create an account we email you a 6-digit code to confirm the address is yours. We keep only a scrambled (hashed) copy, it stops working after 10 minutes, and it is deleted once used; expired codes are cleaned up afterwards.</li>
              <li><strong>School, grade and student ID</strong> — only if you enter them, so your school and your reports show the right details.</li>
              <li><strong>Date of birth</strong> — asked when you create an account, only to apply our age rules: students under 13 need a parent or guardian&apos;s approval, Volunteer Task Maker and parent accounts are for adults 18 and up. We don&apos;t store it; we keep only whether a student is under 13. If a date entered is too young for the account type, your device remembers that for a day so the rules can&apos;t be skipped by changing it, and this never leaves your device.</li>
              <li><strong>Where you signed up</strong> — whether your account was created on the website, in the Android app or in the iPhone app. We use it only to count sign-ups, so we know which versions of VolunTrack people use.</li>
              <li><strong>{tr('App language')}</strong> — {tr('the language you pick in the app (English or Spanish). If you’re signed in, we save it with your account so the emails we send you, such as the weekly summary for parents and the “We miss you” email, come in that language. It’s replaced when you pick another, and deleted with your account.')}</li>
              <li><strong>Text size and contrast</strong> — if you make text bigger or turn on high contrast, the choice is saved on that device only and never sent to us.</li>
              <li><strong>Year in review</strong> — your yearly summary is worked out on your device from the hours you&apos;ve logged; nothing extra is stored. It leaves your device only if you share or download it yourself, and sharing sends totals only, not names, places or notes.</li>
              <li><strong>School sign-in</strong> — if your school has set up single sign-on, we receive your name, email address, and an account identifier from your school&apos;s sign-in provider (such as Google or Microsoft). We never see your school password.</li>
              <li><strong>Volunteer hours, activity descriptions, and locations</strong> — the core data you log in the app, plus any extra fields your school or organization requires on an entry.</li>
              <li><strong>Personal goals</strong> — the name, hour target, deadline and cause (if you pick one) of goals you set, so they show on all your devices. Deleting a goal or your account deletes it.</li>
              <li><strong>Verification details</strong> — when you ask someone to verify an entry, the supervisor&apos;s name and email, the organization&apos;s name, address and phone, and the signature the supervisor draws when they approve from the emailed link. A supervisor who signs in person, on your device, leaves that drawing on your device only. When a task organizer signs off your hours from their VolunTrack account, their signature is stored with the entry so you and your school can see it.</li>
              <li><strong>Your signature</strong> — only if your school asks you to sign your entries. The drawing stays on your device; we only record that the entry was signed, and, if your school uses its own online form, that you said you sent it.</li>
              <li><strong>Task cover photos</strong> — if you add a photo to a volunteer task you post, we store it on our servers with the task. Your device shrinks it and removes hidden details such as the camera and the place it was taken before upload, and our server removes them again. It is shown with the task to anyone who can see the task on Opportunities, including signed-in students. Remove or replace it any time from My Tasks; it is deleted when you do, when the task or your account is deleted, or if we remove it after a report. Please don&apos;t upload photos where volunteers can be identified without their permission.</li>
              <li><strong>Task organizer contact</strong> — when you create a volunteer task, the email you give is shown to the volunteers you approve, so they can ask you to sign off their hours.</li>
              <li><strong>Proof of service</strong> — photos or documents you attach to an entry. See <em>Proof files</em> below for where these are held.</li>
              <li><strong>Access records</strong> — when a school or organization staff member opens a student&apos;s record, we record who did it and when, along with the IP address and browser, so that access to a minor&apos;s record can be accounted for.</li>
              <li><strong>Billing details</strong> — for school and organization accounts only: invoices, payment confirmations you submit, and any discount or referral code used.</li>
              <li><strong>Your location</strong> — only with your permission, to fill in where you volunteered and to show volunteer tasks near you. In the mobile apps it is asked for only when you tap <em>Use current location</em> or turn on nearby tasks. You can always edit or clear a filled-in location.</li>
              <li><strong>Error reports</strong> — when something breaks in the website or the app, the error message, technical details, the page it happened on, your browser or device type and the app version are sent to us so we can fix it. Your name, email and account are not attached, and nothing you typed is included. We keep the most recent few hundred.</li>
              <li><strong>Reports and blocks</strong> — if you report a volunteer task, the reason and any details you add, and who sent it, so we can review it; the organizer isn't told who reported. If you block an organizer, we keep that so their tasks stay hidden from you and their messages don't reach you.</li>
              <li><strong>Friends you invite to a task</strong> — if you invite friends to a volunteer task, we email each address you enter once, with a link to the task. We don't keep the addresses: only a one-way hash of each, so we can limit you to five invites per task and recognise the friend if they sign up from the link. When they do, we record that you invited them and show their organizer that they came with you. Deleting either account removes it.</li>
              <li><strong>In-app notifications</strong> — the bell at the top of the app lists updates for you, such as a sign-up being approved, a waitlist spot opening, a volunteer running late or cancelling on the day, a new task from an organizer you follow, a thank-you note after a task, or a decision on your hours. Each one is stored on our servers with when you read it, is visible only to you, and is deleted after 90 days or when you delete your account.</li>
              <li><strong>&quot;We miss you&quot; emails</strong> — if you&apos;re a student and haven&apos;t logged any hours for a month, we may send you one email and a bell notification suggesting up to three open volunteer tasks, chosen from the places of tasks you&apos;ve signed up for or logged before (we don&apos;t track where you are for this). We send at most one a month and keep when we last sent it. To turn them off, use <em>Stop these emails</em> in the email or the switch in Settings, which can also turn them back on.</li>
              <li><strong>Organizer profile</strong> — if you post volunteer tasks, you can add an About (up to 500 characters), a website and the causes you work on in Settings. These, your name, your upcoming open tasks, your average rating (once three or more people have rated) and the total approved volunteer hours given at your tasks are shown to signed-in students on your organizer page. Your email and the names of your volunteers are never shown there. Clear the fields to remove them; they&apos;re deleted with your account.</li>
              <li><strong>Guests you bring to a task</strong> — if an organizer allows guests and you bring some (up to 3), we store how many are coming and any first names you give, with your sign-up, and show them to that task's organizer and on their printed sign-in sheet. Guests have no accounts, and we record nothing else about them — not their hours, contact details or age. Removing guests, cancelling your sign-up or deleting your account deletes them.</li>
              <li><strong>Organizers you follow</strong> — if you follow an organizer on Opportunities, we keep who you follow and when we last emailed you about them, so we can email you when they post a new task (at most once an hour). The organizer isn't shown who follows them. Unfollowing deletes it.</li>
              <li><strong>Causes you care about</strong> — if you pick causes (volunteer categories such as Environmental or Animal Welfare) in Settings or on Opportunities, we store that list with your account to show matching tasks under <em>For you</em> on Opportunities. It isn't shown to schools, parents or organizers. Clear it in Settings any time; it's deleted with your account.</li>
              <li><strong>Saved tasks</strong> — if you save a task on Opportunities, we keep which task you saved, when, and whether we've sent you the one reminder about it, so we can show your Saved list and remind you in the app if it's coming up or filling up before you've signed up. The organizer isn't shown who saved their task. Unsaving deletes it, and it's deleted with the task or your account.</li>
              <li><strong>Calendar feed link</strong> — if you turn on the calendar feed in Settings, we store a random secret that is part of your feed link. Anyone who has the link can see the tasks you signed up for or posted (titles, dates, times and places) without signing in, so share it only with your own calendar app. Reset link replaces the secret and the old link stops working; deleting your account deletes it.</li>
              <li><strong>Volunteer portfolio</strong> — off unless you, a student aged 13 or older, turn it on in Settings. When it&apos;s on, anyone with its link can see a public page, without signing in, showing your name (first name and last initial unless you choose your full name), your total hours, and the parts you leave ticked: hours by category, badges, and each activity&apos;s title, date and hours. Your school&apos;s name appears only if you tick it. Only hours an organizer or supervisor approved are included, and never where you volunteered, who supervised you, your notes, proof, signatures, your school&apos;s extra fields or anyone&apos;s contact details. We store whether it&apos;s on, your choices and the random code in the link, and record when you change them. Search engines are asked not to list the page. Turning it off hides the page immediately, <em>Get a new link</em> makes the old link stop working, and deleting your account deletes it.</li>
              <li><strong>School leaderboard</strong> — off unless you, a student aged 13 or older, choose <em>Join the leaderboard</em> on your dashboard. When you join, other students at your school (and only your school) can see your first name, last initial and your approved volunteer hours for this month and this school year, ranked among the students who joined. Nothing else is shown — not your full name, email, school details or entries. We store only whether you joined. <em>Leave</em> takes you off at once, your school can turn the leaderboard off for everyone, and deleting your account removes you. Students under 13 never appear on it or see it.</li>
              <li><strong>Task ratings</strong> — if you rate a task you volunteered at, we keep your stars, any comment you write and when, linked to your account so you can change it. The task's organizer sees the stars, comment and date, but never your name. Other students see only an organizer's average and the number of ratings, once there are three or more. Ratings are deleted with your account.</li>
              <li><strong>{tr('Questions to organizers')}</strong> — {tr('if you ask a question on a volunteer task, we keep the question, your account and when you asked it, plus the organizer’s answer and when they gave it. Until it’s answered only you and the organizer see it; once answered, the question and answer are shown to everyone who can see the task, without your name. The organizer sees your first name and last initial. The organizer can hide or delete a question, and you can delete your own. Questions are deleted with the task or with your account.')}</li>
              <li><strong>Meeting point and day-of contact</strong> — when you post a task you can add where volunteers should meet and a day-of contact (a name and phone number). Only you and the volunteers you approve can see them — in the app, in the reminder email the day before and in their own calendar feed — never other students or anyone browsing Opportunities. They&apos;re stored with the task.</li>
              <li><strong>Running late and can&apos;t make it</strong> — on the day of a task, an approved volunteer can tell the organizer they&apos;re running late (with an optional rough arrival time) or that they can&apos;t make it. We keep the running-late time with the sign-up and show it to the organizer next to the volunteer&apos;s name; can&apos;t make it cancels the sign-up. The organizer gets a bell notification either way.</li>
              <li><strong>Task co-hosts</strong> — a task&apos;s organizer can add up to three other Volunteer Task Maker accounts, by email, as co-hosts. We keep who co-hosts which task, who added them and when. A co-host sees what the organizer sees for that task only: the names, emails, sign-up status and attendance of its volunteers, and the hours logged for it, and can approve sign-ups, take attendance and sign off those hours. Co-hosts and the organizer see each other&apos;s name and email. If an address can&apos;t be added we don&apos;t say whether it has an account. Removing a co-host, or a co-host leaving, ends their access straight away; it&apos;s deleted with the task or either account.</li>
              <li><strong>Thank-you notes</strong> — once a task is over, its organizer can send one short thank-you note to the volunteers who were marked present or checked in. We keep the note, who sent it and when, linked to the task, and show it on that task in each recipient&apos;s Attendance, as a bell notification and in one email to each of them (never a shared thread). Anyone who blocked the organizer doesn&apos;t get it. The note is deleted with the task, and the sender&apos;s link to it is removed when they delete their account.</li>
              <li><strong>Messages you send us</strong> — your name, email address and message when you use the contact form, kept so we can reply.</li>
              <li><strong>App reviews</strong> — if you rate VolunTrack, your rating, comment, and the name you give. A review appears publicly on our website only if you agree to it and we approve it.</li>
              <li><strong>Passkeys</strong> — if you add a passkey as a sign-in step, we store its public key, an identifier for it, a name such as &quot;iPhone&quot;, and when it was added and last used. The private key stays on your device (or in your iCloud Keychain or Google Password Manager); we never receive it.</li>
              <li><strong>Face ID, Touch ID and fingerprint (apps only)</strong> — if you choose <em>Keep me signed in</em>, the app asks your phone to confirm it&apos;s you before it opens. Your phone does the check and only tells the app whether it passed: your face or fingerprint data never leaves your device and never reaches us. Your sign-in is kept in your phone&apos;s secure storage (the iOS Keychain or Android Keystore) and removed when you sign out.</li>
              <li><strong>Sync PIN</strong> — if you generate one to sign in on another device, it works once, stops working after 15 minutes, and is then cleared from our database.</li>
              <li><strong>Camera access</strong> — used to scan QR codes when syncing your account across devices, and, if you choose, to photograph proof of service. QR scans are never uploaded or stored; a proof photo is handled like any other proof file (see <em>Proof files</em> below).</li>
              <li><strong>Notifications</strong> — in the mobile app, only if you allow them, to deliver the reminders you set. They are scheduled on your phone itself, so your reminders never reach us.</li>
            </ul>
          </Section>

          <Section title="How We Use Your Data">
            <p>Your data is used exclusively to provide the VolunTrack service: tracking volunteer hours, generating reports, running volunteer tasks, and managing school/organization participation.</p>
            <p className="mt-2">That includes the emails and in-app notifications the service needs — sign-in codes, sign-up decisions, reminders about tasks you joined, and messages and thank-you notes from your task&apos;s organizer — and optional ones you can turn off, such as the parent weekly summary and &quot;We miss you&quot; emails. We never send marketing for anyone else and never sell your data.</p>
          </Section>

          <Section title="Data Storage">
            <p>When you create an account, your name, email address and a hashed version of your password are stored in our PostgreSQL database. From then on the hours you log are also saved to our servers as you enter them — this is what lets your school, a linked parent, and your other devices see them. That happens as soon as you are signed in; it is not limited to schools that have set up their own storage. Your browser keeps its own copy as well. Traffic between the app and our servers is encrypted with HTTPS.</p>
          </Section>

          <Section title="Proof Files and Documents">
            <p>Where your school or organization has connected its own storage, both the proof you attach to an entry and the reports you submit to your school upload straight from your device to <em>their</em> storage. We keep only a reference to the file and never hold the file itself. Those files are then controlled by that school, under their own policies, and we cannot delete them for you.</p>
            <p className="mt-2">Where no such storage is connected, a proof file you attach stays on your device, and a report you submit to your school is stored by us until you or the school deletes it.</p>
          </Section>

          <Section title="Analytics">
            <p>We use privacy-friendly, anonymous page-view analytics (Vercel Analytics) to understand overall usage. It does not use cookies and does not track you individually across sites. The iOS and Android apps don&apos;t load it.</p>
          </Section>

          <Section title="Data Retention">
            <p>We keep your data for as long as your account exists.</p>
            <p className="mt-2">Some things outlive an account on purpose, or are beyond our reach:</p>
            <ul className="list-disc pl-5 space-y-1.5 mt-2">
              <li><strong>Access records</strong> are kept for up to 400 days, so that access to student records stays accountable after the fact. The account holder&apos;s identity is removed from them when an account is erased.</li>
              <li><strong>Proof files and documents in a school&apos;s own storage</strong> belong to that school. Ask them to delete those.</li>
              <li><strong>Transcripts you have exported</strong> are files you chose to hand to someone. We cannot withdraw a copy someone else holds.</li>
            </ul>
          </Section>

          <Section id="account-deletion" title="Account Deletion">
            <p>You can delete your account from the Settings page in the app. You will be prompted to type &quot;delete&quot; and confirm with your password (or, if you sign in through your school, your email address) before the action completes.</p>
            <p className="mt-2">This erases your account and everything attached to it — volunteer logs, goals, reminders, documents you uploaded to a school, and any parent link — from our servers as well as from the device you are using. It cannot be undone, and the exceptions under <em>Data Retention</em> still apply.</p>
            <p className="mt-2">School, organization, and administrator accounts cannot be deleted this way, because doing so would remove records other people rely on. Contact us and we will close or transfer the account properly.</p>
          </Section>

          <Section title="Third-Party Sharing">
            <p>We do not sell or trade your personal data. We share it only with the schools, organizations, or linked parent accounts you explicitly connect to (for example, via a school code or family link code), and only for the purpose of hour tracking and verification. A linked parent also sees the volunteer tasks a student has signed up for — the task, its date, time and place, the organizer&apos;s name, and whether the student is approved, waiting, on the waitlist or checked in — but not the organizer&apos;s other contact details or anyone else who signed up.</p>
            <p className="mt-2">If you move to another school, your whole record, including past entries, moves to the new school only once it accepts the transfer; from then on your former school no longer sees it. Files already held in your former school&apos;s own storage stay there.</p>
            <p className="mt-2">For outdoor tasks happening in the next week, our server asks Open-Meteo (open-meteo.com), a free weather service, for the forecast at the task&apos;s location. It receives only the task&apos;s map coordinates, rounded to about a kilometre, and the date — never your name, account, or location, and your browser does not contact it.</p>
          </Section>

          <Section title="Service Providers">
            <p>We use trusted cloud infrastructure providers — for database hosting, backend hosting, email delivery, bot protection on public forms, place search (the text you type and an approximate position, only when you search for a place), and analytics — strictly to run the service. They process your data on our behalf and do not use it for their own purposes.</p>
          </Section>

          <Section title="Children's Privacy">
            <p>VolunTrack is used by students and volunteers of all ages. We only collect information that is necessary for the service. When you sign up yourself we ask for your date of birth (which we don&apos;t keep). If you are under 13, we ask for a parent or guardian&apos;s email address and send them a request to approve the account. The account is locked until they approve; if they decline, or do not answer within 14 days, it is deleted. We use that email address only for this request and, while no parent account is linked to the child, to ask the same parent or guardian to approve each volunteer task the child signs up for, by a one-time link we store with the sign-up and delete once they answer. Until a parent approves a task sign-up, the task&apos;s organizer does not see it. An account your school creates for you, or that you reach through your school&apos;s sign-in, is covered by your school&apos;s consent instead. If you believe a child has provided more information than necessary, please contact us.</p>
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

// `id` makes a section linkable — Google Play's listing requires a web URL
// for account deletion, and it points at /privacy#account-deletion.
function Section({ id, title, children }) {
  return (
    <div id={id} className={id ? 'scroll-mt-24' : undefined}>
      <h2 className="font-display font-semibold text-base mb-1.5">{title}</h2>
      {children}
    </div>
  )
}
