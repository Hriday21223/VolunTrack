// Files a GitHub issue for an automatically detected incident.
//
// Why this exists: an auto incident (Database, Email) previously announced
// itself only by email — and the Email incident is, by definition, raised when
// email is broken, so that notification cannot arrive. A GitHub issue is the
// one channel that still works when SMTP is down, and it gives the incident a
// place to be discussed and closed.
//
// Unset env vars mean "off": both functions return null and log, rather than
// throwing, so a backend with no token behaves exactly as it did before. Same
// posture as SSO and tenant storage, which no-op without their keys.
const API = 'https://api.github.com'

// Deliberately not `outage`: that label belongs to keep-warm.yml, which decides
// whether to open a backend-unreachable issue by asking "is an `outage` issue
// already open?" and closes the first one it finds as soon as the ping succeeds.
// A Database or Email failure never stops that ping — /health still answers 200,
// which is why keep-warm.yml leaves those to us — so filing ours as `outage`
// would both suppress a genuine outage issue and get ours closed, still broken,
// on the next successful run. `incident` is the other member of INCIDENT_LABELS
// in server/routes/status.js, so the webhook sync still picks it up.
const ISSUE_LABEL = 'incident'

function config() {
  const token = process.env.GITHUB_ISSUE_TOKEN
  const repo = process.env.GITHUB_ISSUE_REPO
  if (!token || !repo) return null
  // owner/repo only — a full URL or a trailing slash would build a 404 path.
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    console.error(`GITHUB_ISSUE_REPO must be "owner/repo", got: ${repo.replace(/\n|\r/g, '')}`)
    return null
  }
  return { token, repo }
}

export function hasIssueFiling() {
  return Boolean(config())
}

// Written into the issue body so the webhook can match the issue back to the
// incident that opened it. Without this, the `opened` delivery we trigger
// ourselves would look like a brand new incident and insert a duplicate row —
// and it can arrive before the issue_url UPDATE lands, so matching on the URL
// alone is a race. The marker makes the two orderings equivalent.
export function incidentMarker(incidentId) {
  return `<!-- voluntrack-incident:${incidentId} -->`
}

const MARKER_RE = /<!--\s*voluntrack-incident:([A-Za-z0-9_]+)\s*-->/

export function parseIncidentMarker(body) {
  return MARKER_RE.exec(String(body || ''))?.[1] || null
}

async function gh(path, init = {}) {
  const cfg = config()
  if (!cfg) return null
  const res = await fetch(`${API}/repos/${cfg.repo}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...init.headers,
    },
    // A slow GitHub must not hold a health check open.
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) {
    throw new Error(`GitHub ${init.method || 'GET'} ${path} failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
  }
  return res.json()
}

// A label passed on a new issue has to exist first, and no repo starts with an
// `incident` label — keep-warm.yml creates its own (`gh label create outage
// --force`) for exactly this reason. Best-effort and never fatal: the usual case
// after the first incident is a 422 meaning it is already there, and if we can't
// create it at all, filing the issue still matters more than labelling it.
async function ensureLabel() {
  try {
    await gh('/labels', {
      method: 'POST',
      body: JSON.stringify({
        name: ISSUE_LABEL,
        color: 'B60205',
        description: 'Service incident (opened and closed by the backend health check)',
      }),
    })
  } catch {
    // Already exists, or we lack permission to create it — carry on regardless.
  }
}

// Returns the new issue's html_url, or null when filing is off or fails.
// Never throws: a failure here must not turn a health check into a 500.
export async function createIncidentIssue({ service, detail, incidentId }) {
  if (!config()) return null
  try {
    await ensureLabel()
    const body = [
      detail || 'An automated health check failed.',
      '',
      'Filed automatically by the VolunTrack backend health check. It closes when the check passes again.',
      incidentMarker(incidentId),
    ].join('\n')
    const issue = await gh('/issues', {
      method: 'POST',
      body: JSON.stringify({ title: service, body, labels: [ISSUE_LABEL] }),
    })
    return issue?.html_url || null
  } catch (error) {
    console.error('filing incident issue failed:', error.message)
    return null
  }
}

// Closes the issue an incident filed, so a recovered service doesn't leave a
// stale open issue behind. Best-effort for the same reason as above.
export async function closeIncidentIssue(issueUrl, comment) {
  if (!config()) return false
  const number = /\/issues\/(\d+)(?:[?#].*)?$/.exec(String(issueUrl || ''))?.[1]
  if (!number) return false
  try {
    if (comment) {
      await gh(`/issues/${number}/comments`, { method: 'POST', body: JSON.stringify({ body: comment }) })
    }
    await gh(`/issues/${number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) })
    return true
  } catch (error) {
    console.error('closing incident issue failed:', error.message)
    return false
  }
}
