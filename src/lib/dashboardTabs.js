// Each dashboard tab has its own address (#579), like /status/:tab and
// /admin/:tab: a reload stays on the tab, Back goes to the previous tab, and a
// tab can be linked to (from an email, a message, a bookmark). The dashboards
// keep their own tab state; these turn it into a path and back. The URL slugs
// are what people see, so a few differ from the internal names (pdfs → reports,
// chat → messages).

const SCHOOL_TABS = {
  reports: { key: 'pdfs', sub: 'reportTab', subs: ['documents', 'hours'] },
  students: { key: 'students', sub: 'subTab', subs: ['list', 'progress', 'graduation', 'add'] },
  volunteer: { key: 'volunteer' },
  setup: { key: 'setup', sub: 'setupTab', subs: ['staff', 'requirements', 'sso', 'domain', 'branding', 'billing'] },
  messages: { key: 'chat' },
}
const SCHOOL_BASE = '/school/dashboard'
const SCHOOL_DEFAULT = 'reports'

/** The school dashboard's tab state for /school/dashboard/:tab?/:sub?. */
export function schoolTabsFromPath(tabParam, subParam) {
  const slug = String(tabParam || SCHOOL_DEFAULT).toLowerCase()
  const def = SCHOOL_TABS[slug] || SCHOOL_TABS[SCHOOL_DEFAULT]
  const sub = String(subParam || '').toLowerCase()
  const state = { tab: def.key, subTab: 'list', reportTab: 'documents', setupTab: 'staff' }
  if (def.sub) state[def.sub] = def.subs.includes(sub) ? sub : def.subs[0]
  return state
}

/** The path for the school dashboard's current tab state. */
export function schoolPathFor({ tab, subTab, reportTab, setupTab }) {
  const [slug, def] = Object.entries(SCHOOL_TABS).find(([, d]) => d.key === tab) || [SCHOOL_DEFAULT, SCHOOL_TABS[SCHOOL_DEFAULT]]
  const sub = def.sub ? { subTab, reportTab, setupTab }[def.sub] : null
  const sub0 = def.subs?.[0]
  if (slug === SCHOOL_DEFAULT && (!sub || sub === sub0)) return SCHOOL_BASE
  return `${SCHOOL_BASE}/${slug}${sub && def.subs.includes(sub) && sub !== sub0 ? `/${sub}` : ''}`
}

const ORG_TABS = ['schools', 'hours', 'requirements', 'announcements', 'invites']
const ORG_BASE = '/organization/dashboard'

export function orgTabFromPath(tabParam) {
  const slug = String(tabParam || '').toLowerCase()
  return ORG_TABS.includes(slug) ? slug : 'schools'
}

export function orgPathFor(tab) {
  return tab === 'schools' || !ORG_TABS.includes(tab) ? ORG_BASE : `${ORG_BASE}/${tab}`
}
