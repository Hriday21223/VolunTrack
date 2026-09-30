import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

// The signed-out start screen inside the native apps. On the website "/" is
// the marketing page (About.jsx); someone who has installed the app has
// already been sold, so they get straight to signing in.
export default function AppWelcome() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#071117] text-earth-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-10 h-80 w-80 rounded-full bg-brand-500/25 blur-3xl" />
        <div className="absolute -right-20 bottom-40 h-72 w-72 rounded-full bg-sky-500/10 blur-3xl" />
      </div>

      <div className="relative flex min-h-screen flex-col px-6 pb-10">
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          {/* The same artwork as the home-screen icon (resources/icon-only.png). */}
          <img
            src={`${import.meta.env.BASE_URL}app-icon.png`}
            alt=""
            className="mb-6 h-24 w-24 rounded-[1.6rem] shadow-2xl shadow-brand-900/40"
          />
          <h1 className="font-display text-4xl font-bold tracking-tight">VolunTrack</h1>
          <p className="mt-3 max-w-xs text-base text-earth-300">
            Log your volunteer hours, hit your goals, and share your record with your school.
          </p>
        </div>

        <div className="space-y-3">
          <Link to="/login" className="btn-primary flex w-full items-center justify-center gap-2 py-4 text-base">
            Sign in <ArrowRight className="h-5 w-5" />
          </Link>
          <Link
            to="/register"
            className="flex w-full items-center justify-center rounded-xl border border-white/15 bg-white/5 py-4 text-base font-semibold text-earth-100 active:bg-white/10"
          >
            Create an account
          </Link>
          <p className="pt-3 text-center text-xs text-earth-500">
            By continuing you agree to the{' '}
            <Link to="/terms" className="underline">Terms</Link> and{' '}
            <Link to="/privacy" className="underline">Privacy Policy</Link>.
          </p>
        </div>
      </div>
    </div>
  )
}
