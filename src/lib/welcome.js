// The one-time /welcome setup after sign-up (#284).
//
// Register can't navigate there itself: it sits behind PublicOnly, which
// redirects to "/" the moment the new session exists, racing any navigate()
// Register makes afterwards. So Register leaves this note and Home() sends a
// new student or volunteer on to /welcome. sessionStorage, not localStorage:
// it belongs to this one sign-up in this one tab, and must never resurface on
// another device or a later visit.
const KEY = 'voluntrack:welcome-pending'

// Carries the school code typed at sign-up (if any) so /welcome can join it
// and show the result — the sign-up form used to send it and ignore the answer.
export function markWelcomePending({ schoolCode = '' } = {}) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ schoolCode: schoolCode.trim() })) } catch { /* storage off: no welcome step */ }
}

export function readWelcomePending() {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function clearWelcomePending() {
  try { sessionStorage.removeItem(KEY) } catch { /* nothing to clear */ }
}
