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

// About is the logged-out landing page served at "/" — kept as a static import
// so the initial route renders without an extra chunk round-trip. Every other
// route is code-split since only one is ever active at a time.
import About from '@/pages/About.jsx'
const Login = lazy(() => import('@/pages/Login.jsx'))
const Register = lazy(() => import('@/pages/Register.jsx'))
const ForgotPassword = lazy(() => import('@/pages/ForgotPassword.jsx'))
const ResetPassword = lazy(() => import('@/pages/ResetPassword.jsx'))
const ResetPin = lazy(() => import('@/pages/ResetPin.jsx'))
const SyncLogin = lazy(() => import('@/pages/SyncLogin.jsx'))
const SsoReturn = lazy(() => import('@/pages/SsoReturn.jsx'))
const Contact = lazy(() => import('@/pages/Contact.jsx'))
const Terms = lazy(() => import('@/pages/Terms.jsx'))
const Privacy = lazy(() => import('@/pages/Privacy.jsx'))
const Dashboard = lazy(() => import('@/pages/Dashboard.jsx'))
const Opportunities = lazy(() => import('@/pages/Opportunities.jsx'))
const LogHours = lazy(() => import('@/pages/LogHours.jsx'))
const CalendarView = lazy(() => import('@/pages/CalendarView.jsx'))
const Achievements = lazy(() => import('@/pages/Achievements.jsx'))
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
const ParentDashboard = lazy(() => import('@/pages/ParentDashboard.jsx'))

function RouteFallback() {
  return (
    <div className="min-h-screen bg-[#071117] grid place-items-center">
      <Loader2 className="h-6 w-6 text-brand-500 animate-spin" />
    </div>
  )
}

function Protected({ children }) {
  const { user } = useAuth()
  const loc = useLocation()
  if (!user) return <Navigate to="/login" state={{ from: loc }} replace />
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
  if (!user) return <About />
  if (user.role === 'parent') return <Navigate to="/parent" replace />
  if (user.role === 'org') return <Navigate to="/organization/dashboard" replace />
  return <Protected><Dashboard /></Protected>
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
          <Route path="/terms"           element={<Terms />} />
          <Route path="/privacy"         element={<Privacy />} />
          <Route path="/status"         element={<Status />} />
          <Route path="/verify-hours"   element={<VerifyHours />} />

          <Route path="/"             element={<Home />} />
          <Route path="/opportunities" element={<Protected><Opportunities /></Protected>} />
          <Route path="/parent"       element={<Protected><ParentDashboard /></Protected>} />
          <Route path="/log"          element={<Protected><LogHours /></Protected>} />
          <Route path="/calendar"     element={<Protected><CalendarView /></Protected>} />
          <Route path="/achievements" element={<Protected><Achievements /></Protected>} />
          <Route path="/reminders"    element={<Protected><Reminders /></Protected>} />
          <Route path="/reports"      element={<Protected><Reports /></Protected>} />
          <Route path="/profile"      element={<Protected><Profile /></Protected>} />
          <Route path="/settings"     element={<Protected><Settings /></Protected>} />
          <Route path="/help"         element={<Help />} />
          <Route path="/my-tasks"    element={<Protected><MyTasks /></Protected>} />
          <Route path="/attendance"  element={<Protected><Attendance /></Protected>} />
          <Route path="/admin/:tab?"  element={<AdminProtected><Admin /></AdminProtected>} />
          <Route path="/school/dashboard" element={<Protected><SchoolDashboard /></Protected>} />
          <Route path="/organization/dashboard" element={<Protected><OrganizationDashboard /></Protected>} />

          <Route path="*" element={<Navigate to="/" replace />} />
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
      <AuthProvider>
        <DataProvider>
          <Shell />
          <Analytics />
        </DataProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}
