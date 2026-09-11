import { useEffect, useState } from 'react'
import { CreditCard } from 'lucide-react'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

const FIELDS = [
  ['bankName', 'Bank'],
  ['accountName', 'Account name'],
  ['accountNumber', 'Account number'],
  ['routingNumber', 'Routing number'],
  ['swift', 'SWIFT/BIC'],
]

/**
 * "How to pay" — the account ID that identifies this customer, plus the bank
 * details the admin filled in under Admin → Settings. Mirrors
 * paymentInstructionsHtml() in server/email.js so a school sees the same block
 * in the app as in the invoice email. Renders nothing until the account ID is
 * known, and hides the bank section entirely when the admin hasn't set one up.
 */
export default function PaymentDetails({ accountCode, className = '' }) {
  const [instructions, setInstructions] = useState(null)

  useEffect(() => {
    // Authenticated: these are bank details, not public site content.
    const token = localStorage.getItem('voluntrack:auth_token')
    if (!token) return
    let cancelled = false
    fetch(`${apiUrl}/settings/payment-instructions`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled && data && Object.keys(data).length > 0) setInstructions(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (!accountCode) return null

  const rows = FIELDS
    .map(([key, label]) => [label, instructions?.[key]])
    .filter(([, value]) => Boolean(value))

  return (
    <div className={`text-sm rounded-xl bg-earth-500/5 p-3 ${className}`}>
      <p className="font-medium flex items-center gap-2">
        <CreditCard className="w-4 h-4 text-brand-600" /> How to pay
      </p>
      <dl className="mt-2 space-y-1">
        <div className="flex gap-2">
          <dt className="text-earth-500 w-32 shrink-0">Account ID</dt>
          <dd className="font-mono">{accountCode}</dd>
        </div>
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-2">
            <dt className="text-earth-500 w-32 shrink-0">{label}</dt>
            <dd className="break-all">{value}</dd>
          </div>
        ))}
        <div className="flex gap-2">
          <dt className="text-earth-500 w-32 shrink-0">Reference</dt>
          <dd>{instructions?.reference || `Quote ${accountCode} on your transfer`}</dd>
        </div>
      </dl>
      {instructions?.notes && (
        <p className="text-xs text-earth-500 mt-2 whitespace-pre-line">{instructions.notes}</p>
      )}
    </div>
  )
}
