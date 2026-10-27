import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import Card from '@/components/Card.jsx'
import SignaturePad from '@/components/SignaturePad.jsx'
import { fetchCertificateSignRequest, submitCertificateSign } from '@/lib/requirements.js'

// The phone half of signing a certificate (#548): opened from the QR code on
// the Certificates settings. No sign-in; the one-time link is the key.
export default function SignCertificate() {
  const { token } = useParams()
  const [req, setReq] = useState({ loading: true, data: null, error: '' })
  const [image, setImage] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchCertificateSignRequest(token)
      .then((data) => setReq({ loading: false, data, error: '' }))
      .catch((e) => setReq({ loading: false, data: null, error: e.message }))
  }, [token])

  const send = async () => {
    if (!image) { setError('Draw your signature first.'); return }
    setSending(true)
    setError('')
    try {
      await submitCertificateSign(token, image)
      setDone(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  const d = req.data
  const closed = d && (d.signed || d.expired)
  return (
    <div className="min-h-screen grid place-items-center px-4 py-8 page-shell text-earth-900 dark:text-earth-100">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2.5 justify-center mb-6">
          <img src={`${import.meta.env.BASE_URL}logo-icon.webp`} alt="" className="w-10 h-10 object-contain" />
          <span className="font-display font-bold text-2xl">VolunTrack</span>
        </Link>
        <Card padded={false} className="p-6">
          {req.loading ? (
            <p className="text-center text-sm text-earth-500 dark:text-earth-400"><Loader2 className="w-5 h-5 animate-spin inline" /></p>
          ) : req.error || closed ? (
            <div className="text-center">
              <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
              <p className="text-sm text-earth-500 dark:text-earth-400">
                {req.error || (d.signed ? 'This link was already used to sign.' : 'This link has expired. Make a new QR code on the computer.')}
              </p>
            </div>
          ) : done ? (
            <div className="text-center">
              <CheckCircle2 className="w-10 h-10 text-brand-500 mx-auto mb-3" />
              <p className="font-semibold">Signature sent</p>
              <p className="text-sm text-earth-500 dark:text-earth-400 mt-1">It’s now on the computer. Press Save requirements there to keep it.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <h1 className="font-display font-bold text-xl">Sign the certificates</h1>
                <p className="text-sm text-earth-500 dark:text-earth-400 mt-1">
                  {d.signerName ? `${d.signerName}, sign` : 'Sign'} with your finger. This signature goes on the service certificates{d.tenantName ? ` from ${d.tenantName}` : ''}.
                </p>
              </div>
              <SignaturePad value={image} onChange={setImage} />
              {error && <p className="text-sm text-red-500">{error}</p>}
              <button type="button" className="btn-primary w-full" onClick={send} disabled={sending}>
                {sending ? 'Sending…' : 'Done'}
              </button>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
