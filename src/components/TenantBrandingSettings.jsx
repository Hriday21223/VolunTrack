import { useCallback, useEffect, useRef, useState } from 'react'
import { Image as ImageIcon, Link2, Loader2, Palette, Upload, X } from 'lucide-react'
import { logoFileToDataUrl } from '@/lib/logoImage.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

function authHeaders() {
  const token = localStorage.getItem('voluntrack:auth_token')
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i
const UPLOADED = /^data:image\/(png|jpeg|webp);base64,/i

// Mirrors the login page: only an uploaded raster image or an https link is
// rendered, and the accent is only trusted once it is a hex literal.
function safeLogo(url) {
  return UPLOADED.test(url || '') || /^https:\/\//i.test(url || '') ? url : null
}

// A miniature of the sign-in card, so an admin can see the accent and logo
// land before students do — this is the only place the branding shows up, and
// it is behind a hostname the admin may not have live yet.
function Preview({ name, logoUrl, color }) {
  const logo = safeLogo(logoUrl)
  const accent = HEX.test(color || '') ? color : null
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80 shadow-soft">
      {accent && <div className="h-1 w-full" style={{ backgroundColor: accent }} />}
      <div className="flex items-center justify-between gap-4 p-5">
        <div>
          <p className="text-xs uppercase tracking-[0.3em]" style={accent ? { color: accent } : undefined}>
            Secure sign in
          </p>
          <p className="mt-1 text-xl font-bold text-white">Welcome back</p>
          <p className="mt-1 text-xs text-slate-400">{name ? `${name} · VolunTrack` : 'VolunTrack login'}</p>
        </div>
        {logo
          ? <img src={logo} alt="" className="h-12 w-12 object-contain" />
          : <div className="grid h-12 w-12 place-items-center rounded-xl bg-white/5 text-slate-500"><ImageIcon className="h-5 w-5" /></div>}
      </div>
    </div>
  )
}

function LogoDrop({ logoUrl, onChange, disabled }) {
  const inputRef = useRef(null)
  const [hover, setHover] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const [useLink, setUseLink] = useState(/^https:\/\//i.test(logoUrl || ''))

  const handle = async (file) => {
    if (!file) return
    setError('')
    setProcessing(true)
    try {
      onChange(await logoFileToDataUrl(file))
      setUseLink(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setProcessing(false)
    }
  }

  const logo = safeLogo(logoUrl)
  const uploaded = UPLOADED.test(logoUrl || '')

  return (
    <div>
      <p className="mb-1 block text-sm font-medium">Logo</p>

      {logo ? (
        <div className="flex items-center gap-3 rounded-2xl border border-earth-200 bg-earth-50 p-3 dark:border-[#243529] dark:bg-[#0f1a14]">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-slate-950/80">
            <img src={logo} alt="Current logo" className="h-12 w-12 object-contain" />
          </div>
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-medium">{uploaded ? 'Uploaded logo' : 'Linked logo'}</div>
            {!uploaded && <div className="truncate text-xs text-slate-500">{logoUrl}</div>}
          </div>
          <button type="button" className="btn-sm btn-ghost" onClick={() => inputRef.current?.click()} disabled={disabled || processing}>
            <Upload className="mr-1 h-3.5 w-3.5" /> Replace
          </button>
          <button
            type="button"
            className="rounded-lg p-1.5 text-earth-500 hover:bg-earth-200 dark:hover:bg-[#243529]"
            onClick={() => { onChange(''); setError('') }}
            disabled={disabled || processing}
            aria-label="Remove logo"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
          onDragOver={(e) => { e.preventDefault(); setHover(true) }}
          onDragLeave={() => setHover(false)}
          onDrop={(e) => { e.preventDefault(); setHover(false); handle(e.dataTransfer.files?.[0]) }}
          className={`cursor-pointer select-none rounded-2xl border-2 border-dashed p-6 text-center transition hover:border-brand-500 hover:bg-brand-50/40 dark:hover:bg-brand-900/10 ${
            hover ? 'drop-active border-brand-500' : 'border-earth-200 dark:border-[#243529]'
          }`}
        >
          {processing
            ? <Loader2 className="mx-auto mb-2 h-7 w-7 animate-spin text-brand-600" />
            : <Upload className="mx-auto mb-2 h-7 w-7 text-brand-600" />}
          <div className="text-sm font-medium">{processing ? 'Preparing your logo…' : 'Drop your logo here or click to upload'}</div>
          <div className="mt-1 text-xs text-slate-500">PNG, JPEG, WebP, GIF, or SVG · resized to fit automatically</div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        className="hidden"
        onChange={(e) => { handle(e.target.files?.[0]); e.target.value = '' }}
      />

      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

      {useLink ? (
        <div className="mt-3">
          <label htmlFor="brandLogo" className="mb-1 block text-xs font-medium text-slate-500">Logo link</label>
          <input
            id="brandLogo"
            type="url"
            className="input"
            placeholder="https://example.edu/logo.png"
            value={uploaded ? '' : logoUrl}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
          />
          {logoUrl && !uploaded && !/^https:\/\//i.test(logoUrl) && (
            <p className="mt-1 text-xs text-red-500">A logo link must start with https://</p>
          )}
        </div>
      ) : (
        <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs text-slate-500 underline" onClick={() => setUseLink(true)}>
          <Link2 className="h-3 w-3" /> Use a link to an image instead
        </button>
      )}
    </div>
  )
}

export default function TenantBrandingSettings() {
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [scope, setScope] = useState('school')
  const [hostnames, setHostnames] = useState([])
  const [logoUrl, setLogoUrl] = useState('')
  const [color, setColor] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${apiUrl}/tenant/branding`, { headers: authHeaders() })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not load branding.')
      setName(data.branding?.name || '')
      setLogoUrl(data.branding?.logoUrl || '')
      setColor(data.branding?.color || '')
      setScope(data.scope || 'school')
      setHostnames(data.activeHostnames || [])
      setErr('')
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    setNotice('')
    try {
      const res = await fetch(`${apiUrl}/tenant/branding`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ logoUrl, color }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not save branding.')
      setLogoUrl(data.branding?.logoUrl || '')
      setColor(data.branding?.color || '')
      setNotice('Branding saved. Sign-in pages on your domain pick it up within 10 minutes.')
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading branding…</div>
  }

  const colorValid = !color || HEX.test(color)
  const logoValid = !logoUrl || Boolean(safeLogo(logoUrl))

  return (
    <div className="space-y-6">
      {err && <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200">{err}</div>}
      {notice && <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-200">{notice}</div>}

      {hostnames.length === 0 && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-200">
          Branding only appears on your own hostname. You don&apos;t have a live domain yet — set one
          up under <strong>Custom domain</strong> first, then anything you save here shows on its sign-in page.
        </div>
      )}
      {hostnames.length > 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Shown at sign-in on {hostnames.map((h) => <code key={h} className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">{h}</code>)}
        </p>
      )}

      <form onSubmit={save} className="space-y-4">
        <LogoDrop logoUrl={logoUrl} onChange={setLogoUrl} disabled={busy} />

        <div>
          <label htmlFor="brandColor" className="mb-1 block text-sm font-medium">Accent colour</label>
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 dark:border-slate-700">
              {HEX.test(color || '')
                ? <span className="h-5 w-5 rounded" style={{ backgroundColor: color }} />
                : <Palette className="h-4 w-4 text-slate-400" />}
            </span>
            <input
              id="brandColor"
              type="text"
              className="input flex-1"
              placeholder="#2f855a"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            A hex value. Used for accents on your sign-in page — not for text or button backgrounds,
            so any colour stays readable. Leave blank for the VolunTrack green.
          </p>
          {!colorValid && <p className="mt-1 text-xs text-red-500">Enter a hex value like #2f855a.</p>}
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">Preview</p>
          <Preview name={name} logoUrl={logoUrl} color={color} />
        </div>

        <button type="submit" className="btn-primary" disabled={busy || !colorValid || !logoValid}>
          {busy ? 'Saving…' : 'Save branding'}
        </button>
      </form>

      <p className="text-xs text-slate-500">
        {scope === 'organization'
          ? 'This branding applies to your organization’s own hostnames. Each school brands its own separately.'
          : 'Only your school’s sign-in page changes. The VolunTrack name and logo stay on the canonical site.'}
      </p>
    </div>
  )
}
