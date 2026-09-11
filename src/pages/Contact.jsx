import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Mail, MessageSquare, Send, CheckCircle2, XCircle, Loader2, Instagram } from 'lucide-react'
import Card from '@/components/Card.jsx'
import Footer from '@/components/Footer.jsx'
import Toast from '@/components/Toast.jsx'
import Turnstile from '@/components/Turnstile.jsx'
import { turnstileEnabled } from '@/lib/turnstile.js'
import { useSeo } from '@/hooks/useSeo.js'

export default function Contact() {
  useSeo({
    title: 'Contact Us',
    description: 'Found a bug, have a feature request, or want to say hi? Get in touch with the VolunTrack team.',
    path: '/contact',
  })

  useEffect(() => { window.scrollTo(0, 0) }, [])
  const [form, setForm] = useState({ name: '', email: '', subject: 'General question', accountCode: '', message: '' })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [sendErr, setSendErr] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  // Bumped after a successful send to remount the widget for a fresh token.
  const [captchaKey, setCaptchaKey] = useState(0)
  // Result of checking the typed customer ID against real accounts: null
  // (nothing typed, or the check couldn't run), 'checking', 'malformed',
  // 'unknown', or { name }.
  const [accountCheck, setAccountCheck] = useState(null)
  const [officeHours, setOfficeHours] = useState({
    days: 'Monday – Friday',
    hours: '9:00 AM – 5:00 PM (CT)',
    note: 'Replies may take up to 48 hours.',
  })

  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL || '/api'
    fetch(`${apiUrl}/settings/office-hours`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data) setOfficeHours(data) })
      .catch(() => {})
  }, [])

  // The field is optional, so an empty box is fine — but a typed ID has to
  // resolve to a real account before the message can be sent.
  const accountCode = form.accountCode.trim().toUpperCase()
  useEffect(() => {
    if (!accountCode) { setAccountCheck(null); return }
    if (!/^VT-(SCH|ORG)-[A-Z2-9]{6}$/.test(accountCode)) { setAccountCheck('malformed'); return }
    setAccountCheck('checking')
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || '/api'
        const res = await fetch(`${apiUrl}/contact/verify-account/${encodeURIComponent(accountCode)}`)
        // Only a 200 can tell us the ID is unknown. Rate limiting (429) or a
        // server error means we couldn't check — never call a real customer's
        // ID fake because of that. The server re-checks on submit either way.
        if (cancelled) return
        if (res.status === 400) { setAccountCheck('malformed'); return }
        if (!res.ok) { setAccountCheck(null); return }
        const data = await res.json()
        if (!cancelled) setAccountCheck(data.valid ? { name: data.name } : 'unknown')
      } catch { if (!cancelled) setAccountCheck(null) }
    }, 400)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [accountCode])

  // Blocked only when we positively know the ID is bad. A check that couldn't
  // run leaves accountCheck null, and the server rejects a bad ID on submit.
  const accountCodeOk = accountCheck !== 'malformed' && accountCheck !== 'unknown'

  const onChange = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const onSubmit = async (e) => {
    e.preventDefault()
    setSendErr('')
    setDone(false)
    if (!form.message.trim() || !form.name.trim() || !form.email.trim()) {
      return
    }
    if (!accountCodeOk) {
      setSendErr('Please fix the customer ID, or leave it blank.')
      return
    }
    if (turnstileEnabled && !captchaToken) {
      setSendErr('Please complete the CAPTCHA below.')
      return
    }
    setBusy(true)
    try {
      const apiUrl = import.meta.env.VITE_API_URL || '/api'
      const res = await fetch(`${apiUrl}/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          subject: form.subject,
          accountCode: form.accountCode,
          message: form.message,
          turnstileToken: captchaToken,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send message.')
      setDone(true)
      setForm({ name: '', email: '', subject: 'General question', accountCode: '', message: '' })
      setAccountCheck(null)
      setCaptchaToken('')
      setCaptchaKey((k) => k + 1)
    } catch (e) {
      setSendErr(e.message || 'Failed to send message. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen page-shell">
      <header className="px-4 md:px-8 py-5 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5">
          <img src={`${import.meta.env.BASE_URL}logo-icon.webp`} alt="VolunTrack" className="w-9 h-9 object-contain" />
          <span className="font-display font-bold text-lg">VolunTrack</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link to="/about" className="btn-ghost hidden sm:inline-flex">About</Link>
          <Link to="/help" className="btn-ghost hidden sm:inline-flex">Help</Link>
          <Link to="/login" className="btn-ghost"><ArrowLeft className="w-4 h-4" /> Back to sign in</Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 md:px-8 pb-20">
        <h1 className="text-3xl md:text-4xl font-bold text-center">Contact us</h1>
        <p className="text-center text-earth-600 dark:text-earth-300 mt-3 max-w-xl mx-auto">
          Found a bug, have a feature request, or just want to say hi? We'd love to hear from you.
        </p>

        <div className="grid md:grid-cols-5 gap-6 mt-10">
          <Card className="md:col-span-3">
            <h2 className="font-display font-semibold text-lg mb-1 flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-brand-600" /> Send a message
            </h2>
            <p className="text-sm text-earth-500 dark:text-earth-400 mb-5">
              We typically reply within a couple of days.
            </p>

            <form onSubmit={onSubmit} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Your name</label>
                  <input className="input" value={form.name} onChange={onChange('name')} required />
                </div>
                <div>
                  <label className="label">Email</label>
                  <input type="email" className="input" value={form.email} onChange={onChange('email')} required />
                </div>
              </div>
              <div>
                <label className="label">What is it about?</label>
                <select className="input" value={form.subject} onChange={onChange('subject')}>
                  <option>General question</option>
                  <option>Bug report</option>
                  <option>Feature request</option>
                  <option>School or organization partnership</option>
                </select>
              </div>
              {form.subject === 'School or organization partnership' && (
                <div>
                  <label className="label">Customer ID <span className="text-earth-400 font-normal">(optional)</span></label>
                  <input
                    className="input font-mono uppercase"
                    value={form.accountCode}
                    onChange={onChange('accountCode')}
                    placeholder="VT-SCH-4F2K9A"
                    aria-invalid={accountCheck === 'malformed' || accountCheck === 'unknown'}
                  />
                  {accountCheck === 'checking' && (
                    <p className="text-xs text-earth-500 mt-1 flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" /> Checking…
                    </p>
                  )}
                  {accountCheck === 'malformed' && (
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1 flex items-center gap-1">
                      <XCircle className="w-3 h-3" /> That doesn't look like a VolunTrack account ID (e.g. VT-SCH-4F2K9A).
                    </p>
                  )}
                  {accountCheck === 'unknown' && (
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1 flex items-center gap-1">
                      <XCircle className="w-3 h-3" /> No account has that ID. Check it against your invoice, or leave it blank.
                    </p>
                  )}
                  {accountCheck?.name && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> {accountCheck.name}
                    </p>
                  )}
                  <p className="text-xs text-earth-500 mt-1">Already a VolunTrack customer? Enter the account ID from your invoice so we can pull up your account.</p>
                </div>
              )}
              <div>
                <label className="label">Message</label>
                <textarea
                  className="input min-h-[140px] resize-y" required
                  value={form.message} onChange={onChange('message')}
                  placeholder="Tell us a little about what you need…"
                />
              </div>
              {sendErr && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-300 px-3 py-2 rounded-lg">{sendErr}</div>}
              <Turnstile key={captchaKey} onVerify={setCaptchaToken} action="contact" />
              <button className="btn-primary" disabled={busy || !accountCodeOk || (turnstileEnabled && !captchaToken)}>
                {busy ? 'Sending…' : <>Send message <Send className="w-4 h-4" /></>}
              </button>
            </form>
          </Card>

          <div className="md:col-span-2 space-y-4">
            <Card>
              <h3 className="font-display font-semibold flex items-center gap-2 mb-2">
                <Mail className="w-4 h-4 text-brand-600" /> Email
              </h3>
               <a href="mailto:volunteertrackinfo@gmail.com" className="text-brand-700 dark:text-brand-300 hover:underline font-medium">
                volunteertrackinfo@gmail.com
              </a>
              <p className="text-sm text-earth-500 dark:text-earth-400 mt-1">For general questions and support.</p>
            </Card>

            <Card>
              <h3 className="font-display font-semibold flex items-center gap-2 mb-2">
                <MessageSquare className="w-4 h-4 text-brand-600" /> Office hours
              </h3>
              <div className="text-sm text-earth-700 dark:text-earth-200">
                {officeHours.days}<br />{officeHours.hours}
              </div>
              <p className="text-sm text-earth-500 dark:text-earth-400 mt-1">{officeHours.note}</p>
            </Card>

            <Card>
              <h3 className="font-display font-semibold mb-3">Follow along</h3>
              <div className="flex gap-3">
                <a className="p-2 rounded-lg bg-earth-100 hover:bg-earth-200 dark:bg-[#1b2a22] dark:hover:bg-[#243529]" href="https://www.instagram.com/volunteertrackofficial/?hl=en" target="_blank" rel="noreferrer" aria-label="Instagram"><Instagram className="w-4 h-4" /></a>
              </div>
            </Card>
          </div>
        </div>
      </main>

      <Footer />

      <Toast open={done} onClose={() => setDone(false)} variant="success">
        Message sent! We'll be in touch.
      </Toast>
    </div>
  )
}
