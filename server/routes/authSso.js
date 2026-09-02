import express from 'express'
import rateLimit from 'express-rate-limit'
import validator from 'validator'
import * as oidc from 'openid-client'
import { query, hasDatabase } from '../db.js'
import { uid, generateToken } from '../ids.js'
import { signToken, requireAuth } from '../auth.js'
import { encryptSecret, decryptSecret, hasEncryptionKey } from '../secrets.js'
import { publicUser, USER_WITH_SCHOOL_SELECT } from './auth.js'

const router = express.Router()

const ssoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Please try again later.' },
})

const STATE_TTL_MS = 10 * 60 * 1000   // time to complete the IdP round trip
const CODE_TTL_MS = 60 * 1000         // time for the SPA to redeem the handoff code

// Well-known issuers we can fill in for the admin, so a school only has to
// paste a client id and secret. 'oidc' (generic) requires an explicit issuer.
const GOOGLE_ISSUER = 'https://accounts.google.com'

function frontendUrl() {
  return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')
}

function backendUrl() {
  return (process.env.PUBLIC_BACKEND_URL || 'http://localhost:10000').replace(/\/$/, '')
}

// One fixed callback for the whole platform — the connection is identified by
// `state`, not by the URL. That means every school pastes the same redirect
// URI into its IdP console and we never mint per-tenant callbacks.
export function redirectUri() {
  return `${backendUrl()}/api/auth/sso/callback`
}

function requireDb(_req, res, next) {
  if (!hasDatabase()) {
    return res.status(503).json({ error: 'Server database is not configured.' })
  }
  next()
}

function emailDomain(email) {
  const at = String(email || '').lastIndexOf('@')
  return at === -1 ? null : email.slice(at + 1).trim().toLowerCase()
}

// Microsoft issuers are https://login.microsoftonline.com/<tenant-id>/v2.0, so
// the tenant a connection is pinned to can be read straight off the issuer.
function entraTenantId(issuer) {
  const m = /login\.microsoftonline\.com\/([^/]+)\//.exec(String(issuer || ''))
  return m ? m[1].toLowerCase() : null
}

// returnTo is attacker-influencable, so only same-site absolute paths are
// allowed through — never a full URL, and never a protocol-relative "//host"
// (which the browser would treat as a different origin).
function safeReturnTo(value) {
  const v = String(value || '')
  if (!v.startsWith('/') || v.startsWith('//')) return '/dashboard'
  return v
}

async function loadConnection(id) {
  const { rows } = await query('SELECT * FROM sso_connections WHERE id = $1', [id])
  return rows[0] || null
}

// Builds the openid-client Configuration for a connection. Discovery results
// are cached per connection so a login isn't two extra round trips; the cache
// is dropped when the connection row is updated.
const configCache = new Map()

async function oidcConfig(connection) {
  const cached = configCache.get(connection.id)
  if (cached && cached.issuer === connection.oidc_issuer && cached.clientId === connection.oidc_client_id) {
    return cached.config
  }
  const secret = decryptSecret(connection.oidc_client_secret_enc)
  const config = await oidc.discovery(
    new URL(connection.oidc_issuer),
    connection.oidc_client_id,
    secret,
  )
  configCache.set(connection.id, {
    config,
    issuer: connection.oidc_issuer,
    clientId: connection.oidc_client_id,
  })
  return config
}

function invalidateConfig(id) {
  configCache.delete(id)
}

// Which school/org an authenticated admin may manage connections for.
// `admin` is unrestricted; a school account is pinned to its own school.
function scopeFor(auth) {
  if (auth.role === 'admin') return { unrestricted: true }
  if (auth.role === 'school' || auth.role === 'school_staff') return { schoolId: true }
  if (auth.role === 'org') return { orgId: true }
  return null
}

async function assertCanManage(auth, connection) {
  if (auth.role === 'admin') return true
  const { rows } = await query('SELECT school_id, organization_id FROM users WHERE id = $1', [auth.sub])
  const me = rows[0]
  if (!me) return false
  if ((auth.role === 'school' || auth.role === 'school_staff') && connection.school_id && connection.school_id === me.school_id) return true
  if (auth.role === 'org' && connection.organization_id && connection.organization_id === me.organization_id) return true
  return false
}

function publicConnection(row, domains = []) {
  return {
    id: row.id,
    schoolId: row.school_id,
    organizationId: row.organization_id,
    provider: row.provider,
    displayName: row.display_name,
    issuer: row.oidc_issuer,
    clientId: row.oidc_client_id,
    // The client secret is never returned — only whether one is stored.
    hasClientSecret: Boolean(row.oidc_client_secret_enc),
    defaultRole: row.default_role,
    jitEnabled: row.jit_enabled,
    enabled: row.enabled,
    lastTestAt: row.last_test_at,
    lastTestOk: row.last_test_ok,
    lastTestError: row.last_test_error,
    createdAt: row.created_at,
    redirectUri: redirectUri(),
    domains: domains.map((d) => ({
      domain: d.domain,
      proofMethod: d.proof_method,
      verified: Boolean(d.verified_at),
      verifyToken: d.proof_method === 'dns_txt' ? d.verify_token : null,
    })),
  }
}

// ---------------------------------------------------------------------------
// Public login flow
// ---------------------------------------------------------------------------

// GET /api/auth/sso/discover?email=someone@lincolnhs.edu
// Email-first routing: the login page asks whether this address belongs to a
// school with SSO, and if so shows its button instead of the password field.
// Deliberately does not reveal whether an *account* exists — only whether the
// domain is configured — so it can't be used to enumerate users.
router.get('/discover', ssoLimiter, requireDb, async (req, res) => {
  const email = String(req.query.email || '').trim().toLowerCase()
  const domain = emailDomain(email)
  if (!domain || !validator.isEmail(email)) return res.json({ sso: null })

  try {
    const { rows } = await query(
      `SELECT c.id, c.display_name
         FROM sso_email_domains d
         JOIN sso_connections c ON c.id = d.connection_id
        WHERE d.domain = $1 AND d.verified_at IS NOT NULL AND c.enabled = true
        LIMIT 1`,
      [domain],
    )
    if (!rows[0]) return res.json({ sso: null })
    return res.json({ sso: { connectionId: rows[0].id, displayName: rows[0].display_name } })
  } catch (error) {
    console.error('sso discover failed:', error)
    return res.json({ sso: null })
  }
})

// Creates the PKCE/state/nonce triple, records it, and returns the IdP URL.
// Shared by the public login redirect and the authenticated admin test.
async function beginAuthorization(connection, { purpose, initiatedBy, returnTo }) {
  const config = await oidcConfig(connection)
  const codeVerifier = oidc.randomPKCECodeVerifier()
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier)
  const state = oidc.randomState()
  const nonce = oidc.randomNonce()

  await query(
    `INSERT INTO sso_auth_states (state, connection_id, code_verifier, nonce, return_to, purpose, initiated_by, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      state,
      connection.id,
      codeVerifier,
      nonce,
      safeReturnTo(returnTo),
      purpose,
      initiatedBy,
      new Date(Date.now() + STATE_TTL_MS),
    ],
  )

  return oidc.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri(),
    scope: 'openid email profile',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  }).href
}

// GET /api/auth/sso/:connectionId/start — redirects the browser to the IdP.
// Public and unauthenticated by design: this is the entry point for a student
// who has no VolunTrack session yet.
router.get('/:connectionId/start', ssoLimiter, requireDb, async (req, res) => {
  try {
    const connection = await loadConnection(req.params.connectionId)
    if (!connection) return res.status(404).json({ error: 'Unknown SSO connection.' })
    if (!connection.enabled) {
      return res.status(403).json({ error: 'This SSO connection is not enabled.' })
    }

    const url = await beginAuthorization(connection, {
      purpose: 'login',
      initiatedBy: null,
      returnTo: req.query.returnTo,
    })
    return res.redirect(url)
  } catch (error) {
    console.error('sso start failed:', error)
    return res.status(500).json({ error: 'Could not start SSO sign-in.' })
  }
})

function failRedirect(res, message) {
  return res.redirect(`${frontendUrl()}/login?sso_error=${encodeURIComponent(message)}`)
}

// GET /api/auth/sso/callback — the IdP redirects the browser back here.
router.get('/callback', ssoLimiter, requireDb, async (req, res) => {
  let stateRow = null
  try {
    const state = String(req.query.state || '')
    if (!state) return failRedirect(res, 'Missing state.')

    // Single-use: delete on read, so a replayed callback finds nothing.
    const { rows } = await query('DELETE FROM sso_auth_states WHERE state = $1 RETURNING *', [state])
    stateRow = rows[0]
    if (!stateRow) return failRedirect(res, 'This sign-in link has already been used or expired.')
    if (new Date(stateRow.expires_at) < new Date()) {
      return failRedirect(res, 'This sign-in took too long. Please try again.')
    }

    const connection = await loadConnection(stateRow.connection_id)
    if (!connection) return failRedirect(res, 'Unknown SSO connection.')

    const config = await oidcConfig(connection)
    const currentUrl = new URL(`${backendUrl()}${req.originalUrl}`)

    // Validates the code exchange, PKCE, state, nonce, and the ID token
    // signature / issuer / audience / expiry.
    const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: stateRow.code_verifier,
      expectedState: state,
      expectedNonce: stateRow.nonce,
    })

    const claims = tokens.claims()
    if (!claims) return failRedirect(res, 'The identity provider did not return an ID token.')

    const subject = String(claims.sub || '')
    const email = String(claims.email || '').trim().toLowerCase()
    if (!subject || !email) {
      return failRedirect(res, 'The identity provider did not return an email address.')
    }
    // Google and Entra both set this; refusing unverified addresses stops an
    // IdP-side unverified alias from being used to claim someone's account.
    if (claims.email_verified === false) {
      return failRedirect(res, 'Your email address is not verified with your identity provider.')
    }

    if (stateRow.purpose === 'test') {
      return handleTestCallback(res, connection, claims, email, stateRow)
    }

    return handleLoginCallback(res, connection, claims, email, subject, stateRow)
  } catch (error) {
    console.error('sso callback failed:', error)
    return failRedirect(res, 'Sign-in with your school failed. Please try again.')
  }
})

// Confirms the ID token really proves this connection controls `domain`.
// Google/Entra prove it via claims; generic OIDC has no equivalent, so a
// verified DNS TXT record is the only accepted proof there.
function domainProofOk(connection, claims, domain, proofMethod) {
  if (proofMethod === 'google_hd') {
    return String(claims.hd || '').toLowerCase() === domain
  }
  if (proofMethod === 'entra_tid') {
    const expected = entraTenantId(connection.oidc_issuer)
    // A "common"/"organizations" issuer isn't pinned to one tenant, so `tid`
    // proves nothing about who owns the domain — reject rather than trust it.
    if (!expected || expected === 'common' || expected === 'organizations') return false
    return String(claims.tid || '').toLowerCase() === expected
  }
  return proofMethod === 'dns_txt'
}

async function handleLoginCallback(res, connection, claims, email, subject, stateRow) {
  const domain = emailDomain(email)

  const { rows: domainRows } = await query(
    `SELECT * FROM sso_email_domains
      WHERE connection_id = $1 AND domain = $2 AND verified_at IS NOT NULL`,
    [connection.id, domain],
  )
  const domainRow = domainRows[0]
  if (!domainRow || !domainProofOk(connection, claims, domain, domainRow.proof_method)) {
    return failRedirect(res, 'Your email domain is not configured for this school.')
  }

  // 1. Returning SSO user, matched on the IdP subject rather than the email —
  //    a renamed mailbox must not orphan the account.
  let user = null
  const bySubject = await query(
    `${USER_WITH_SCHOOL_SELECT} WHERE u.sso_connection_id = $1 AND u.sso_subject = $2`,
    [connection.id, subject],
  )
  user = bySubject.rows[0] || null

  // 2. Existing account with this email. Adopt it only if it already belongs
  //    to this connection's school and holds a role SSO is allowed to manage.
  //    Never silently take over an admin/org/parent account, and never move an
  //    account between schools.
  if (!user) {
    const byEmail = await query(`${USER_WITH_SCHOOL_SELECT} WHERE lower(u.email) = $1`, [email])
    const candidate = byEmail.rows[0]
    if (candidate) {
      const linkable =
        ['student', 'volunteer', 'school_staff'].includes(candidate.role) &&
        (connection.school_id ? candidate.school_id === connection.school_id : true)
      if (!linkable) {
        return failRedirect(res, 'An account with this email already exists. Sign in with your password instead.')
      }
      await query(
        `UPDATE users SET sso_connection_id = $1, sso_subject = $2, auth_provider = 'sso' WHERE id = $3`,
        [connection.id, subject, candidate.id],
      )
      const refreshed = await query(`${USER_WITH_SCHOOL_SELECT} WHERE u.id = $1`, [candidate.id])
      user = refreshed.rows[0]
    }
  }

  // 3. Just-in-time provisioning. Role and school always come from the
  //    connection, never from anything the IdP sent.
  if (!user) {
    if (!connection.jit_enabled) {
      return failRedirect(res, 'No VolunTrack account exists for this email, and automatic account creation is off.')
    }
    const id = uid('usr')
    const name = String(claims.name || email.split('@')[0]).slice(0, 100)
    await query(
      `INSERT INTO users (id, role, name, email, password_hash, school_id, organization_id,
                          sso_connection_id, sso_subject, auth_provider)
       VALUES ($1,$2,$3,$4,NULL,$5,$6,$7,$8,'sso')`,
      [
        id,
        connection.default_role,
        name,
        email,
        connection.school_id,
        connection.organization_id,
        connection.id,
        subject,
      ],
    )
    const created = await query(`${USER_WITH_SCHOOL_SELECT} WHERE u.id = $1`, [id])
    user = created.rows[0]
  }

  // Hand the SPA a single-use code rather than the JWT itself — a JWT in the
  // URL would land in browser history, server logs, and the Referer header.
  const code = generateToken()
  await query(
    'INSERT INTO sso_login_codes (code, user_id, expires_at) VALUES ($1,$2,$3)',
    [code, user.id, new Date(Date.now() + CODE_TTL_MS)],
  )

  const target = new URL(`${frontendUrl()}/auth/sso/return`)
  target.searchParams.set('code', code)
  target.searchParams.set('returnTo', safeReturnTo(stateRow.return_to))
  return res.redirect(target.href)
}

// The admin test round trip: records the result, and — for Google/Entra —
// auto-verifies the admin's own email domain, since the ID token proves the
// tenant owns it. That is what removes the DNS step for those providers.
async function handleTestCallback(res, connection, claims, email, stateRow) {
  const domain = emailDomain(email)
  let proofMethod = null
  if (connection.provider === 'google' && String(claims.hd || '').toLowerCase() === domain) {
    proofMethod = 'google_hd'
  } else if (connection.provider === 'microsoft') {
    const expected = entraTenantId(connection.oidc_issuer)
    if (expected && expected !== 'common' && expected !== 'organizations' && String(claims.tid || '').toLowerCase() === expected) {
      proofMethod = 'entra_tid'
    }
  }

  if (proofMethod) {
    // ON CONFLICT on the unique domain: re-running a test refreshes proof for
    // a domain this connection already owns, but must not let one tenant steal
    // a domain already verified by another.
    await query(
      `INSERT INTO sso_email_domains (id, connection_id, domain, proof_method, verified_at)
       VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (domain) DO UPDATE
         SET proof_method = EXCLUDED.proof_method, verified_at = now()
       WHERE sso_email_domains.connection_id = EXCLUDED.connection_id`,
      [uid('ssod'), connection.id, domain, proofMethod],
    )
  }

  await query(
    `UPDATE sso_connections SET last_test_at = now(), last_test_ok = true, last_test_error = NULL WHERE id = $1`,
    [connection.id],
  )

  const target = new URL(`${frontendUrl()}${safeReturnTo(stateRow.return_to)}`)
  target.searchParams.set('sso_test', 'ok')
  target.searchParams.set('sso_email', email)
  if (!proofMethod) {
    // The round trip worked but we couldn't prove domain ownership from the
    // token, so the admin still has to verify by DNS before enabling.
    target.searchParams.set('sso_domain_unverified', domain || '')
  }
  return res.redirect(target.href)
}

// POST /api/auth/sso/exchange { code } — the SPA redeems the handoff code.
router.post('/exchange', ssoLimiter, requireDb, async (req, res) => {
  const code = String(req.body.code || '')
  if (!code) return res.status(400).json({ error: 'Missing code.' })

  try {
    // Single-use: the row is deleted as it is read, so a replay finds nothing
    // even if two requests race.
    const { rows } = await query('DELETE FROM sso_login_codes WHERE code = $1 RETURNING *', [code])
    const row = rows[0]
    if (!row) return res.status(400).json({ error: 'This sign-in link has already been used or expired.' })
    if (new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ error: 'This sign-in link has expired. Please sign in again.' })
    }

    const found = await query(`${USER_WITH_SCHOOL_SELECT} WHERE u.id = $1`, [row.user_id])
    if (!found.rows[0]) return res.status(400).json({ error: 'Account no longer exists.' })

    const user = publicUser(found.rows[0])
    return res.json({ token: signToken(user), user })
  } catch (error) {
    console.error('sso exchange failed:', error)
    return res.status(500).json({ error: 'Could not complete sign-in.' })
  }
})

// ---------------------------------------------------------------------------
// Admin: a school configures its own connection
// ---------------------------------------------------------------------------

router.get('/connections', requireDb, requireAuth('school', 'school_staff', 'org', 'admin'), async (req, res) => {
  try {
    const scope = scopeFor(req.auth)
    if (!scope) return res.status(403).json({ error: 'Not allowed.' })

    const me = await query('SELECT school_id, organization_id FROM users WHERE id = $1', [req.auth.sub])
    const { school_id: schoolId, organization_id: orgId } = me.rows[0] || {}

    let rows
    if (scope.unrestricted) {
      ({ rows } = await query('SELECT * FROM sso_connections ORDER BY created_at DESC'))
    } else if (scope.schoolId) {
      ({ rows } = await query('SELECT * FROM sso_connections WHERE school_id = $1 ORDER BY created_at DESC', [schoolId]))
    } else {
      ({ rows } = await query('SELECT * FROM sso_connections WHERE organization_id = $1 ORDER BY created_at DESC', [orgId]))
    }

    const ids = rows.map((r) => r.id)
    const domains = ids.length
      ? (await query('SELECT * FROM sso_email_domains WHERE connection_id = ANY($1)', [ids])).rows
      : []

    return res.json({
      connections: rows.map((r) => publicConnection(r, domains.filter((d) => d.connection_id === r.id))),
      redirectUri: redirectUri(),
    })
  } catch (error) {
    console.error('sso list connections failed:', error)
    return res.status(500).json({ error: 'Could not load SSO connections.' })
  }
})

function resolveIssuer(provider, issuer, tenantId) {
  if (provider === 'google') return GOOGLE_ISSUER
  if (provider === 'microsoft') {
    const t = String(tenantId || '').trim()
    if (!t) return null
    return `https://login.microsoftonline.com/${t}/v2.0`
  }
  const v = String(issuer || '').trim()
  if (!v || !validator.isURL(v, { require_protocol: true, protocols: ['https'] })) return null
  return v.replace(/\/$/, '')
}

router.post('/connections', requireDb, requireAuth('school', 'school_staff', 'org', 'admin'), async (req, res) => {
  if (!hasEncryptionKey()) {
    return res.status(503).json({ error: 'APP_ENCRYPTION_KEY is not configured on the server.' })
  }
  try {
    const provider = ['google', 'microsoft', 'oidc'].includes(req.body.provider) ? req.body.provider : null
    if (!provider) return res.status(400).json({ error: 'Provider must be google, microsoft, or oidc.' })

    const issuer = resolveIssuer(provider, req.body.issuer, req.body.tenantId)
    if (!issuer) {
      return res.status(400).json({
        error: provider === 'microsoft'
          ? 'A Microsoft directory (tenant) ID is required.'
          : 'A valid https issuer URL is required.',
      })
    }

    const displayName = String(req.body.displayName || '').trim().slice(0, 100)
    const clientId = String(req.body.clientId || '').trim()
    const clientSecret = String(req.body.clientSecret || '')
    if (!displayName) return res.status(400).json({ error: 'A button label is required.' })
    if (!clientId) return res.status(400).json({ error: 'A client ID is required.' })
    if (!clientSecret) return res.status(400).json({ error: 'A client secret is required.' })

    const defaultRole = ['student', 'school_staff'].includes(req.body.defaultRole) ? req.body.defaultRole : 'student'

    const me = await query('SELECT school_id, organization_id FROM users WHERE id = $1', [req.auth.sub])
    const { school_id: schoolId, organization_id: orgId } = me.rows[0] || {}

    let ownerSchool = null
    let ownerOrg = null
    if (req.auth.role === 'school' || req.auth.role === 'school_staff') {
      if (!schoolId) return res.status(400).json({ error: 'Your account is not linked to a school.' })
      ownerSchool = schoolId
    } else if (req.auth.role === 'org') {
      if (!orgId) return res.status(400).json({ error: 'Your account is not linked to an organization.' })
      ownerOrg = orgId
    } else {
      // Platform admin acting on a school's behalf.
      ownerSchool = req.body.schoolId || null
      ownerOrg = req.body.organizationId || null
      if (!ownerSchool && !ownerOrg) {
        return res.status(400).json({ error: 'A schoolId or organizationId is required.' })
      }
    }

    const id = uid('sso')
    await query(
      `INSERT INTO sso_connections
        (id, school_id, organization_id, provider, display_name, oidc_issuer,
         oidc_client_id, oidc_client_secret_enc, default_role, jit_enabled, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false)`,
      [
        id, ownerSchool, ownerOrg, provider, displayName, issuer,
        clientId, encryptSecret(clientSecret), defaultRole,
        req.body.jitEnabled !== false,
      ],
    )

    const { rows } = await query('SELECT * FROM sso_connections WHERE id = $1', [id])
    return res.status(201).json({ connection: publicConnection(rows[0], []) })
  } catch (error) {
    console.error('sso create connection failed:', error)
    return res.status(500).json({ error: 'Could not create the SSO connection.' })
  }
})

router.patch('/connections/:id', requireDb, requireAuth('school', 'school_staff', 'org', 'admin'), async (req, res) => {
  try {
    const connection = await loadConnection(req.params.id)
    if (!connection) return res.status(404).json({ error: 'Unknown SSO connection.' })
    if (!(await assertCanManage(req.auth, connection))) return res.status(403).json({ error: 'Not allowed.' })

    const sets = []
    const params = []
    const set = (col, value) => { params.push(value); sets.push(`${col} = $${params.length}`) }

    if (typeof req.body.displayName === 'string' && req.body.displayName.trim()) {
      set('display_name', req.body.displayName.trim().slice(0, 100))
    }
    if (typeof req.body.clientId === 'string' && req.body.clientId.trim()) {
      set('oidc_client_id', req.body.clientId.trim())
    }
    if (typeof req.body.clientSecret === 'string' && req.body.clientSecret) {
      if (!hasEncryptionKey()) {
        return res.status(503).json({ error: 'APP_ENCRYPTION_KEY is not configured on the server.' })
      }
      set('oidc_client_secret_enc', encryptSecret(req.body.clientSecret))
    }
    if (['student', 'school_staff'].includes(req.body.defaultRole)) {
      set('default_role', req.body.defaultRole)
    }
    if (typeof req.body.jitEnabled === 'boolean') set('jit_enabled', req.body.jitEnabled)

    if (typeof req.body.enabled === 'boolean') {
      // Enabling a connection that has never completed a real round trip is
      // the main way a school locks its students out, so require a passing
      // test and at least one verified domain first.
      if (req.body.enabled) {
        if (!connection.last_test_ok) {
          return res.status(400).json({ error: 'Run a successful connection test before enabling SSO.' })
        }
        const { rows: verified } = await query(
          'SELECT 1 FROM sso_email_domains WHERE connection_id = $1 AND verified_at IS NOT NULL LIMIT 1',
          [connection.id],
        )
        if (!verified[0]) {
          return res.status(400).json({ error: 'Verify at least one email domain before enabling SSO.' })
        }
      }
      set('enabled', req.body.enabled)
    }

    if (!sets.length) return res.status(400).json({ error: 'Nothing to update.' })

    params.push(connection.id)
    await query(`UPDATE sso_connections SET ${sets.join(', ')} WHERE id = $${params.length}`, params)
    invalidateConfig(connection.id)

    const { rows } = await query('SELECT * FROM sso_connections WHERE id = $1', [connection.id])
    const { rows: domains } = await query('SELECT * FROM sso_email_domains WHERE connection_id = $1', [connection.id])
    return res.json({ connection: publicConnection(rows[0], domains) })
  } catch (error) {
    console.error('sso update connection failed:', error)
    return res.status(500).json({ error: 'Could not update the SSO connection.' })
  }
})

router.delete('/connections/:id', requireDb, requireAuth('school', 'school_staff', 'org', 'admin'), async (req, res) => {
  try {
    const connection = await loadConnection(req.params.id)
    if (!connection) return res.status(404).json({ error: 'Unknown SSO connection.' })
    if (!(await assertCanManage(req.auth, connection))) return res.status(403).json({ error: 'Not allowed.' })

    // Users provisioned through this connection keep their accounts (the FK is
    // ON DELETE SET NULL) but have no password, so flag them back to password
    // auth — they must use the recovery flow to regain access.
    await query(`UPDATE users SET auth_provider = 'password', sso_subject = NULL WHERE sso_connection_id = $1`, [connection.id])
    await query('DELETE FROM sso_connections WHERE id = $1', [connection.id])
    invalidateConfig(connection.id)
    return res.json({ ok: true })
  } catch (error) {
    console.error('sso delete connection failed:', error)
    return res.status(500).json({ error: 'Could not delete the SSO connection.' })
  }
})

// POST /api/auth/sso/connections/:id/test-start — returns the IdP URL for the
// admin to visit. Deliberately a POST returning a URL rather than a redirect:
// the caller is authenticated by bearer header, and a top-level navigation
// can't carry one. Putting the JWT in the query string instead would leak it
// into browser history, the Referer header, and access logs.
router.post('/connections/:id/test-start', requireDb, requireAuth('school', 'school_staff', 'org', 'admin'), async (req, res) => {
  try {
    const connection = await loadConnection(req.params.id)
    if (!connection) return res.status(404).json({ error: 'Unknown SSO connection.' })
    if (!(await assertCanManage(req.auth, connection))) return res.status(403).json({ error: 'Not allowed.' })

    // A test may run against a disabled connection — that's the whole point.
    const url = await beginAuthorization(connection, {
      purpose: 'test',
      initiatedBy: req.auth.sub,
      returnTo: req.body.returnTo || '/school/dashboard',
    })
    return res.json({ url })
  } catch (error) {
    console.error('sso test-start failed:', error)
    await query(
      `UPDATE sso_connections SET last_test_at = now(), last_test_ok = false, last_test_error = $1 WHERE id = $2`,
      [String(error.message || 'Unknown error').slice(0, 500), req.params.id],
    ).catch(() => {})
    return res.status(400).json({
      error: 'Could not reach that identity provider. Check the issuer URL, client ID, and client secret.',
    })
  }
})

// Adds a domain for a generic-OIDC connection, which must be proven by DNS TXT.
router.post('/connections/:id/domains', requireDb, requireAuth('school', 'school_staff', 'org', 'admin'), async (req, res) => {
  try {
    const connection = await loadConnection(req.params.id)
    if (!connection) return res.status(404).json({ error: 'Unknown SSO connection.' })
    if (!(await assertCanManage(req.auth, connection))) return res.status(403).json({ error: 'Not allowed.' })

    const domain = String(req.body.domain || '').trim().toLowerCase()
    if (!domain || !validator.isFQDN(domain)) return res.status(400).json({ error: 'A valid domain is required.' })

    const { rows: existing } = await query('SELECT connection_id FROM sso_email_domains WHERE domain = $1', [domain])
    if (existing[0] && existing[0].connection_id !== connection.id) {
      return res.status(409).json({ error: 'That domain is already claimed by another organization.' })
    }

    await query(
      `INSERT INTO sso_email_domains (id, connection_id, domain, proof_method, verify_token)
       VALUES ($1,$2,$3,'dns_txt',$4)
       ON CONFLICT (domain) DO NOTHING`,
      [uid('ssod'), connection.id, domain, `voluntrack-verify=${generateToken().slice(0, 32)}`],
    )

    const { rows: domains } = await query('SELECT * FROM sso_email_domains WHERE connection_id = $1', [connection.id])
    const { rows } = await query('SELECT * FROM sso_connections WHERE id = $1', [connection.id])
    return res.status(201).json({ connection: publicConnection(rows[0], domains) })
  } catch (error) {
    console.error('sso add domain failed:', error)
    return res.status(500).json({ error: 'Could not add the domain.' })
  }
})

// Checks the DNS TXT record for a pending generic-OIDC domain.
router.post('/connections/:id/domains/verify', requireDb, requireAuth('school', 'school_staff', 'org', 'admin'), async (req, res) => {
  try {
    const connection = await loadConnection(req.params.id)
    if (!connection) return res.status(404).json({ error: 'Unknown SSO connection.' })
    if (!(await assertCanManage(req.auth, connection))) return res.status(403).json({ error: 'Not allowed.' })

    const domain = String(req.body.domain || '').trim().toLowerCase()
    const { rows: found } = await query(
      'SELECT * FROM sso_email_domains WHERE connection_id = $1 AND domain = $2',
      [connection.id, domain],
    )
    const row = found[0]
    if (!row) return res.status(404).json({ error: 'That domain is not on this connection.' })
    if (row.verified_at) return res.json({ verified: true })

    const { resolveTxt } = await import('dns/promises')
    let records = []
    try {
      records = await resolveTxt(domain)
    } catch {
      return res.status(400).json({ error: 'Could not read TXT records for that domain yet. DNS changes can take a while to propagate.' })
    }

    const flat = records.map((chunks) => chunks.join('')).map((s) => s.trim())
    if (!flat.includes(row.verify_token)) {
      return res.status(400).json({ error: 'The expected TXT record was not found yet.' })
    }

    await query('UPDATE sso_email_domains SET verified_at = now() WHERE id = $1', [row.id])
    return res.json({ verified: true })
  } catch (error) {
    console.error('sso verify domain failed:', error)
    return res.status(500).json({ error: 'Could not verify the domain.' })
  }
})

export default router
