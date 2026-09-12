// Files a GitHub issue when /api/status/health auto-detects an incident, and
// closes it again on recovery — the inside-out counterpart to
// .github/workflows/keep-warm.yml, which watches from outside and can only see
// "the backend is unreachable". A Database or Email failure is invisible to
// that workflow (the ping still returns 200), so until now those incidents
// lived only on /status and in one email; nothing landed anywhere the work of
// fixing them actually happens. The Email incident is the sharpest case: it is
// raised precisely when email is broken, so its own notification cannot arrive.
//
// Entirely opt-in, same posture as SSO and tenant storage: with
// GITHUB_ISSUE_TOKEN / GITHUB_ISSUE_REPO unset every call is a no-op and the
// incident is recorded exactly as before.
//
// Issues are filed under the `incident` label, never `outage`: keep-warm.yml
// keys off "is there an open `outage` issue?" to decide whether to open one,
// so filing ours under that label would suppress a real outage issue and let
// the workflow close ours the next time it pinged successfully. Both labels are
// in INCIDENT_LABELS in server/routes/status.js, so either still syncs.

const API_BASE = 'https://api.github.com'
const LABEL = 'incident'

function token() { return process.env.GITHUB_ISSUE_TOKEN || '' }
function repo() { return (process.env.GITHUB_ISSUE_REPO || '').trim() }

export function githubIssuesConfigured() {
  return Boolean(token() && /^[\w.-]+\/[\w.-]+$/.test(repo()))
}

// Stamped into the issue body so the `opened` webhook delivery — which can
// arrive before the POST that created the issue has returned its URL to us —
// can tell "VolunTrack filed this for incident X" from "a human opened an
// issue", instead of opening a second, duplicate incident for our own issue.
const MARKER = /<!--\s*voluntrack-incident:([\w-]+)\s*-->/

export function incidentMarker(incidentId) {
  return `<!-- voluntrack-incident:${incidentId} -->`
}

export function incidentIdFromIssueBody(body) {
  const match = MARKER.exec(String(body || ''))
  return match ? match[1] : null
}

async function gh(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    // A slow GitHub must never hold up the caller; /health is polled on a timer.
    signal: AbortSignal.timeout(10000),
  })

  let data = null
  try { data = await res.json() } catch { /* 204s and error pages */ }

  if (!res.ok) {
    const err = new Error(`GitHub: ${data?.message || `HTTP ${res.status}`}`)
    err.status = res.status
    throw err
  }
  return data
}

// The label has to exist before an issue can carry it on some repos, and it
// is what the webhook's INCIDENT_LABELS gate looks for. 422 means it already
// exists, which is the normal case after the first ever incident.
async function ensureLabel() {
  try {
    await gh(`/repos/${repo()}/labels`, {
      method: 'POST',
      body: { name: LABEL, color: 'B60205', description: 'Service incident (opened and closed by the backend health check)' },
    })
  } catch (error) {
    if (error.status !== 422) throw error
  }
}

/**
 * Opens an issue for an auto-detected incident. Returns its html_url, or null
 * if GitHub isn't configured. Never throws — a failure to file the issue must
 * not change whether the incident itself was recorded.
 */
export async function openIncidentIssue({ incidentId, service, detail, statusUrl }) {
  if (!githubIssuesConfigured()) return null
  try {
    await ensureLabel()
    const body = [
      `**${service}** failed an automated health check at ${new Date().toISOString()}.`,
      detail || null,
      statusUrl ? `Status page: ${statusUrl}` : null,
      'Filed automatically by the backend health check. It closes itself once the check passes again.',
      incidentMarker(incidentId),
    ].filter(Boolean).join('\n\n')

    const issue = await gh(`/repos/${repo()}/issues`, {
      method: 'POST',
      body: { title: `${service} health check failing`, body, labels: [LABEL] },
    })
    return issue?.html_url || null
  } catch (error) {
    console.error('openIncidentIssue failed:', error.message)
    return null
  }
}

// Only touches issues on our own configured repo — issue_url can also hold an
// admin-supplied link to somewhere else entirely (POST /api/status/incidents
// accepts any https://github.com/... URL), and recovering from a database blip
// must never close a stranger's issue.
function issueNumberFor(issueUrl) {
  const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)$/.exec(String(issueUrl || ''))
  if (!match || match[1].toLowerCase() !== repo().toLowerCase()) return null
  return match[2]
}

/** Closes the issue an incident was filed under. Never throws. */
export async function closeIncidentIssue(issueUrl, comment) {
  if (!githubIssuesConfigured()) return false
  const number = issueNumberFor(issueUrl)
  if (!number) return false
  try {
    if (comment) {
      await gh(`/repos/${repo()}/issues/${number}/comments`, { method: 'POST', body: { body: comment } })
    }
    await gh(`/repos/${repo()}/issues/${number}`, { method: 'PATCH', body: { state: 'closed' } })
    return true
  } catch (error) {
    console.error('closeIncidentIssue failed:', error.message)
    return false
  }
}
