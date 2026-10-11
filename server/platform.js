// Where an account was created, for the admin's sign-up counts. Derived from
// the request's Origin rather than anything the client says: the native apps
// (Capacitor) serve their bundle from two fixed origins — the same ones in
// the CORS allowlist in server.js — and everything else is a browser.
const APP_ORIGINS = {
  'https://localhost': 'android',
  'capacitor://localhost': 'ios',
}

export const SIGNUP_PLATFORMS = ['web', 'android', 'ios']

export function signupPlatform(req) {
  return APP_ORIGINS[req.headers?.origin] || 'web'
}
