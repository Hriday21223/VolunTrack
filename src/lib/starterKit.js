// School starter kit (#491): the join link, the ready-to-send messages and
// the flyer text an adviser hands to students. Used by SchoolStarterKit (the
// dashboard card), SchoolFlyer (the printable page) and JoinSchool (where the
// link lands).
import { isNativeApp } from '@/lib/platform.js'

// The phone app's own origin is a localhost nobody else can open, so links
// made in the app use the public site instead.
export const SITE = ((isNativeApp && import.meta.env.VITE_SITE_URL) || window.location.origin).replace(/\/$/, '')

export function joinUrl(pin) {
  return `${SITE}/join/${encodeURIComponent(String(pin || '').trim().toLowerCase())}`
}

// "https://volunteer-track-two.vercel.app/join/abc-123" → without the scheme,
// for print, where nobody can click it anyway.
export function shortUrl(url) {
  return String(url).replace(/^https?:\/\//, '')
}

// The flyer and the messages go to students and families, so they come in
// both languages regardless of the adviser's own.
const COPY = {
  en: {
    flyerTitle: 'Track your volunteer hours with VolunTrack',
    flyerSub: '{school} uses VolunTrack to collect and approve service hours.',
    steps: [
      'Scan the code with your phone camera.',
      'Create your free account (or sign in).',
      'Log your hours. We send them to {school} for approval.',
    ],
    scan: 'Scan to join',
    orVisit: 'Or go to',
    code: 'School code',
    free: 'Free for students. Works on any phone or computer.',
    emailSubject: 'Log your volunteer hours on VolunTrack',
    email:
      'Hi everyone,\n\n{school} is using VolunTrack to track volunteer and service hours this year. It is free, and it takes about a minute to set up.\n\n1. Open this link: {url}\n2. Create your account (or sign in), and you will be added to {school}.\n3. Log your hours after each event. I will review and approve them in VolunTrack.\n\nIf the link asks for a school code, use: {code}\n\nYou can see your total and your goal any time, and download a report when it is due.\n\nThank you!',
    short: 'Log your volunteer hours for {school} on VolunTrack. It is free: {url} (school code: {code})',
  },
  es: {
    flyerTitle: 'Registra tus horas de voluntariado con VolunTrack',
    flyerSub: '{school} usa VolunTrack para recibir y aprobar las horas de servicio.',
    steps: [
      'Escanea el código con la cámara de tu teléfono.',
      'Crea tu cuenta gratis (o inicia sesión).',
      'Registra tus horas. Se las enviamos a {school} para su aprobación.',
    ],
    scan: 'Escanea para unirte',
    orVisit: 'O entra en',
    code: 'Código de la escuela',
    free: 'Gratis para estudiantes. Funciona en cualquier teléfono o computadora.',
    emailSubject: 'Registra tus horas de voluntariado en VolunTrack',
    email:
      'Hola a todos:\n\nEste año {school} usa VolunTrack para llevar las horas de voluntariado y servicio. Es gratis y se configura en un minuto.\n\n1. Abre este enlace: {url}\n2. Crea tu cuenta (o inicia sesión) y quedarás en {school}.\n3. Registra tus horas después de cada evento. Yo las revisaré y aprobaré en VolunTrack.\n\nSi el enlace pide un código de escuela, usa: {code}\n\nPuedes ver tu total y tu meta cuando quieras, y descargar un informe cuando haya que entregarlo.\n\n¡Gracias!',
    short: 'Registra tus horas de voluntariado para {school} en VolunTrack. Es gratis: {url} (código de la escuela: {code})',
  },
}

export const KIT_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
]

function fill(text, vars) {
  return text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m))
}

/** Every string of the kit for one language, with the school filled in. */
export function kitCopy(lang, { school, pin }) {
  const c = COPY[lang] || COPY.en
  const url = joinUrl(pin)
  const vars = { school, url, code: pin }
  return {
    url,
    flyerTitle: c.flyerTitle,
    flyerSub: fill(c.flyerSub, vars),
    steps: c.steps.map((s) => fill(s, vars)),
    scan: c.scan,
    orVisit: c.orVisit,
    code: c.code,
    free: c.free,
    emailSubject: c.emailSubject,
    email: fill(c.email, vars),
    short: fill(c.short, vars),
  }
}
