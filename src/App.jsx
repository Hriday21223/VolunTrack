import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { AuthProvider, useAuth } from '@/hooks/useAuth.jsx'
import { DataProvider, useData } from '@/hooks/useData.jsx'
import { Analytics } from '@vercel/analytics/react'
import MobileTabBar from '@/components/MobileTabBar.jsx'
import BadgeToasts from '@/components/BadgeToasts.jsx'
import ReminderToasts from '@/components/ReminderToasts.jsx'
import ErrorBoundary from '@/components/ErrorBoundary.jsx'
import { isNativeApp } from '@/lib/platform.js'
import { ROUTE_ROLES } from '@/lib/roleAccess.js'
import { readWelcomePending } from '@/lib/welcome.js'

// About is the logged-out landing page served at "/" — kept as a static import
// so the initial route renders without an extra chunk round-trip. Every other
// route is code-split since only one is ever active at a time.
import About from '@/pages/About.jsx'
import AppLock from '@/components/AppLock.jsx'
import SlowServerNotice from '@/components/SlowServerNotice.jsx'
const AppWelcome = lazy(() => import('@/pages/AppWelcome.jsx'))
const Login = lazy(() => import('@/pages/Login.jsx'))
const Register = lazy(() => import('@/pages/Register.jsx'))
const Welcome = lazy(() => import('@/pages/Welcome.jsx'))
const ForgotPassword = lazy(() => import('@/pages/ForgotPassword.jsx'))
const ResetPassword = lazy(() => import('@/pages/ResetPassword.jsx'))
const ResetPin = lazy(() => import('@/pages/ResetPin.jsx'))
const SyncLogin = lazy(() => import('@/pages/SyncLogin.jsx'))
const SsoReturn = lazy(() => import('@/pages/SsoReturn.jsx'))
const Contact = lazy(() => import('@/pages/Contact.jsx'))
const ForSchools = lazy(() => import('@/pages/ForSchools.jsx'))
const JoinSchool = lazy(() => import('@/pages/JoinSchool.jsx'))
const SchoolFlyer = lazy(() => import('@/pages/SchoolFlyer.jsx'))
const InviteLanding = lazy(() => import('@/pages/InviteLanding.jsx'))
const Terms = lazy(() => import('@/pages/Terms.jsx'))
const GuidesIndex = lazy(() => import('@/pages/Guides.jsx').then((m) => ({ default: m.GuidesIndex })))
const GuidePage = lazy(() => import('@/pages/Guides.jsx').then((m) => ({ default: m.GuidePage })))
const Privacy = lazy(() => import('@/pages/Privacy.jsx'))
const NotFound = lazy(() => import('@/pages/NotFound.jsx'))
const CheckIn = lazy(() => import('@/pages/CheckIn.jsx'))
const Dashboard = lazy(() => import('@/pages/Dashboard.jsx'))
const Opportunities = lazy(() => import('@/pages/Opportunities.jsx'))
const OrganizerProfile = lazy(() => import('@/pages/OrganizerProfile.jsx'))
const LogHours = lazy(() => import('@/pages/LogHours.jsx'))
const CalendarView = lazy(() => import('@/pages/CalendarView.jsx'))
const Achievements = lazy(() => import('@/pages/Achievements.jsx'))
const YearInReview = lazy(() => import('@/pages/YearInReview.jsx'))
const Reports = lazy(() => import('@/pages/Reports.jsx'))
const Profile = lazy(() => import('@/pages/Profile.jsx'))
const Settings = lazy(() => import('@/pages/Settings.jsx'))
const Reminders = lazy(() => import('@/pages/Reminders.jsx'))
const Admin = lazy(() => import('@/pages/Admin.jsx'))
const SchoolDashboard = lazy(() => import('@/pages/SchoolDashboard.jsx'))
const SchoolRegister = lazy(() => import('@/pages/SchoolRegister.jsx'))
const OrganizationDashboard = lazy(() => import('@/pages/OrganizationDashboard.jsx'))
const OrganizationRegister = lazy(() => import('@/pages/OrganizationRegister.jsx'))
const Help = lazy(() => import('@/pages/Help.jsx'))
const MyTasks = lazy(() => import('@/pages/MyTasks.jsx'))
const Attendance = lazy(() => import('@/pages/Attendance.jsx'))
const Status = lazy(() => import('@/pages/Status.jsx'))
const VerifyHours = lazy(() => import('@/pages/VerifyHours.jsx'))
const SignCertificate = lazy(() => import('@/pages/SignCertificate.jsx'))
const BadgeCheck = lazy(() => import('@/pages/BadgeCheck.jsx'))
const ParentWaiver = lazy(() => import('@/pages/ParentWaiver.jsx'))
const WriteReference = lazy(() => import('@/pages/WriteReference.jsx'))
const AccountHandover = lazy(() => import('@/pages/AccountHandover.jsx'))
const VerifyTranscript = lazy(() => import('@/pages/VerifyTranscript.jsx'))
const Portfolio = lazy(() => import('@/pages/Portfolio.jsx'))
const ParentDashboard = lazy(() => import('@/pages/ParentDashboard.jsx'))

function RouteFallback() {
  return (
    <div className="min-h-screen bg-[#071117] grid place-items-center">
      <Loader2 className="h-6 w-6 text-brand-500 animate-spin" />
    </div>
  )
}

// `roles` limits a page to the account types it is built for. The API already
// refuses the data; this keeps another role from landing on an empty shell.
function Protected({ children, roles }) {
  const { user } = useAuth()
  const loc = useLocation()
  if (!user) return <Navigate to="/login" state={{ from: loc }} replace />
  // Admin may open every page; anyone else only their own (src/lib/roleAccess.js).
  if (roles && user.role !== 'admin' && !roles.includes(user.role)) return <Navigate to="/" replace />
  return children
}

function PublicOnly({ children }) {
  const { user } = useAuth()
  if (user) return <Navigate to="/" replace />
  return children
}

function AdminProtected({ children }) {
  const { user } = useAuth()
  const loc = useLocation()
  if (!user) return <Navigate to="/login" state={{ from: loc }} replace />
  if (user.role !== 'admin') {
    return <Navigate to="/" replace />
  }
  return children
}

function Home() {
  const { user } = useAuth()
  if (!user) return isNativeApp ? <AppWelcome /> : <About />
  if (user.role === 'parent') return <Navigate to="/parent" replace />
  if (user.role === 'org') return <Navigate to="/organization/dashboard" replace />
  // School accounts are institutions, not volunteers — send them to their own
  // dashboard rather than the personal hour-tracking one, same as org/parent.
  if (user.role === 'school' || user.role === 'school_staff') return <Navigate to="/school/dashboard" replace />
  // Just signed up in this tab (see src/lib/welcome.js).
  if ((user.role === 'student' || user.role === 'volunteer') && readWelcomePending()) return <Navigate to="/welcome" replace />
  return <Protected roles={ROUTE_ROLES['/']}><Dashboard /></Protected>
}

function Shell() {
  const { pendingBadges, dismissBadges } = useData()
  return (
    <>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login"           element={<PublicOnly><Login /></PublicOnly>} />
          <Route path="/register"        element={<PublicOnly><Register /></PublicOnly>} />
          <Route path="/forgot-password" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
          <Route path="/reset-password"  element={<PublicOnly><ResetPassword /></PublicOnly>} />
          <Route path="/reset-pin"       element={<PublicOnly><ResetPin /></PublicOnly>} />
          <Route path="/sync-login"      element={<PublicOnly><SyncLogin /></PublicOnly>} />
          {/* Deliberately not wrapped in PublicOnly — the exchange signs the
              user in mid-render, and PublicOnly would bounce them to "/"
              before this page can honour its own returnTo. */}
          <Route path="/auth/sso/return" element={<SsoReturn />} />
          <Route path="/school/register" element={<SchoolRegister />} />
          <Route path="/organization/register" element={<OrganizationRegister />} />
          <Route path="/about"           element={<About />} />
          <Route path="/contact"         element={<Contact />} />
          <Route path="/for-schools"     element={<ForSchools />} />
          <Route path="/join/:code"      element={<JoinSchool />} />
          <Route path="/invite/:code"    element={<InviteLanding />} />
          <Route path="/terms"           element={<Terms />} />
          <Route path="/guides"          element={<GuidesIndex />} />
          <Route path="/guides/:slug"    element={<GuidePage />} />
          <Route path="/privacy"         element={<Privacy />} />
          <Route path="/status"         element={<Status />} />
          {/* Each tab is its own URL, so one can be linked, bookmarked and
              reloaded. Status itself normalises the value and redirects
              anything unrecognised back to /status. */}
          <Route path="/status/:tab"    element={<Status />} />
          <Route path="/verify-hours"   element={<VerifyHours />} />
          <Route path="/sign-certificate/:token" element={<SignCertificate />} />
          <Route path="/badge/:code" element={<BadgeCheck />} />
          <Route path="/waiver/:token" element={<ParentWaiver />} />
          <Route path="/reference/:token" element={<WriteReference />} />
          <Route path="/handover" element={<AccountHandover />} />
          <Route path="/verify-transcript" element={<VerifyTranscript />} />
          {/* A student's opt-in public volunteer portfolio — open to anyone with the link. */}
          <Route path="/p/:slug"        element={<Portfolio />} />

          <Route path="/"             element={<Home />} />
          <Route path="/welcome"      element={<Protected roles={ROUTE_ROLES['/welcome']}><Welcome /></Protected>} />
          <Route path="/opportunities" element={<Protected roles={ROUTE_ROLES['/opportunities']}><Opportunities /></Protected>} />
          <Route path="/organizers/:id" element={<Protected roles={ROUTE_ROLES['/organizers']}><OrganizerProfile /></Protected>} />
          <Route path="/parent"       element={<Protected roles={ROUTE_ROLES['/parent']}><ParentDashboard /></Protected>} />
          <Route path="/log"          element={<Protected roles={ROUTE_ROLES['/log']}><LogHours /></Protected>} />
          <Route path="/calendar"     element={<Protected roles={ROUTE_ROLES['/calendar']}><CalendarView /></Protected>} />
          <Route path="/achievements" element={<Protected roles={ROUTE_ROLES['/achievements']}><Achievements /></Protected>} />
          <Route path="/year-in-review" element={<Protected roles={ROUTE_ROLES['/year-in-review']}><YearInReview /></Protected>} />
          <Route path="/reminders"    element={<Protected roles={ROUTE_ROLES['/reminders']}><Reminders /></Protected>} />
          <Route path="/reports"      element={<Protected roles={ROUTE_ROLES['/reports']}><Reports /></Protected>} />
          <Route path="/profile"      element={<Protected roles={ROUTE_ROLES['/profile']}><Profile /></Protected>} />
          <Route path="/settings"     element={<Protected roles={ROUTE_ROLES['/settings']}><Settings /></Protected>} />
          <Route path="/help"         element={<Help />} />
          <Route path="/my-tasks"    element={<Protected roles={ROUTE_ROLES['/my-tasks']}><MyTasks /></Protected>} />
          <Route path="/attendance"  element={<Protected roles={ROUTE_ROLES['/attendance']}><Attendance /></Protected>} />
          <Route path="/admin/:tab?"  element={<AdminProtected><Admin /></AdminProtected>} />
          <Route path="/school/dashboard/:tab?/:sub?" element={<Protected roles={ROUTE_ROLES['/school/dashboard']}><SchoolDashboard /></Protected>} />
          <Route path="/school/flyer"  element={<Protected roles={ROUTE_ROLES['/school/flyer']}><SchoolFlyer /></Protected>} />
          <Route path="/organization/dashboard/:tab?" element={<Protected roles={ROUTE_ROLES['/organization/dashboard']}><OrganizationDashboard /></Protected>} />

          {/* The home page is the dashboard; older sign-in links used /dashboard. */}
          <Route path="/checkin/:taskId" element={<Protected roles={ROUTE_ROLES['/checkin']}><CheckIn /></Protected>} />
          <Route path="/dashboard" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      <MobileTabBar />
      <BadgeToasts badgeIds={pendingBadges} onDone={dismissBadges} />
      <ReminderToasts />
    </>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      {/* Apps only: a kept session is restored behind Face ID / fingerprint /
          passcode before anything signed-in renders. */}
      <AppLock>
        <AuthProvider>
          <DataProvider>
            <Shell />
            <SlowServerNotice />
            {/* Vercel Analytics counts website visits; inside the apps its
                script isn't served, and the stores' privacy forms are simpler
                with nothing collected. */}
            {!isNativeApp && <Analytics />}
          </DataProvider>
        </AuthProvider>
      </AppLock>
    </ErrorBoundary>
  )
}
