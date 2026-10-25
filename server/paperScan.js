import Anthropic from '@anthropic-ai/sdk'
import { isValidDateString, MAX_HOURS_PER_ENTRY } from './validate.js'

// Reads a photo of a paper volunteer-hours log into draft entries (#516).
// The photo goes to Anthropic's API for this one request and is never stored
// by us; the student reviews every entry before anything is saved. Off unless
// ANTHROPIC_API_KEY is set on the server.

const MODEL = 'claude-opus-5-5'
export const MAX_SCAN_ENTRIES = 60
const MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

let client = null
export function paperScanAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}
function getClient() {
  if (!client) client = new Anthropic()
  return client
}

const ENTRY_SCHEMA = {
  type: 'object',
  properties: {
    entries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD, or empty if not readable' },
          activity: { type: 'string', description: 'What the volunteer did' },
          organization: { type: 'string', description: 'Where or for whom, or empty' },
          hours: { type: 'number', description: 'Hours for this row; 0 if not readable' },
          supervisor: { type: 'string', description: 'Supervisor name, or empty' },
        },
        required: ['date', 'activity', 'organization', 'hours', 'supervisor'],
        additionalProperties: false,
      },
    },
    note: { type: 'string', description: 'One short sentence if the photo is not an hours log or is unreadable; otherwise empty' },
  },
  required: ['entries', 'note'],
  additionalProperties: false,
}

const INSTRUCTIONS = `This is a photo of a student's paper volunteer or community-service hours log.
Copy each row into an entry, exactly as written. Do not invent rows or values.
- date: as YYYY-MM-DD. If the year is missing, use {YEAR}. Leave empty if you can't read it.
- hours: the hours for that row as a number (convert times like "9-11:30" to 2.5). Use 0 if unreadable.
- Skip header rows, totals and blank rows.
If the photo isn't an hours log, return no entries and say so in note.`

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

// Keeps only values the Log Hours form would accept, so a misread can't put
// something odd into the review list.
export function cleanEntries(raw) {
  return (Array.isArray(raw) ? raw : []).slice(0, MAX_SCAN_ENTRIES).map((e) => {
    const hours = Number(e?.hours)
    const date = clip(e?.date, 10)
    return {
      date: isValidDateString(date) ? date : '',
      activity: clip(e?.activity, 200),
      orgName: clip(e?.organization, 200),
      hours: Number.isFinite(hours) && hours > 0 && hours <= MAX_HOURS_PER_ENTRY ? Math.round(hours * 4) / 4 : 0,
      supervisorName: clip(e?.supervisor, 200),
    }
  }).filter((e) => e.activity || e.hours > 0)
}

// `image` is a data URL. Returns { entries, note } or throws an Error whose
// `status` the route passes on.
export async function scanPaperLog(image, { year = new Date().getFullYear() } = {}) {
  const match = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(image || ''))
  if (!match || !MEDIA_TYPES.has(match[1])) {
    throw Object.assign(new Error('Send a JPEG, PNG or WebP photo.'), { status: 400, expose: true })
  }

  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    // On a policy decline the API retries on a fallback model inside this call.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: ENTRY_SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } },
        { type: 'text', text: INSTRUCTIONS.replace('{YEAR}', String(year)) },
      ],
    }],
  })

  if (response.stop_reason === 'refusal') {
    throw Object.assign(new Error("That photo couldn't be read. Try a clearer photo of just the hours sheet."), { status: 422, expose: true })
  }
  const text = response.content.find((b) => b.type === 'text')?.text
  let parsed
  try {
    parsed = JSON.parse(text || '{}')
  } catch {
    throw Object.assign(new Error("That photo couldn't be read. Try again with the sheet flat and well lit."), { status: 422, expose: true })
  }
  return { entries: cleanEntries(parsed.entries), note: clip(parsed.note, 300) }
}
