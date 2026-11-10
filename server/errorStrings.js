// Error messages in the caller's language (#604). The routes write errors in
// English; translateErrors() (mounted in server.js) rewrites `error` in a JSON
// response for a request whose Accept-Language is Spanish, which the app
// always sets to its own language (src/lib/apiFetch.js).
//
// Exact messages come from ERRORS_ES (English text as the key, like the app's
// tr()). A message that isn't listed falls back to a short sentence for its
// pattern ("Could not load…", "Too many…", "… not found."), and anything else
// stays in English, so a new route never shows a blank or wrong message.
import { requestLang } from './emailStrings.js'
import { ERRORS_ES } from './errorStringsEs.js'
import { ERRORS_VI, ERRORS_ZH } from './errorStringsViZh.js'
import { ERRORS_MORE, FALLBACKS_MORE, WAIT_MORE } from './errorStringsMore.js'

const PATTERNS_ES = [
  [/^Too many .*(code|attempt)/i, 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.'],
  [/^Too many /i, 'Demasiadas solicitudes. Inténtalo de nuevo más tarde.'],
  [/^Could not (load|fetch|read|look up|check)/i, 'No se pudo cargar. Inténtalo de nuevo.'],
  [/^Could not (save|update|change|set|record)/i, 'No se pudo guardar. Inténtalo de nuevo.'],
  [/^Could not (send|submit)/i, 'No se pudo enviar. Inténtalo de nuevo.'],
  [/^Could not (delete|remove|cancel|unlink|unblock|unfollow|unsave)/i, 'No se pudo quitar. Inténtalo de nuevo.'],
  [/^Could not /i, 'No se pudo completar. Inténtalo de nuevo.'],
  [/^Failed to /i, 'No se pudo completar. Inténtalo de nuevo.'],
  [/ not found\.?$/i, 'No se encontró.'],
]

// The same fallbacks in Vietnamese and Chinese (#637), in PATTERNS_ES order.
const FALLBACKS = {
  vi: ['Thử quá nhiều lần. Hãy chờ vài phút rồi thử lại.', 'Quá nhiều yêu cầu. Vui lòng thử lại sau.', 'Không tải được. Hãy thử lại.', 'Không lưu được. Hãy thử lại.', 'Không gửi được. Hãy thử lại.', 'Không gỡ được. Hãy thử lại.', 'Không hoàn tất được. Hãy thử lại.', 'Không hoàn tất được. Hãy thử lại.', 'Không tìm thấy.'],
  zh: ['尝试次数过多，请等几分钟再试。', '请求过多，请稍后再试。', '加载失败，请重试。', '保存失败，请重试。', '发送失败，请重试。', '移除失败，请重试。', '操作未完成，请重试。', '操作未完成，请重试。', '未找到。'],
}
Object.assign(FALLBACKS, FALLBACKS_MORE)
const EXACT = { es: ERRORS_ES, vi: ERRORS_VI, zh: ERRORS_ZH, ...ERRORS_MORE }

/** One message in `lang` (any app language; English is left as is). */
export function translateError(lang, message) {
  const exact = EXACT[lang]
  if (!exact || typeof message !== 'string' || !message) return message
  if (Object.hasOwn(exact, message)) return exact[message]
  for (let i = 0; i < PATTERNS_ES.length; i++) {
    if (PATTERNS_ES[i][0].test(message)) return lang === 'es' ? PATTERNS_ES[i][1] : FALLBACKS[lang][i]
  }
  return message
}

/** Express middleware: translates `error` in JSON responses for Spanish callers. */
export function translateErrors(req, res, next) {
  const lang = requestLang(req)
  if (lang === 'en') return next()
  const json = res.json.bind(res)
  res.json = (body) => {
    if (body && typeof body === 'object' && !Array.isArray(body) && typeof body.error === 'string' && res.statusCode >= 400) {
      return json({ ...body, error: translateError(lang, body.error) })
    }
    return json(body)
  }
  next()
}

// "Too many requests" says how long to wait (#734): the rate limiters set
// Retry-After / RateLimit-Reset (seconds) on a 429, so the message names the
// minutes left instead of "later". Mounted after translateErrors, so it sees
// the English text first and writes the caller's language itself.
const WAIT = {
  en: (n) => `Please try again in ${n} ${n === 1 ? 'minute' : 'minutes'}.`,
  es: (n) => `Demasiadas solicitudes. Inténtalo de nuevo en ${n} ${n === 1 ? 'minuto' : 'minutos'}.`,
  vi: (n) => `Quá nhiều yêu cầu. Vui lòng thử lại sau ${n} phút.`,
  zh: (n) => `请求过多，请在 ${n} 分钟后再试。`,
  ...Object.fromEntries(Object.entries(WAIT_MORE).map(([l, text]) => [l, (n) => text.replace('{n}', n)])),
}
export function waitMinutes(res) {
  const sec = Number(res.getHeader('Retry-After') ?? res.getHeader('RateLimit-Reset'))
  return Number.isFinite(sec) && sec > 0 ? Math.max(1, Math.ceil(sec / 60)) : null
}
export function rateLimitWaitMessage(lang, message, minutes) {
  if (lang !== 'en') return WAIT[lang]?.(minutes) || message
  const base = String(message || 'Too many requests.').replace(/\s*(Please )?try again( later| in a few minutes)?\.?$/i, '').trim()
  return `${base} ${WAIT.en(minutes)}`
}
export function rateLimitWait(req, res, next) {
  const lang = requestLang(req)
  const json = res.json.bind(res)
  res.json = (body) => {
    if (res.statusCode === 429 && body && typeof body === 'object' && typeof body.error === 'string') {
      const n = waitMinutes(res)
      if (n) return json({ ...body, error: rateLimitWaitMessage(lang, body.error, n), retryAfterMinutes: n })
    }
    return json(body)
  }
  next()
}
