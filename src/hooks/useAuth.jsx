import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { keys, read, write, remove } from '@/lib/storage.js'
import {
  findUserByEmail, verifyPassword, createUser, updateUser as persistUser,
  deleteUser, clearUserData, verifyPin, hashPin, hashPassword, sendPinResetCode,
  isResetPinCodeValid, clearPinResetCode,
  sendPasswordResetCode, isResetPasswordCodeValid, clearPasswordResetCode,
  findUserBySyncPin, updateSyncPin,
} from '@/api/index.js'

const AuthContext = createContext(null)

const SESSION_KEY = `${keys.user}::session`

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => read(SESSION_KEY, null))

  // Keep the session in sync across tabs.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === SESSION_KEY) setUser(e.newValue ? JSON.parse(e.newValue) : null)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Refresh user from backend on mount (syncs schoolId, role, etc.)
  useEffect(() => {
    const token = localStorage.getItem('voluntrack:auth_token')
    if (!token) return
    const apiUrl = import.meta.env.VITE_API_URL || '/api'
    fetch(`${apiUrl}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.user) {
          write(SESSION_KEY, data.user)
          setUser(data.user)
        }
      })
      .catch(() => {})
  }, [])

  const login = useCallback(async (email, password) => {
    // Try backend API first. Only a genuinely unreachable backend (the
    // fetch itself throwing — offline, static-host demo, etc.) falls back
    // to the local-only account. A real response from the backend (wrong
    // password, unknown email, etc.) must surface as a real error instead
    // of silently retrying against a local account that may not match —
    // that used to mask real failures and leave the session with no auth
    // token, breaking every server-backed feature with no explanation.
    const apiUrl = import.meta.env.VITE_API_URL || '/api'
    let response
    try {
      response = await fetch(`${apiUrl}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      })
    } catch {
      response = null
    }

    if (response) {
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || 'Login failed')
      }

      const data = await response.json()

      // 2FA required — return temp token for the TOTP challenge step
      if (data.requiresTotp) {
        return { requiresTotp: true, tempToken: data.tempToken }
      }

      // SMS 2FA required — a code was just texted to the user's phone
      if (data.requiresSms) {
        return { requiresSms: true, tempToken: data.tempToken, devCode: data.devCode }
      }

      // Store the token for future authenticated requests
      localStorage.setItem('voluntrack:auth_token', data.token)

      // Store user session
      write(SESSION_KEY, data.user)
      setUser(data.user)
      return data.user
    }

    // Backend unreachable — fall back to local storage for demo mode.
    const account = findUserByEmail(email)
    if (!account) throw new Error('No account with that email.')
    if (!verifyPassword(account, password)) throw new Error('Incorrect password.')
    const { passwordHash, pinHash, resetPinCode, resetPinCodeExpiresAt, ...safe } = account
    write(SESSION_KEY, safe)
    setUser(safe)
    return safe
  }, [])

  const verifyTotp = useCallback(async (tempToken, code) => {
    const apiUrl = import.meta.env.VITE_API_URL || '/api'
    const response = await fetch(`${apiUrl}/auth/totp/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempToken, code }),
    })
    if (!response.ok) {
      const err = await response.json()
      throw new Error(err.error || 'Invalid code')
    }
    const data = await response.json()
    localStorage.setItem('voluntrack:auth_token', data.token)
    write(SESSION_KEY, data.user)
    setUser(data.user)
    return data.user
  }, [])

  const verifyBackupCode = useCallback(async (email, code) => {
    const apiUrl = import.meta.env.VITE_API_URL || '/api'
    const response = await fetch(`${apiUrl}/auth/totp/backup-recovery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    })
    if (!response.ok) {
      const err = await response.json()
      throw new Error(err.error || 'Invalid backup code')
    }
    const data = await response.json()
    localStorage.setItem('voluntrack:auth_token', data.token)
    write(SESSION_KEY, data.user)
    setUser(data.user)
    return data.user
  }, [])

  const verifySms = useCallback(async (tempToken, code) => {
    const apiUrl = import.meta.env.VITE_API_URL || '/api'
    const response = await fetch(`${apiUrl}/auth/sms/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempToken, code }),
    })
    if (!response.ok) {
      const err = await response.json()
      throw new Error(err.error || 'Invalid code')
    }
    const data = await response.json()
    localStorage.setItem('voluntrack:auth_token', data.token)
    write(SESSION_KEY, data.user)
    setUser(data.user)
    return data.user
  }, [])

  const resendSmsChallenge = useCallback(async (tempToken) => {
    const apiUrl = import.meta.env.VITE_API_URL || '/api'
    const response = await fetch(`${apiUrl}/auth/sms/resend-challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempToken }),
    })
    if (!response.ok) {
      const err = await response.json()
      throw new Error(err.error || 'Could not resend code')
    }
    return response.json()
  }, [])

  const setupSms = useCallback(async (phone) => {
    const token = localStorage.getItem('voluntrack:auth_token')
    if (!token) throw new Error('Not authenticated')
    const apiUrl = import.meta.env.VITE_API_URL || '/api'
    const response = await fetch(`${apiUrl}/auth/sms/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ phone }),
    })
    if (!response.ok) {
      const err = await response.json()
      throw new Error(err.error || 'Failed to send verification code')
    }
    return response.json()
  }, [])

  const resendSmsSetup = useCallback(async () => {
    const token = localStorage.getItem('voluntrack:auth_token')
    if (!token) throw new Error('Not authenticated')
    const apiUrl = import.meta.env.VITE_API_URL || '/api'
    const response = await fetch(`${apiUrl}/auth/sms/resend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    })
    if (!response.ok) {
      const err = await response.json()
      throw new Error(err.error || 'Could not resend code')
    }
    return response.json()
  }, [])

  const verifySmsSetup = useCallback(async (code) => {
    const token = localStorage.getItem('voluntrack:auth_token')
    if (!token) throw new Error('Not authenticated')
    const apiUrl = import.meta.env.VITE_API_URL || '/api'
    const response = await fetch(`${apiUrl}/auth/sms/verify-setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code }),
    })
    if (!response.ok) {
      const err = await response.json()
      throw new Error(err.error || 'Invalid code')
    }
    const data = await response.json()
    write(SESSION_KEY, data.user)
    setUser(data.user)
    return data.user
  }, [])

  const disableSms = useCallback(async (password) => {
    const token = localStorage.getItem('voluntrack:auth_token')
    if (!token) throw new Error('Not authenticated')
    const apiUrl = import.meta.env.VITE_API_URL || '/api'
    const response = await fetch(`${apiUrl}/auth/sms/disable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ password }),
    })
    if (!response.ok) {
      const err = await response.json()
      throw new Error(err.error || 'Failed to disable SMS 2FA')
    }
    const data = await response.json()
    write(SESSION_KEY, data.user)
    setUser(data.user)
    return data.user
  }, [])

  const setupTotp = useCallback(async () => {
    const token = localStorage.getItem('voluntrack:auth_token')
    if (!token) throw new Error('Not authenticated')
    const apiUrl = import.meta.env.VITE_API_URL || '/api'
    const response = await fetch(`${apiUrl}/auth/totp/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    })
    if (!response.ok) {
      const err = await response.json()
      throw new Error(err.error || 'Failed to set up 2FA')
    }
    return response.json()
  }, [])

  const verifyTotpSetup = useCallback(async (code) => {
    const token = localStorage.getItem('voluntrack:auth_token')
    if (!token) throw new Error('Not authenticated')
    const apiUrl = import.meta.env.VITE_API_URL || '/api'
    const response = await fetch(`${apiUrl}/auth/totp/verify-setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code }),
    })
    if (!response.ok) {
      const err = await response.json()
      throw new Error(err.error || 'Invalid code')
    }
    const data = await response.json()
    write(SESSION_KEY, data.user)
    setUser(data.user)
    return data.user
  }, [])

  const disableTotp = useCallback(async (password) => {
    const token = localStorage.getItem('voluntrack:auth_token')
    if (!token) throw new Error('Not authenticated')
    const apiUrl = import.meta.env.VITE_API_URL || '/api'
    const response = await fetch(`${apiUrl}/auth/totp/disable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ password }),
    })
    if (!response.ok) {
      const err = await response.json()
      throw new Error(err.error || 'Failed to disable 2FA')
    }
    const data = await response.json()
    write(SESSION_KEY, data.user)
    setUser(data.user)
    return data.user
  }, [])

  const loginWithPin = useCallback(async (email, pin) => {
    const account = findUserByEmail(email)
    if (!account) throw new Error('No account with that email.')
    if (!verifyPin(account, pin)) throw new Error('Incorrect PIN.')
    const { passwordHash, pinHash, resetPinCode, resetPinCodeExpiresAt, ...safe } = account
    write(SESSION_KEY, safe)
    setUser(safe)
    return safe
  }, [])

  const loginWithSyncPin = useCallback(async (syncPin) => {
    // Try backend API first
    try {
      const apiUrl = import.meta.env.VITE_API_URL || '/api'
      const response = await fetch(`${apiUrl}/auth/sync-login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ syncPin })
      })
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Invalid sync PIN')
      }
      
      const data = await response.json()

      // Store the token for future authenticated requests
      localStorage.setItem('voluntrack:auth_token', data.token)
      
      // Store user session
      write(SESSION_KEY, data.user)
      setUser(data.user)
      return data.user
    } catch {
      // Fallback to local storage for demo mode
      const account = findUserBySyncPin(syncPin)
      if (!account) throw new Error('Invalid sync PIN.')
      const { passwordHash, pinHash, resetPinCode, resetPinCodeExpiresAt, ...safe } = account
      write(SESSION_KEY, safe)
      setUser(safe)
      return safe
    }
  }, [])

  const register = useCallback(async (data) => {
    // See login()'s comment — only a genuinely unreachable backend falls
    // back to a local-only account. A real backend response (e.g. "email
    // already exists") must surface as a real error, not silently create a
    // token-less local account instead.
    const apiUrl = import.meta.env.VITE_API_URL || '/api'
    let response
    try {
      response = await fetch(`${apiUrl}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      })
    } catch {
      response = null
    }

    if (response) {
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || 'Registration failed')
      }

      const result = await response.json()

      // Store the token for future authenticated requests
      localStorage.setItem('voluntrack:auth_token', result.token)

      // Store user session
      write(SESSION_KEY, result.user)
      setUser(result.user)
      return result.user
    }

    // Backend unreachable — fall back to local storage for demo mode.
    const account = createUser(data)
    const { passwordHash, pinHash, resetPinCode, resetPinCodeExpiresAt, ...safe } = account
    write(SESSION_KEY, safe)
    setUser(safe)
    return safe
  }, [])

  const logout = useCallback(() => {
    remove(SESSION_KEY)
    localStorage.removeItem('voluntrack:auth_token')
    setUser(null)
  }, [])

  const deleteAccount = useCallback(() => {
    if (!user) return
    deleteUser(user.id)
    clearUserData()
    remove(SESSION_KEY)
    setUser(null)
  }, [user])

  const updateProfile = useCallback((patch) => {
    if (!user) return null
    const updated = persistUser(user.id, patch)
    if (!updated) return null
    const { passwordHash, pinHash, resetPinCode, resetPinCodeExpiresAt, ...safe } = updated
    write(SESSION_KEY, safe)
    setUser(safe)
    return safe
  }, [user])

  const requestPinReset = useCallback(async (email) => {
    const updated = sendPinResetCode(email)
    if (!updated) throw new Error('No account with that email.')
    return updated.resetPinCode
  }, [])

  const completePinReset = useCallback(async (email, code, pin) => {
    const account = findUserByEmail(email)
    if (!account) throw new Error('No account with that email.')
    if (!isResetPinCodeValid(account, code)) throw new Error('Invalid or expired code.')
    const updated = persistUser(account.id, { pinHash: hashPin(pin), resetPinCode: null, resetPinCodeExpiresAt: null })
    if (!updated) throw new Error('Failed to update PIN.')
    return updated
  }, [])

  const requestPasswordReset = useCallback(async (email) => {
    const updated = sendPasswordResetCode(email)
    if (!updated) throw new Error('No account with that email.')
    return updated.resetPasswordCode
  }, [])

  const completePasswordReset = useCallback(async (email, code, password) => {
    // Update local storage first
    const account = findUserByEmail(email)
    if (!account) throw new Error('No account with that email.')
    if (!isResetPasswordCodeValid(account, code)) throw new Error('Invalid or expired code.')
    const updated = persistUser(account.id, { passwordHash: hashPassword(password), resetPasswordCode: null, resetPasswordCodeExpiresAt: null })
    if (!updated) throw new Error('Failed to update password.')

    // Also try to update the database password via the new API endpoint
    try {
      const apiUrl = import.meta.env.VITE_API_URL || '/api'
      await fetch(`${apiUrl}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, newPassword: password }),
      })
      // Non-blocking — user flow continues either way
    } catch {
      // Backend may not have this endpoint yet
    }

    return updated
  }, [])

  const setSyncPin = useCallback(async (pin) => {
    if (!user) throw new Error('You must be logged in to set a sync PIN.')
    if (!/^\d{5}$/.test(pin)) throw new Error('Sync PIN must be exactly 5 digits.')
    
    // Try backend API first
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      if (!token) throw new Error('No auth token found')
      
      const apiUrl = import.meta.env.VITE_API_URL || '/api'
      const response = await fetch(`${apiUrl}/auth/sync-pin`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ syncPin: pin })
      })
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update sync PIN')
      }
      
      const data = await response.json()

      // Update the user session with the sync PIN
      write(SESSION_KEY, data.user)
      setUser(data.user)
      return data.user
    } catch {
      // Fallback to local storage for demo mode
      const updated = updateSyncPin(user.id, pin)
      if (!updated) throw new Error('Failed to update sync PIN.')
      const { passwordHash, pinHash, resetPinCode, resetPinCodeExpiresAt, ...safe } = updated
      write(SESSION_KEY, safe)
      setUser(safe)
      return safe
    }
  }, [user])

  return (
    <AuthContext.Provider value={{ user, login, verifyTotp, verifyBackupCode, setupTotp, verifyTotpSetup, disableTotp, verifySms, resendSmsChallenge, setupSms, resendSmsSetup, verifySmsSetup, disableSms, loginWithPin, loginWithSyncPin, register, logout, deleteAccount, updateProfile, requestPinReset, completePinReset, requestPasswordReset, completePasswordReset, setSyncPin }}>
      {children}
    </AuthContext.Provider>
  )
}

// Hook and provider live together on purpose (standard React context idiom).
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
