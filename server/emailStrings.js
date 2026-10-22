// Server-side translations for emails (#416). The app's own strings live in
// src/locales/es.js, but that is a client bundle; emails are rendered here, so
// they get this small map instead. Same convention as the client's tr(): the
// English text is the key, so a string missing from a dictionary simply goes
// out in English. Spanish is informal (tú), matching the app.
//
// A user's language is users.language ('en' | 'es' | NULL), sent by the app
// when they pick one (PUT /api/auth/me/language). NULL means "never told us"
// and gets English. Only text we write is translated — task titles, names and
// activity descriptions are the user's own words and stay as they are.

export const EMAIL_LANGUAGES = ['en', 'es']

/** Any stored/requested value → a language we can render ('en' fallback). */
export function emailLang(value) {
  return EMAIL_LANGUAGES.includes(value) ? value : 'en'
}

const ES = {
  // Shared
  'Hi {name},': 'Hola, {name}:',
  "This is an automated message — please don't reply to this email. Contact us if you run into any problems: {link}":
    'Este es un mensaje automático; por favor, no respondas a este correo. Si tienes algún problema, escríbenos: {link}',

  // Parent weekly digest (server/digest.js)
  'Weekly volunteer summary: {start} – {end}': 'Resumen semanal de voluntariado: {start} – {end}',
  "You don't have any linked students yet — once you link one, this weekly summary will show their logged hours.":
    'Todavía no tienes estudiantes vinculados. Cuando vincules uno, este resumen semanal mostrará sus horas registradas.',
  "Here's what your student logged from {start} to {end}:": 'Esto es lo que registró tu estudiante del {start} al {end}:',
  "Here's what your students logged from {start} to {end}:": 'Esto es lo que registraron tus estudiantes del {start} al {end}:',
  'No hours logged this week.': 'No registró horas esta semana.',
  '{week} h this week — {verified} h approved, {pending} h pending verification.':
    '{week} h esta semana: {verified} h aprobadas y {pending} h pendientes de verificación.',
  Date: 'Fecha',
  Activity: 'Actividad',
  Hours: 'Horas',
  Status: 'Estado',
  Unverified: 'Sin verificar',
  Pending: 'Pendiente',
  Approved: 'Aprobado',
  Rejected: 'Rechazado',
  '(no description)': '(sin descripción)',
  '…and 1 more entry.': '…y 1 registro más.',
  '…and {n} more entries.': '…y {n} registros más.',
  'All-time total: {n} h.': 'Total acumulado: {n} h.',
  'View full details on your VolunTrack dashboard': 'Ver todos los detalles en tu panel de VolunTrack',
  'Unsubscribe from these weekly emails': 'Darme de baja de estos correos semanales',

  // "Come back" nudge (server/comeback.js)
  'We miss you — here is a volunteer task near you': 'Te extrañamos: aquí tienes una tarea de voluntariado cerca de ti',
  'We miss you — here is a volunteer task coming up': 'Te extrañamos: aquí tienes una tarea de voluntariado próxima',
  'We miss you — here are {n} volunteer tasks near you': 'Te extrañamos: aquí tienes {n} tareas de voluntariado cerca de ti',
  'We miss you — here are {n} volunteer tasks coming up': 'Te extrañamos: aquí tienes {n} tareas de voluntariado próximas',
  'Hi there,': '¡Hola!',
  '{date} at {time}': '{date} a las {time}',
  "It's been a little while since you logged any volunteer hours on VolunTrack. No pressure — whenever you're ready, here is a task you could join:":
    'Hace un tiempo que no registras horas de voluntariado en VolunTrack. Sin presión: cuando quieras, aquí tienes una tarea a la que podrías unirte:',
  "It's been a little while since you logged any volunteer hours on VolunTrack. No pressure — whenever you're ready, here is a task you could join, close to where you have volunteered before:":
    'Hace un tiempo que no registras horas de voluntariado en VolunTrack. Sin presión: cuando quieras, aquí tienes una tarea a la que podrías unirte, cerca de donde ya has hecho voluntariado:',
  "It's been a little while since you logged any volunteer hours on VolunTrack. No pressure — whenever you're ready, here are a few tasks you could join:":
    'Hace un tiempo que no registras horas de voluntariado en VolunTrack. Sin presión: cuando quieras, aquí tienes algunas tareas a las que podrías unirte:',
  "It's been a little while since you logged any volunteer hours on VolunTrack. No pressure — whenever you're ready, here are a few tasks you could join, close to where you have volunteered before:":
    'Hace un tiempo que no registras horas de voluntariado en VolunTrack. Sin presión: cuando quieras, aquí tienes algunas tareas a las que podrías unirte, cerca de donde ya has hecho voluntariado:',
  'See all volunteer opportunities': 'Ver todas las oportunidades de voluntariado',
  'Already volunteering somewhere? {link} so they count.': '¿Ya haces voluntariado en algún lugar? {link} para que cuenten.',
  'Log your hours': 'Registra tus horas',
  'We send this at most once after a month without volunteering. {link} or turn them off in Settings.':
    'Te lo enviamos como máximo una vez tras un mes sin voluntariado. {link} o desactívalos en Ajustes.',
  'Stop these emails': 'Dejar de recibir estos correos',
  'We miss you!': '¡Te extrañamos!',
  'A volunteer task you could join: {titles}': 'Una tarea de voluntariado a la que podrías unirte: {titles}',
  '{n} volunteer tasks you could join: {titles}': '{n} tareas de voluntariado a las que podrías unirte: {titles}',
}

const DICTIONARIES = { es: ES }

/**
 * Translate one email string. `lang` is 'en' | 'es' (anything else → English).
 * Placeholders are {name}; values are inserted as given, so escape HTML first.
 */
export function et(lang, text, vars) {
  const dict = DICTIONARIES[emailLang(lang)]
  let out = (dict && dict[text]) || text
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m))
  return out
}

/** Short date ("Oct 13" / "13 oct") for a UTC Date, optionally with the year. */
export function emailDate(lang, date, withYear = false) {
  return date.toLocaleDateString(emailLang(lang) === 'es' ? 'es-ES' : 'en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC', ...(withYear ? { year: 'numeric' } : {}),
  }).replace(/\.$/, '').replace(/\. /, ' ')
}
