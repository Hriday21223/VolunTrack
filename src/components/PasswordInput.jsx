import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { tr } from '@/lib/i18n.js'

// A password box with a Show / Hide button (#827). Takes the same props as an
// <input>; `type` is managed here. Use it for every password, PIN or secret
// box so people can check what they typed.
export default function PasswordInput({ className = 'input', wrapperClassName = '', ...rest }) {
  const [show, setShow] = useState(false)
  return (
    <div className={`relative ${wrapperClassName}`}>
      <input {...rest} type={show ? 'text' : 'password'} className={`${className} pr-11`} />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-earth-400 hover:text-earth-600 dark:hover:text-earth-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        aria-label={show ? tr('Hide password') : tr('Show password')}
        aria-pressed={show}
        title={show ? tr('Hide password') : tr('Show password')}
      >
        {show ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
      </button>
    </div>
  )
}
