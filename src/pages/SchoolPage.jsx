import { useEffect } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth.jsx'
import { setTenantCode } from '@/lib/tenant.js'

// /s/<school code> (#930): a school's own address on the shared site. It
// remembers the school for this tab and opens sign-in with that school's
// logo, colour, name and school sign-in button. Signed in already: home.
export default function SchoolPage() {
  const { code } = useParams()
  const { user } = useAuth()
  const valid = /^[a-z]+-?\d{3,5}$/i.test(code || '')
  useEffect(() => { if (valid) setTenantCode(code) }, [code, valid])
  if (user) return <Navigate to="/" replace />
  return <Navigate to={valid ? '/login' : '/'} replace />
}
