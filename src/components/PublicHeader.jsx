import { Link } from 'react-router-dom'

// Brand header for the public pages (Terms, Privacy, Contact, Status, and
// Help when signed out). Each page passes its own links on the right.
export default function PublicHeader({ children }) {
  return (
    <header className="px-4 md:px-8 py-5 flex items-center justify-between">
      <Link to="/" className="flex items-center gap-2.5">
        <img src={`${import.meta.env.BASE_URL}logo-icon.webp`} alt="" className="w-9 h-9 object-contain" />
        <span className="font-display font-bold text-lg">VolunTrack</span>
      </Link>
      <div className="flex items-center gap-2">{children}</div>
    </header>
  )
}
