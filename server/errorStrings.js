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
const EXACT = { es: ERRORS_ES, vi: ERRORS_VI, zh: ERRORS_ZH }

/** One message in `lang` ('en' | 'es' | 'vi' | 'zh'). */
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
