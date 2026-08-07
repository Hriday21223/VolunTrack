import { useEffect, useState } from 'react'

const SPLASH_DURATION_MS = 700

/**
 * Branded app-launch screen, shown once when the app first mounts. Distinct
 * from RouteFallback (App.jsx), which is the per-route Suspense spinner
 * shown on every lazy route transition.
 */
export default function SplashScreen({ onDone }) {
  const [fadingOut, setFadingOut] = useState(false)

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFadingOut(true), SPLASH_DURATION_MS)
    const doneTimer = setTimeout(() => onDone(), SPLASH_DURATION_MS + 200)
    return () => { clearTimeout(fadeTimer); clearTimeout(doneTimer) }
  }, [onDone])

  return (
    <div
      className={`fixed inset-0 z-50 bg-[#071117] grid place-items-center transition-opacity duration-200 ${fadingOut ? 'opacity-0' : 'opacity-100'}`}
    >
      <div className="flex flex-col items-center gap-3">
        <img src={`${import.meta.env.BASE_URL}logo-icon.webp`} alt="VolunTrack" className="w-16 h-16 object-contain" />
        <p className="font-display font-bold text-2xl text-white tracking-tight">VolunTrack</p>
        <p className="text-sm text-earth-400">Volunteer hour tracking</p>
      </div>
    </div>
  )
}
