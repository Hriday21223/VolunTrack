import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/hooks/useAuth.jsx'
import { DataProvider, useData } from '@/hooks/useData.jsx'
import { Analytics } from '@vercel/analytics/react'
import MobileTabBar from '@/components/MobileTabBar.jsx'
import BadgeToasts from '@/components/BadgeToasts.jsx'
import ReminderToasts from '@/components/ReminderToasts.jsx'

import Login from '@/pages/Login.jsx'
import Register from '@/pages/Register.jsx'
import ForgotPassword from '@/pages/ForgotPassword.jsx'
import ResetPassword from '@/pages/ResetPassword.jsx'
import ResetPin from '@/pages/ResetPin.jsx'
import SyncLogin from '@/pages/SyncLogin.jsx'
import About from '@/pages/About.jsx'
import Contact from '@/pages/Contact.jsx'
import Dashboard from '@/pages/Dashboard.jsx'
import LogHours from '@/pages/LogHours.jsx'
import CalendarView from '@/pages/CalendarView.jsx'
import Achievements from '@/pages/Achievements.jsx'
import Reports from '@/pages/Reports.jsx'
import Profile from '@/pages/Profile.jsx'
import Settings from '@/pages/Settings.jsx'
import Reminders from '@/pages/Reminders.jsx'
import Admin from '@/pages/Admin.jsx'
import SchoolDashboard from '@/pages/SchoolDashboard.jsx'
import SchoolRegister from '@/pages/SchoolRegister.jsx'
import Help from '@/pages/Help.jsx'
import MyTasks from '@/pages/MyTasks.jsx'
import Status from '@/pages/Status.jsx'
import VerifyHours from '@/pages/VerifyHours.jsx'
import ParentDashboard from '@/pages/ParentDashboard.jsx'

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
  return <Protected><Dashboard /></Protected>
}

function Shell() {
  const { pendingBadges, dismissBadges } = useData()
  return (
    <>
      <Routes>
        <Route path="/login"           element={<PublicOnly><Login /></PublicOnly>} />
        <Route path="/register"        element={<PublicOnly><Register /></PublicOnly>} />
        <Route path="/forgot-password" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
        <Route path="/reset-password"  element={<PublicOnly><ResetPassword /></PublicOnly>} />
        <Route path="/reset-pin"       element={<PublicOnly><ResetPin /></PublicOnly>} />
        <Route path="/sync-login"      element={<PublicOnly><SyncLogin /></PublicOnly>} />
        <Route path="/school/register" element={<SchoolRegister />} />
        <Route path="/about"           element={<About />} />
        <Route path="/contact"         element={<Contact />} />
        <Route path="/status"         element={<Status />} />
        <Route path="/verify-hours"   element={<VerifyHours />} />

        <Route path="/"             element={<Home />} />
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
        <Route path="/admin"        element={<AdminProtected><Admin /></AdminProtected>} />
        <Route path="/school/dashboard" element={<Protected><SchoolDashboard /></Protected>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <MobileTabBar />
      <BadgeToasts badgeIds={pendingBadges} onDone={dismissBadges} />
      <ReminderToasts />
    </>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <DataProvider>
        <Shell />
        <Analytics />
      </DataProvider>
    </AuthProvider>
  )
}
