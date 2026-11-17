import { useCallback, useEffect, useState } from 'react'
import { HardDrive, CheckCircle2, AlertTriangle } from 'lucide-react'
import Card from '@/components/Card.jsx'
import PasswordInput from '@/components/PasswordInput.jsx'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })

// Your own file storage (#922), for a school's main admin or an organization:
// proof files and reports then upload straight from the student's device to
// the school's own bucket (server/routes/storage.js). Any S3-compatible
// service: Amazon S3, Cloudflare R2, Google Cloud Storage (S3 mode), Backblaze
// B2, Wasabi, DigitalOcean Spaces. It only turns on after a real test.
const PRESETS = {
  s3: { provider: 's3', label: 'Amazon S3', endpoint: '', region: 'us-east-1', hint: '' },
  r2: { provider: 'r2', label: 'Cloudflare R2', endpoint: 'https://<account-id>.r2.cloudflarestorage.com', region: 'auto', hint: 'r2' },
  gcs: { provider: 's3', label: 'Google Cloud Storage (S3 mode)', endpoint: 'https://storage.googleapis.com', region: 'auto', hint: 'gcs' },
  other: { provider: 's3', label: 'Other S3-compatible (Backblaze B2, Wasabi, DigitalOcean Spaces…)', endpoint: 'https://', region: 'us-east-1', hint: 'other' },
}
const GUIDES = [
  ['Amazon S3', 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/create-bucket-overview.html'],
  ['Cloudflare R2', 'https://developers.cloudflare.com/r2/buckets/create-buckets/'],
  ['Google Cloud Storage', 'https://cloud.google.com/storage/docs/interoperability'],
  ['Backblaze B2', 'https://www.backblaze.com/docs/cloud-storage-s3-compatible-api'],
]

export default function OwnStorageCard({ canEdit = true }) {
  const [config, setConfig] = useState(undefined) // undefined = loading, null = none
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // { text, ok }
  const [confirmOff, setConfirmOff] = useState(false)
  // SharePoint (#924): offered only when this server has the Microsoft app.
  const [sp, setSp] = useState({ sharepoint: false, sharepointAppId: null })
  const [spForm, setSpForm] = useState(null) // { tenantId, siteUrl, library, prefix }

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${apiUrl}/storage/config`, { headers: headers() })
      const d = await r.json().catch(() => ({}))
      if (r.status === 503) { setConfig(null); setMsg({ text: tr('Own storage isn’t available on this server yet.'), ok: false }); return }
      if (!r.ok) throw new Error(d.error || tr('Something went wrong. Try again.'))
      setConfig(d.config || null)
    } catch (e) { setConfig(null); setMsg({ text: e.message, ok: false }) }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    fetch(`${apiUrl}/storage/providers`, { headers: headers() }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setSp(d) }).catch(() => {})
    // Back from Microsoft's approval page.
    const q = new URLSearchParams(window.location.search)
    if (q.get('msTenant')) { setSpForm({ tenantId: q.get('msTenant'), siteUrl: '', library: 'Documents', prefix: '' }); setMsg({ text: tr('Approved by Microsoft 365.'), ok: true }) }
    else if (q.get('msError')) setMsg({ text: tr('Microsoft approval didn’t finish. Try again, signed in as a Microsoft 365 admin.'), ok: false })
    if (q.get('msTenant') || q.get('msError')) window.history.replaceState(null, '', window.location.pathname)
  }, [])

  const approveMicrosoft = async () => {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch(`${apiUrl}/storage/microsoft/consent-url`, { headers: headers() })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.url) throw new Error(d.error || tr('Something went wrong. Try again.'))
      window.location.href = d.url
    } catch (e) { setMsg({ text: e.message, ok: false }); setBusy(false) }
  }

  const saveSharepoint = async (e) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      const r = await fetch(`${apiUrl}/storage/config`, { method: 'PUT', headers: headers(), body: JSON.stringify({ provider: 'sharepoint', tenantId: spForm.tenantId, siteUrl: spForm.siteUrl, library: spForm.library, prefix: spForm.prefix, ...(spForm.own ? { clientId: spForm.clientId, clientSecret: spForm.clientSecret } : {}) }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || tr('Something went wrong. Try again.'))
      const t = await fetch(`${apiUrl}/storage/test`, { method: 'POST', headers: headers() })
      const td = await t.json().catch(() => ({}))
      if (!t.ok) throw new Error(td.error || tr('Something went wrong. Try again.'))
      setConfig(td.config || d.config)
      if (td.ok) { setSpForm(null); setMsg({ text: tr('Connected. Proof files now go straight to your storage.'), ok: true }) }
      else setMsg({ text: tr('The test didn’t pass: {reason}', { reason: td.error || '' }), ok: false })
    } catch (e2) { setMsg({ text: e2.message, ok: false }) } finally { setBusy(false) }
  }

  const start = (key) => {
    const p = PRESETS[key]
    setForm({ preset: key, provider: p.provider, bucket: config?.bucket || '', region: p.region, endpoint: p.endpoint, prefix: config?.prefix || '', accessKeyId: '', secretAccessKey: '' })
    setMsg(null)
  }

  const saveAndTest = async (e) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      const body = { provider: form.provider, bucket: form.bucket, region: form.region, endpoint: form.endpoint || undefined, prefix: form.prefix, accessKeyId: form.accessKeyId, secretAccessKey: form.secretAccessKey }
      const r = await fetch(`${apiUrl}/storage/config`, { method: 'PUT', headers: headers(), body: JSON.stringify(body) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || tr('Something went wrong. Try again.'))
      const t = await fetch(`${apiUrl}/storage/test`, { method: 'POST', headers: headers() })
      const td = await t.json().catch(() => ({}))
      if (!t.ok) throw new Error(td.error || tr('Something went wrong. Try again.'))
      setConfig(td.config || d.config)
      if (td.ok) { setForm(null); setMsg({ text: td.corsWarning ? tr('Connected. One more step: allow uploads from VolunTrack in the bucket’s CORS settings (see below).') : tr('Connected. Proof files now go straight to your storage.'), ok: !td.corsWarning }) }
      else setMsg({ text: tr('The test didn’t pass: {reason}', { reason: td.error || '' }), ok: false })
    } catch (e2) { setMsg({ text: e2.message, ok: false }) } finally { setBusy(false) }
  }

  const retest = async () => {
    setBusy(true); setMsg(null)
    try {
      const t = await fetch(`${apiUrl}/storage/test`, { method: 'POST', headers: headers() })
      const td = await t.json().catch(() => ({}))
      if (!t.ok) throw new Error(td.error || tr('Something went wrong. Try again.'))
      setConfig(td.config)
      setMsg(td.ok ? { text: td.corsWarning ? tr('Connected. One more step: allow uploads from VolunTrack in the bucket’s CORS settings (see below).') : tr('Connected. Proof files now go straight to your storage.'), ok: !td.corsWarning } : { text: tr('The test didn’t pass: {reason}', { reason: td.error || '' }), ok: false })
    } catch (e) { setMsg({ text: e.message, ok: false }) } finally { setBusy(false) }
  }

  const turnOff = async () => {
    setConfirmOff(false); setBusy(true)
    try {
      const r = await fetch(`${apiUrl}/storage/config`, { method: 'DELETE', headers: headers() })
      if (!r.ok) throw new Error(tr('Something went wrong. Try again.'))
      setConfig(null); setMsg({ text: tr('Turned off. New proof files stay on students’ devices again.'), ok: true })
    } catch (e) { setMsg({ text: e.message, ok: false }) } finally { setBusy(false) }
  }

  const active = config?.status === 'active'
  const origin = window.location.origin

  return (
    <Card>
      <h3 className="font-display font-semibold mb-1 flex items-center gap-2"><HardDrive className="w-4 h-4 text-brand-600" aria-hidden="true" /> {tr('Your own file storage')}</h3>
      <p className="text-sm text-earth-500 dark:text-earth-400 mb-3">
        {tr('Connect your own storage and the proof files and reports your students attach upload straight from their device to it. VolunTrack keeps only a pointer, never the file. Works with Amazon S3, Cloudflare R2, Google Cloud Storage and other S3-compatible services.')}
      </p>

      {config === undefined ? (
        <p className="text-sm text-earth-400">{tr('Loading…')}</p>
      ) : config && !form ? (
        <div className="rounded-xl border border-earth-200 dark:border-earth-800 p-3 text-sm space-y-1 mb-3">
          <p className="flex items-center gap-2 font-medium">
            {active ? <CheckCircle2 className="w-4 h-4 text-emerald-500" aria-hidden="true" /> : <AlertTriangle className="w-4 h-4 text-amber-500" aria-hidden="true" />}
            {active ? tr('On') : tr('Not on yet: the last test didn’t pass')}
          </p>
          <p className="text-earth-500">{config.provider === 'sharepoint' ? `SharePoint · ${config.endpoint} · ${config.bucket}${config.prefix ? `/${config.prefix}` : ''}` : `${config.bucket}${config.prefix ? `/${config.prefix}` : ''} · ${config.endpoint || 'Amazon S3'} · ${config.region}`}</p>
          {config.lastTestError && !active && <p className="text-red-400">{config.lastTestError}</p>}
          {canEdit && (
            <div className="flex flex-wrap gap-2 pt-2">
              <button type="button" onClick={retest} disabled={busy} className="btn-secondary btn-sm">{busy ? tr('Testing…') : tr('Test again')}</button>
              <button type="button" onClick={() => (config.provider === 'sharepoint' ? setSpForm({ own: Boolean(config.accessKeyId), clientId: config.accessKeyId || '', clientSecret: '', tenantId: config.region, siteUrl: config.endpoint, library: config.bucket, prefix: config.prefix || '' }) : start(config.provider === 'r2' ? 'r2' : config.endpoint ? 'other' : 's3'))} className="btn-ghost btn-sm">{tr('Change')}</button>
              {confirmOff ? (
                <span className="flex gap-1 items-center">
                  <span className="text-xs text-earth-400">{tr('Proof already in your storage stays there, but VolunTrack can’t open it after this.')}</span>
                  <button type="button" onClick={turnOff} className="btn-sm bg-red-600 text-white hover:bg-red-700">{tr('Turn off')}</button>
                  <button type="button" onClick={() => setConfirmOff(false)} className="btn-ghost btn-sm">{tr('Cancel')}</button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirmOff(true)} className="btn-ghost btn-sm text-red-400">{tr('Turn off')}</button>
              )}
            </div>
          )}
        </div>
      ) : !form && canEdit ? (
        <div className="flex flex-wrap gap-2 mb-3">
          {Object.entries(PRESETS).map(([k, p]) => (
            <button key={k} type="button" onClick={() => start(k)} className="btn-secondary btn-sm">{k === 'other' ? tr('Other S3-compatible') : p.label}</button>
          ))}
          <button type="button" onClick={() => (sp.sharepoint ? approveMicrosoft() : setSpForm({ own: true, tenantId: '', clientId: '', clientSecret: '', siteUrl: '', library: 'Documents', prefix: '' }))} disabled={busy} className="btn-secondary btn-sm">{tr('Microsoft SharePoint')}</button>
        </div>
      ) : null}

      {!canEdit && !config && <p className="text-sm text-earth-400">{tr('Only your school’s main admin can connect storage.')}</p>}

      {form && (
        <form onSubmit={saveAndTest} className="space-y-3 mb-3">
          <p className="text-sm font-medium">{form.preset === 'other' ? tr('Other S3-compatible') : PRESETS[form.preset].label}</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="os-bucket">{tr('Bucket name')}</label>
              <input id="os-bucket" className="input" value={form.bucket} onChange={(e) => setForm({ ...form, bucket: e.target.value.toLowerCase() })} />
            </div>
            <div>
              <label className="label" htmlFor="os-region">{tr('Region')}</label>
              <input id="os-region" className="input" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} />
            </div>
            {form.preset !== 's3' && (
              <div className="sm:col-span-2">
                <label className="label" htmlFor="os-endpoint">{tr('Endpoint (https address)')}</label>
                <input id="os-endpoint" className="input font-mono text-sm" value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value.trim() })} />
              </div>
            )}
            <div>
              <label className="label" htmlFor="os-key">{tr('Access key ID')}</label>
              <input id="os-key" className="input font-mono text-sm" autoComplete="off" value={form.accessKeyId} onChange={(e) => setForm({ ...form, accessKeyId: e.target.value.trim() })} />
            </div>
            <div>
              <label className="label" htmlFor="os-secret">{tr('Secret access key')}</label>
              <PasswordInput id="os-secret" autoComplete="off" value={form.secretAccessKey} onChange={(e) => setForm({ ...form, secretAccessKey: e.target.value.trim() })} />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="os-prefix">{tr('Folder inside the bucket (optional)')}</label>
              <input id="os-prefix" className="input" placeholder="voluntrack" value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value })} />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !form.bucket || !form.accessKeyId || !form.secretAccessKey} className="btn-primary btn-sm">{busy ? tr('Testing…') : tr('Test and turn on')}</button>
            <button type="button" onClick={() => setForm(null)} className="btn-ghost btn-sm">{tr('Cancel')}</button>
          </div>
          <p className="text-xs text-earth-400">{tr('We save, read and delete one small test file. It only turns on if all three work. The secret key is stored encrypted and never shown again.')}</p>
        </form>
      )}

      {spForm && canEdit && (
        <form onSubmit={saveSharepoint} className="space-y-3 mb-3">
          <p className="text-sm font-medium">{tr('Microsoft SharePoint')}</p>
          {!spForm.tenantId && !spForm.own ? (
            <button type="button" onClick={approveMicrosoft} disabled={busy} className="btn-primary btn-sm">{tr('Approve in Microsoft')}</button>
          ) : (
            <>
              {spForm.own && (
                <div className="space-y-3">
                  <div className="text-xs text-earth-400 space-y-1">
                    <p>{tr('Your Microsoft 365 admin registers an app in your own Microsoft Entra (Microsoft Graph application permission Sites.Selected, with admin consent, and a client secret), then pastes its details here. VolunTrack only gets the one site you grant below.')}</p>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label className="label" htmlFor="sp-tenant">{tr('Directory (tenant) ID')}</label>
                      <input id="sp-tenant" className="input font-mono text-sm" autoComplete="off" value={spForm.tenantId} onChange={(e) => setSpForm({ ...spForm, tenantId: e.target.value.trim() })} />
                    </div>
                    <div>
                      <label className="label" htmlFor="sp-client">{tr('Application (client) ID')}</label>
                      <input id="sp-client" className="input font-mono text-sm" autoComplete="off" value={spForm.clientId} onChange={(e) => setSpForm({ ...spForm, clientId: e.target.value.trim() })} />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="label" htmlFor="sp-secret">{tr('Client secret')}</label>
                      <PasswordInput id="sp-secret" autoComplete="off" value={spForm.clientSecret} onChange={(e) => setSpForm({ ...spForm, clientSecret: e.target.value.trim() })} placeholder={config?.provider === 'sharepoint' && config.hasSecret ? '••••••••' : ''} />
                    </div>
                  </div>
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="label" htmlFor="sp-site">{tr('SharePoint site address')}</label>
                  <input id="sp-site" className="input" placeholder="https://yourschool.sharepoint.com/sites/Volunteering" value={spForm.siteUrl} onChange={(e) => setSpForm({ ...spForm, siteUrl: e.target.value.trim() })} />
                </div>
                <div>
                  <label className="label" htmlFor="sp-lib">{tr('Document library')}</label>
                  <input id="sp-lib" className="input" value={spForm.library} onChange={(e) => setSpForm({ ...spForm, library: e.target.value })} />
                </div>
                <div>
                  <label className="label" htmlFor="sp-prefix">{tr('Folder inside the bucket (optional)')}</label>
                  <input id="sp-prefix" className="input" placeholder="VolunTrack" value={spForm.prefix} onChange={(e) => setSpForm({ ...spForm, prefix: e.target.value })} />
                </div>
              </div>
              <div className="text-xs text-earth-400 space-y-1">
                <p>{tr('Your Microsoft 365 admin gives VolunTrack access to this one site, once (PnP PowerShell), or grants the same in SharePoint admin:')}</p>
                <code className="block break-all select-all bg-earth-900/40 rounded p-2">{`Grant-PnPAzureADAppSitePermission -AppId ${(spForm.own ? spForm.clientId : sp.sharepointAppId) || '<application id>'} -DisplayName "VolunTrack" -Site ${spForm.siteUrl || '<site address>'} -Permissions Write`}</code>
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={busy || !spForm.siteUrl || (spForm.own && (!spForm.tenantId || !spForm.clientId))} className="btn-primary btn-sm">{busy ? tr('Testing…') : tr('Test and turn on')}</button>
                <button type="button" onClick={() => setSpForm(null)} className="btn-ghost btn-sm">{tr('Cancel')}</button>
              </div>
            </>
          )}
        </form>
      )}

      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-sm mb-3 ${msg.ok ? 'text-emerald-500' : 'text-amber-500'}`}>{msg.text}</p>}

      <details className="text-sm text-earth-500 dark:text-earth-400">
        <summary className="cursor-pointer font-medium">{tr('How to set it up')}</summary>
        <ol className="list-decimal ml-5 mt-2 space-y-1">
          <li>{tr('Create a private bucket (no public access).')}</li>
          <li>{tr('Make an access key that can only read, write and delete in that bucket.')}</li>
          <li>{tr('In the bucket’s CORS settings, allow PUT and GET from this address:')} <code className="text-xs">{origin}</code></li>
          <li>{tr('Fill in the form above and press Test and turn on.')}</li>
        </ol>
        <p className="mt-2">{tr('Guides:')} {GUIDES.map(([n, u], i) => <span key={n}>{i ? ' · ' : ''}<a href={u} target="_blank" rel="noopener noreferrer" className="text-brand-700 dark:text-brand-300 hover:underline">{n}</a></span>)}</p>
      </details>
    </Card>
  )
}
