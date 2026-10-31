// OpenAPI 3.1 description of /api/v1 (#622, part 4), served without a key at
// GET /api/v1/openapi.json so tools (Postman, code generators) can read it.
// Keep it in step with server/routes/apiV1.js and server/webhooks.js.
const page = { type: 'object', properties: { data: { type: 'array', items: {} }, nextCursor: { type: ['string', 'null'] } } }
const cursorParams = [
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 } },
  { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'nextCursor from the previous page.' },
]
const schoolParam = { name: 'schoolId', in: 'query', schema: { type: 'string' }, description: 'Organization keys: one of your schools.' }
const date = (name) => ({ name, in: 'query', schema: { type: 'string', format: 'date' } })
const ok = (description, schema = { type: 'object' }) => ({ 200: { description, content: { 'application/json': { schema } } } })
const op = (summary, scope, params, schema) => ({ summary, security: [{ apiKey: [] }], 'x-scope': scope, parameters: params, responses: { ...ok(summary, schema), 401: { description: 'Missing, invalid or revoked key' }, 403: { description: 'Missing permission or wrong kind of key' } } })

export function openApiSpec(serverUrl) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'VolunTrack API',
      version: '1.0.0',
      description: 'Read-only API for schools, organizations and event organizers. Make a key in VolunTrack under Settings → API keys. Errors look like { "error": { "code", "message" } }.',
    },
    servers: [{ url: `${serverUrl}/api/v1` }],
    components: { securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', description: 'vt_live_… or vt_test_… (test keys return sample data)' } } },
    paths: {
      '/me': { get: op('The key and who it belongs to', null, [], { type: 'object' }) },
      '/schools': { get: op('Schools this key covers', null, [], page) },
      '/students': { get: op('Students', 'students:read', [...cursorParams, schoolParam], page) },
      '/students/{id}': { get: op('One student', 'students:read', [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }]) },
      '/students/{id}/hours': { get: op("A student's hours", 'hours:read', [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, ...cursorParams, date('from'), date('to')], page) },
      '/hours': {
        get: op('Hours logged', 'hours:read', [...cursorParams, schoolParam, date('from'), date('to'),
          { name: 'status', in: 'query', schema: { enum: ['unconfirmed', 'approved', 'rejected'] } },
          { name: 'studentId', in: 'query', schema: { type: 'string' } },
          { name: 'createdSince', in: 'query', schema: { type: 'string', format: 'date-time' } }], page),
      },
      '/progress': { get: op('Progress toward the requirement, per student', 'progress:read', [schoolParam], page) },
      '/progress/summary': { get: op('Progress counts', 'progress:read', [schoolParam]) },
      '/reports/impact': { get: op('Impact report numbers', 'reports:read', [schoolParam, { name: 'period', in: 'query', schema: { enum: ['year', 'all'] } }, date('from'), date('to')]) },
      '/events': { get: op("The organizer's events", 'events:read', [...cursorParams, date('from'), date('to')], page) },
      '/events/{id}/signups': { get: op('Sign-ups for an event', 'events:read', [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], page) },
      '/events/{id}/attendance': { get: op('Attendance for an event', 'events:read', [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], page) },
    },
    webhooks: Object.fromEntries(['hours.created', 'hours.approved', 'hours.rejected', 'student.joined', 'student.left', 'requirement.met', 'event.signup', 'event.attendance'].map((e) => [e, {
      post: {
        summary: e,
        parameters: [{ name: 'VolunTrack-Signature', in: 'header', required: true, schema: { type: 'string' }, description: 't=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body" with your signing secret>' }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' }, type: { const: e }, createdAt: { type: 'string' }, data: { type: 'object' } } } } } },
        responses: { 200: { description: 'Any 2xx counts as delivered' } },
      },
    }])),
  }
}
