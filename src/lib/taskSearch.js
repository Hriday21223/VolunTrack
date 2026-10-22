// Searching and sharing volunteer tasks on Opportunities. Pure on purpose (no
// imports), so it can be checked from Node as well as used by the page.

// The server sends the whole open-task list (no paging), so search runs on the
// list already loaded, alongside the radius/category/date filters.
export const MAX_SEARCH_LENGTH = 100

// Lower-cased, accents dropped ("Jardín" finds "jardin" and the other way
// round), spaces squeezed.
export function normalizeSearch(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// The search box's value as it is kept in the URL: trimmed and capped.
export function cleanSearch(text) {
  return String(text ?? '').slice(0, MAX_SEARCH_LENGTH).trim()
}

// Every word typed must appear somewhere in the task: its title, description,
// location, organizer name or category. `extra` takes more text to match
// (e.g. the category's translated name). Plain substring checks, so % _ ' and
// other punctuation are just characters.
export function taskMatchesSearch(task, search, extra = []) {
  const words = normalizeSearch(cleanSearch(search)).split(' ').filter(Boolean)
  if (words.length === 0) return true
  const haystack = normalizeSearch(
    [task?.title, task?.description, task?.location, task?.creator_name, task?.category, ...extra]
      .filter(Boolean)
      .join(' \n '),
  )
  return words.every((w) => haystack.includes(w))
}

// The public web address of a task. `origin` is the website's own origin —
// in the apps the page runs on capacitor://localhost or https://localhost,
// so the caller passes VITE_SITE_URL there instead.
export function taskShareUrl(taskId, origin) {
  return `${String(origin || '').replace(/\/+$/, '')}/opportunities?task=${encodeURIComponent(taskId)}`
}
