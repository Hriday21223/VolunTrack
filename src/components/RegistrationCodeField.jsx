import { Link } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import { formatRegistrationCode } from '@/lib/registrationCode.js'

// The one-time code a school or organization needs to register without an
// invite link (#287). Formats as the customer types: XXXX-XXXX-XXXX-XXXX.
export default function RegistrationCodeField({ value, onChange, kind = 'school' }) {
  return (
    <div>
      <label className="label" htmlFor="registration-code">Registration code</label>
      <div className="relative">
        <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-earth-400 pointer-events-none" />
        <input
          id="registration-code"
          type="text"
          className="input pl-9 font-mono uppercase tracking-wider"
          placeholder="XXXX-XXXX-XXXX-XXXX"
          value={value}
          onChange={(e) => onChange(formatRegistrationCode(e.target.value))}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
        />
      </div>
      <p className="text-xs text-earth-400 mt-1">
        {kind === 'organization' ? 'Organization' : 'School'} accounts need a one-time code from VolunTrack.{' '}
        Don&apos;t have one?{' '}
        <Link to="/contact" className="text-brand-700 dark:text-brand-300 font-medium hover:underline">Contact us</Link>
        {' '}for a quote and your code.
      </p>
    </div>
  )
}
