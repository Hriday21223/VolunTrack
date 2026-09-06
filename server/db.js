import pg from 'pg'

const { Pool } = pg

// Single shared pool. DATABASE_URL is required for the server-backed features
// (accounts, school dashboards). When it is unset the server still boots and
// the email-only endpoints keep working, but the data API returns 503.
let pool = null

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL)
}

export function getPool() {
  if (!hasDatabase()) return null
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Managed Postgres (Render/Neon/etc.) requires TLS; local dev does not.
      ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
    })
    // Managed Postgres (e.g. Neon) closes idle connections; without this
    // listener that surfaces as an unhandled 'error' event that crashes the
    // whole process. A dropped idle client is not fatal — pg-pool discards
    // it and opens a new one on the next query.
    pool.on('error', (err) => {
      console.error('Postgres pool idle client error:', err.message)
    })
  }
  return pool
}

export async function query(text, params) {
  const p = getPool()
  if (!p) throw new Error('DATABASE_URL is not configured.')
  return p.query(text, params)
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schools (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  pin             TEXT UNIQUE NOT NULL,
  contact_email   TEXT,
  payment_status  TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('paid','unpaid','pending','rejected')),
  payment_notes   TEXT,
  paid_at         TIMESTAMPTZ,
  payment_confirmation_ref TEXT,
  admin_notes     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  role          TEXT NOT NULL CHECK (role IN ('admin','school','school_staff','student','volunteer','parent','org')),
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  school_id     TEXT REFERENCES schools(id) ON DELETE SET NULL,
  grade         TEXT,
  sync_pin      TEXT UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS logs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  activity    TEXT,
  category    TEXT,
  hours       NUMERIC NOT NULL DEFAULT 0,
  notes       TEXT,
  verified_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS goals (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label      TEXT,
  target     NUMERIC NOT NULL DEFAULT 0,
  period     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pdf_uploads (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school_id     TEXT REFERENCES schools(id) ON DELETE SET NULL,
  filename      TEXT NOT NULL,
  file_data     TEXT NOT NULL,
  file_type     TEXT NOT NULL DEFAULT 'application/pdf',
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  notes         TEXT,
  reviewed_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_school_id ON users(school_id);
CREATE INDEX IF NOT EXISTS idx_logs_user_id    ON logs(user_id);
CREATE INDEX IF NOT EXISTS idx_goals_user_id   ON goals(user_id);
CREATE TABLE IF NOT EXISTS public_tasks (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  location        TEXT NOT NULL,
  date            DATE NOT NULL,
  time            TEXT,
  slots_total     INTEGER NOT NULL DEFAULT 1,
  created_by      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  creator_name    TEXT,
  creator_email   TEXT,
   phone           TEXT,
   important_info  TEXT,
   latitude        DECIMAL(10,7),
  longitude       DECIMAL(10,7),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public_task_signups (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL REFERENCES public_tasks(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  signed_up_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(task_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_public_tasks_status ON public_tasks(status);
CREATE INDEX IF NOT EXISTS idx_public_signups_task ON public_task_signups(task_id);
CREATE INDEX IF NOT EXISTS idx_public_signups_user ON public_task_signups(user_id);

CREATE TABLE IF NOT EXISTS school_messages (
  id          TEXT PRIMARY KEY,
  school_id   TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  sender_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_name TEXT,
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_school_messages_school ON school_messages(school_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_notifications (
  id          TEXT PRIMARY KEY,
  school_id   TEXT REFERENCES schools(id) ON DELETE CASCADE,
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supervisor_verifications (
  id               TEXT PRIMARY KEY,
  token            TEXT UNIQUE NOT NULL,
  student_name     TEXT NOT NULL,
  supervisor_name  TEXT,
  supervisor_email TEXT NOT NULL,
  activity         TEXT NOT NULL,
  hours            NUMERIC NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_supervisor_verifications_token ON supervisor_verifications(token);

CREATE TABLE IF NOT EXISTS parent_child_links (
  parent_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  child_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (parent_id, child_id)
);

CREATE INDEX IF NOT EXISTS idx_parent_child_links_child ON parent_child_links(child_id);

CREATE TABLE IF NOT EXISTS school_invites (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  token         TEXT UNIQUE NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','expired','completed')),
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_school_invites_token ON school_invites(token);

CREATE TABLE IF NOT EXISTS organizations (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  contact_email TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organization_invites (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  token         TEXT UNIQUE NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','expired','completed')),
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_organization_invites_token ON organization_invites(token);

-- A contact-form submission and every reply in its thread (admin outbound,
-- visitor inbound via the Resend webhook) share one thread_id, so the whole
-- conversation can be displayed and matched against incoming replies.
CREATE TABLE IF NOT EXISTS contact_messages (
  id          TEXT PRIMARY KEY,
  thread_id   TEXT NOT NULL,
  direction   TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  name        TEXT,
  email       TEXT NOT NULL,
  subject     TEXT,
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_messages_thread ON contact_messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_contact_messages_email ON contact_messages(email);

-- App reviews (rating + optional comment), prompted after a user's first
-- logged hour. Submitted by both server-backed and client-only (no
-- account) users, so name/email are nullable.
CREATE TABLE IF NOT EXISTS reviews (
  id                        TEXT PRIMARY KEY,
  rating                    INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment                   TEXT,
  name                      TEXT,
  email                     TEXT,
  role                      TEXT,
  user_id                   TEXT,
  approved                  BOOLEAN NOT NULL DEFAULT false,
  pending_consent_choice    TEXT CHECK (pending_consent_choice IN ('yes','no')),
  consent_choice            TEXT CHECK (consent_choice IN ('yes','no')),
  consent_pin_hash          TEXT,
  consent_pin_expires_at    TIMESTAMPTZ,
  consent_pin_attempts      INTEGER NOT NULL DEFAULT 0,
  publish_at                TIMESTAMPTZ,
  expires_at                TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
`

// Idempotent: safe to run on every boot. Creates tables if missing.
export async function initSchema() {
  if (!hasDatabase()) return false
  await query(SCHEMA)
  // Migration: add columns that may not exist on older databases
  try { await query(`ALTER TABLE public_tasks ADD COLUMN IF NOT EXISTS phone TEXT`) } catch {}
  try { await query(`ALTER TABLE public_tasks ADD COLUMN IF NOT EXISTS important_info TEXT`) } catch {}
  try { await query(`ALTER TABLE public_task_signups ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected'))`) } catch {}
  try { await query(`ALTER TABLE public_tasks ADD COLUMN IF NOT EXISTS latitude DECIMAL(10,7)`) } catch {}
  try { await query(`ALTER TABLE public_tasks ADD COLUMN IF NOT EXISTS longitude DECIMAL(10,7)`) } catch {}
  try { await query(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid'`) } catch {}
  try { await query(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS payment_notes TEXT`) } catch {}
  try { await query(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`) } catch {}
  try { await query(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS payment_due_date DATE`) } catch {}
  try { await query(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS payment_confirmation_ref TEXT`) } catch {}
  // Internal-only note for admins — never exposed to the school (see /info and /admin/list column lists).
  try { await query(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS admin_notes TEXT`) } catch {}
  try { await query(`ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_payment_status_check`) } catch {}
  try { await query(`ALTER TABLE schools ADD CONSTRAINT schools_payment_status_check CHECK (payment_status IN ('paid','unpaid','pending','rejected'))`) } catch {}
  // Custom per-school price (e.g. "$200" billed "monthly" or "yearly") — set by admin, shown on payment notices.
  try { await query(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS price_amount TEXT`) } catch {}
  try { await query(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS price_period TEXT`) } catch {}
  try { await query(`ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_price_period_check`) } catch {}
  try { await query(`ALTER TABLE schools ADD CONSTRAINT schools_price_period_check CHECK (price_period IS NULL OR price_period IN ('monthly','yearly','one_time'))`) } catch {}
  try { await query(`ALTER TABLE admin_notifications ADD COLUMN IF NOT EXISTS school_id TEXT REFERENCES schools(id) ON DELETE CASCADE`) } catch {}
  // 2FA columns
  try { await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT`) } catch {}
  try { await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false`) } catch {}
  try { await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS backup_codes TEXT`) } catch {}
  try { await query(`ALTER TABLE supervisor_verifications ADD COLUMN IF NOT EXISTS student_email TEXT`) } catch {}

  // Password reset. The code itself is never stored — only a bcrypt hash of
  // the server-generated code, so a database read can't be turned into a
  // reset. reset_code_attempts caps guessing against the 6-digit space.
  try { await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code_hash TEXT`) } catch {}
  try { await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code_expires_at TIMESTAMPTZ`) } catch {}
  try { await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code_attempts INTEGER NOT NULL DEFAULT 0`) } catch {}

  // Parent portal
  try { await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS child_link_code TEXT UNIQUE`) } catch {}
  try { await query(`ALTER TABLE logs ADD COLUMN IF NOT EXISTS supervisor_name TEXT`) } catch {}
  try { await query(`ALTER TABLE logs ADD COLUMN IF NOT EXISTS supervisor_email TEXT`) } catch {}
  try {
    await query(`ALTER TABLE logs ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'none' CHECK (verification_status IN ('none','pending','approved','rejected'))`)
  } catch {}
  try { await query(`ALTER TABLE logs ADD COLUMN IF NOT EXISTS verification_token TEXT UNIQUE`) } catch {}

  // Organization details schools require on a verification form, separate
  // from the free-text "location" (where the service happened) — the org's
  // own name/address/phone for their records.
  try { await query(`ALTER TABLE logs ADD COLUMN IF NOT EXISTS location TEXT`) } catch {}
  try { await query(`ALTER TABLE logs ADD COLUMN IF NOT EXISTS org_name TEXT`) } catch {}
  try { await query(`ALTER TABLE logs ADD COLUMN IF NOT EXISTS org_address TEXT`) } catch {}
  try { await query(`ALTER TABLE logs ADD COLUMN IF NOT EXISTS org_phone TEXT`) } catch {}
  // Drawn signature (base64 PNG data URL from a canvas) — supersedes the
  // typed-name version, which was never anything more than a text string.
  try { await query(`ALTER TABLE logs ADD COLUMN IF NOT EXISTS supervisor_signature TEXT`) } catch {}

  // Links a log to the public task it was earned under, when applicable —
  // lets a task's host review/verify a student's self-logged hours by actual
  // task ownership instead of matching free-text activity against task title.
  try { await query(`ALTER TABLE logs ADD COLUMN IF NOT EXISTS task_id TEXT REFERENCES public_tasks(id) ON DELETE SET NULL`) } catch {}
  try { await query(`CREATE INDEX IF NOT EXISTS idx_logs_task_id ON logs(task_id)`) } catch {}

  // A school-issued ID card number — distinct from `school_id`, which is an
  // internal FK linking the account to a school record, not something a
  // student would write on a paper verification form.
  try { await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS student_id_number TEXT`) } catch {}
  try { await query(`ALTER TABLE supervisor_verifications ADD COLUMN IF NOT EXISTS log_id TEXT REFERENCES logs(id) ON DELETE SET NULL`) } catch {}
  // Captured on the supervisor's own device when they approve, not by the
  // student beforehand — kept alongside the token so it's available even
  // when the log was never synced (client-only student).
  try { await query(`ALTER TABLE supervisor_verifications ADD COLUMN IF NOT EXISTS supervisor_signature TEXT`) } catch {}

  // 'superseded' = the task organizer resolved this log through the school
  // dashboard while the emailed supervisor link was still pending. The
  // supervisor never answered, so recording their outcome as approved or
  // rejected would be a lie; this marks the link spent so a late click can't
  // silently flip the organizer's decision. See the verify routes in
  // server/routes/school.js and server.js.
  try { await query(`ALTER TABLE supervisor_verifications DROP CONSTRAINT IF EXISTS supervisor_verifications_status_check`) } catch {}
  try { await query(`ALTER TABLE supervisor_verifications ADD CONSTRAINT supervisor_verifications_status_check CHECK (status IN ('pending','approved','rejected','superseded'))`) } catch {}

  // Organizations — an entity above schools (e.g. a district or nonprofit
  // running multiple schools/chapters) that can add schools under itself
  // without going through the platform admin. See server/routes/organization.js.
  try { await query(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL`) } catch {}
  try { await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL`) } catch {}
  try { await query(`ALTER TABLE school_invites ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL`) } catch {}

  // Custom per-organization price and payment due date — same shape as the
  // per-school columns above, set independently by admins.
  try { await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS price_amount TEXT`) } catch {}
  try { await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS price_period TEXT`) } catch {}
  try { await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS payment_due_date DATE`) } catch {}
  try { await query(`ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_price_period_check`) } catch {}
  try { await query(`ALTER TABLE organizations ADD CONSTRAINT organizations_price_period_check CHECK (price_period IS NULL OR price_period IN ('monthly','yearly','one_time'))`) } catch {}

  // Internal admin note + manual payment tracking for organizations —
  // same shape as the per-school columns above. Organizations have no
  // self-service payment-confirmation flow (only schools submit a
  // confirmation ref), so there's no 'pending'/'rejected' status here —
  // just a manual paid/unpaid toggle for the admin's own bookkeeping.
  try { await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS admin_notes TEXT`) } catch {}
  try { await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid'`) } catch {}
  try { await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS payment_notes TEXT`) } catch {}
  try { await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`) } catch {}
  try { await query(`ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_payment_status_check`) } catch {}
  try { await query(`ALTER TABLE organizations ADD CONSTRAINT organizations_payment_status_check CHECK (payment_status IN ('paid','unpaid'))`) } catch {}
  // Lets notify-organization broadcast a single org (mirrors admin_notifications.school_id).
  try { await query(`ALTER TABLE admin_notifications ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE`) } catch {}

  // Reconcile the role CHECK constraint to the full current role set. This is
  // the single source of truth for widening it — earlier incremental versions
  // ('parent', then 'school_staff') were removed because, once 'org' accounts
  // existed, each older step re-added a narrower list that ADD CONSTRAINT then
  // rejected against those rows, failing every boot with nothing gained. The
  // constraint name is looked up dynamically rather than assumed, then dropped
  // and recreated inside a DO block (atomic — a failed ADD rolls the DROP back
  // too), so this is idempotent across boots.
  try {
    await query(`
      DO $$
      DECLARE cname text;
      BEGIN
        SELECT conname INTO cname FROM pg_constraint
          WHERE conrelid = 'users'::regclass AND contype = 'c'
            AND pg_get_constraintdef(oid) ILIKE '%role%IN%';
        IF cname IS NOT NULL THEN EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', cname); END IF;
        ALTER TABLE users ADD CONSTRAINT users_role_check
          CHECK (role IN ('admin','school','school_staff','student','volunteer','parent','org'));
      END $$;
    `)
  } catch (error) { console.error('role constraint migration failed:', error) }

  // Attendance for public-task signups — a volunteer marks present/absent/excused
  // for students approved on a task they posted. See POST /school/public-tasks/:taskId/attendance/:userId.
  try { await query(`ALTER TABLE public_task_signups ADD COLUMN IF NOT EXISTS attendance_status TEXT CHECK (attendance_status IN ('present','absent','excused'))`) } catch {}
  try { await query(`ALTER TABLE public_task_signups ADD COLUMN IF NOT EXISTS attendance_marked_at TIMESTAMPTZ`) } catch {}

  // Reviews now require admin approval before appearing as public
  // testimonials, and record the submitter's role so the site can display
  // "VolunTrack Student" etc. instead of a real name unless they opt in.
  try { await query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS role TEXT`) } catch {}
  try { await query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT false`) } catch {}

  // Reviewer consent gate (PIN-verified) + admin publish scheduling — a
  // review only becomes approvable once the submitter confirms they want it
  // featured, and once approved it shows only within an admin-chosen
  // [publish_at, expires_at) window rather than indefinitely. See
  // server/routes/reviews.js (/mine/:id/consent, /mine/:id/confirm) and the
  // PATCH /admin/:id/approve schedule params.
  try { await query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS user_id TEXT`) } catch {}
  try { await query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS pending_consent_choice TEXT CHECK (pending_consent_choice IN ('yes','no'))`) } catch {}
  try { await query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS consent_choice TEXT CHECK (consent_choice IN ('yes','no'))`) } catch {}
  try { await query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS consent_pin_hash TEXT`) } catch {}
  try { await query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS consent_pin_expires_at TIMESTAMPTZ`) } catch {}
  try { await query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS consent_pin_attempts INTEGER NOT NULL DEFAULT 0`) } catch {}
  try { await query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS publish_at TIMESTAMPTZ`) } catch {}
  try { await query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`) } catch {}

  // Admin-issued invoices for schools/organizations, plus a unified
  // payment_events timeline (invoice lifecycle + the existing manual
  // paid/unpaid/rejected status changes) so the admin dashboard can show one
  // history per entity. See server/routes/invoices.js.
  try { await query(`CREATE SEQUENCE IF NOT EXISTS invoice_number_seq`) } catch {}
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id              TEXT PRIMARY KEY,
        invoice_number  TEXT NOT NULL UNIQUE,
        entity_type     TEXT NOT NULL CHECK (entity_type IN ('school','organization')),
        entity_id       TEXT NOT NULL,
        amount          NUMERIC(10,2) NOT NULL,
        billing_period  TEXT CHECK (billing_period IN ('monthly','yearly','one_time')),
        description     TEXT,
        due_date        DATE,
        status          TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','paid','void')),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        paid_at         TIMESTAMPTZ
      )
    `)
  } catch {}
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS payment_events (
        id          TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL CHECK (entity_type IN ('school','organization')),
        entity_id   TEXT NOT NULL,
        event_type  TEXT NOT NULL CHECK (event_type IN (
          'invoice_sent','invoice_paid','invoice_void',
          'status_paid','status_unpaid','status_rejected'
        )),
        amount      NUMERIC(10,2),
        notes       TEXT,
        invoice_id  TEXT REFERENCES invoices(id) ON DELETE SET NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
  } catch {}
  try { await query(`CREATE INDEX IF NOT EXISTS idx_payment_events_entity ON payment_events(entity_type, entity_id, created_at DESC)`) } catch {}
  try { await query(`CREATE INDEX IF NOT EXISTS idx_invoices_entity ON invoices(entity_type, entity_id, created_at DESC)`) } catch {}

  // Small admin-editable key/value store for site-wide content, e.g. the
  // "office hours" block shown on the public Contact page. See
  // server/routes/settings.js.
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS site_settings (
        key         TEXT PRIMARY KEY,
        value       TEXT NOT NULL,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
  } catch {}

  // Real, shared incident history for the public /status page and the
  // Admin Incidents tab — replaces a previous per-browser localStorage
  // implementation. See server/routes/status.js.
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS incidents (
        id           TEXT PRIMARY KEY,
        service      TEXT NOT NULL,
        detail       TEXT,
        status       TEXT NOT NULL DEFAULT 'detected',
        source       TEXT NOT NULL DEFAULT 'auto',
        detected_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        resolved_at  TIMESTAMPTZ
      )
    `)
  } catch {}
  try { await query(`CREATE INDEX IF NOT EXISTS idx_incidents_detected ON incidents(detected_at DESC)`) } catch {}
  try { await query(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS issue_url TEXT`) } catch {}

  // Visitors who opt in on /status to get emailed when an incident is
  // logged. Double opt-in (confirmed starts false) so this can't be used to
  // spam-subscribe someone else's address; the same token both confirms and
  // later unsubscribes. See server/routes/status.js.
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS status_subscribers (
        id           TEXT PRIMARY KEY,
        email        TEXT NOT NULL UNIQUE,
        token        TEXT NOT NULL UNIQUE,
        confirmed    BOOLEAN NOT NULL DEFAULT false,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
  } catch {}

  // Parent weekly progress digest — opt-out flag + unguessable unsubscribe
  // token (lazily filled the first time a digest is sent for that parent),
  // mirroring the status_subscribers opt-out pattern. See server/digest.js.
  try { await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS weekly_digest_opt_out BOOLEAN NOT NULL DEFAULT false`) } catch {}
  try { await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS digest_unsub_token TEXT UNIQUE`) } catch {}

  // One row per (parent, week) once that week's digest has been attempted —
  // makes the cron endpoint and the admin manual trigger idempotent and safe
  // to re-run. email_ok: NULL while a send is in flight, true on success,
  // false on a failed send that a later run should retry.
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS parent_digest_sends (
        parent_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        week_start DATE NOT NULL,
        sent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        email_ok   BOOLEAN,
        PRIMARY KEY (parent_id, week_start)
      )
    `)
  } catch {}

  // ---------------------------------------------------------------------
  // School SSO (OIDC). A school configures a connection to its own IdP
  // (Google Workspace / Microsoft Entra / generic OIDC) and its students sign
  // in there instead of with a VolunTrack password. See server/routes/authSso.js.
  // ---------------------------------------------------------------------

  // SSO users have no password, so password_hash can no longer be NOT NULL.
  // Every read path already tolerates a null hash (verifyPassword returns
  // false for a falsy hash), so this only relaxes the write path.
  try { await query(`ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`) } catch {}

  try {
    await query(`
      CREATE TABLE IF NOT EXISTS sso_connections (
        id                     TEXT PRIMARY KEY,
        school_id              TEXT REFERENCES schools(id) ON DELETE CASCADE,
        organization_id        TEXT REFERENCES organizations(id) ON DELETE CASCADE,
        provider               TEXT NOT NULL DEFAULT 'oidc'
                                 CHECK (provider IN ('google','microsoft','oidc')),
        display_name           TEXT NOT NULL,
        oidc_issuer            TEXT NOT NULL,
        oidc_client_id         TEXT NOT NULL,
        oidc_client_secret_enc TEXT NOT NULL,
        default_role           TEXT NOT NULL DEFAULT 'student'
                                 CHECK (default_role IN ('student','school_staff')),
        jit_enabled            BOOLEAN NOT NULL DEFAULT true,
        enabled                BOOLEAN NOT NULL DEFAULT false,
        last_test_at           TIMESTAMPTZ,
        last_test_ok           BOOLEAN,
        last_test_error        TEXT,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
  } catch {}

  // Email domains a connection may provision accounts for. proof_method
  // records how ownership was established: Google's `hd` and Entra's `tid`
  // claims are issued by the IdP for domains/tenants it controls, so they are
  // proof on their own; generic OIDC has no equivalent and falls back to a
  // DNS TXT record. UNIQUE(domain) stops two tenants claiming the same one.
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS sso_email_domains (
        id            TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL REFERENCES sso_connections(id) ON DELETE CASCADE,
        domain        TEXT NOT NULL,
        proof_method  TEXT NOT NULL DEFAULT 'dns_txt'
                        CHECK (proof_method IN ('google_hd','entra_tid','dns_txt')),
        verify_token  TEXT,
        verified_at   TIMESTAMPTZ,
        UNIQUE (domain)
      )
    `)
  } catch {}

  // In-flight authorization requests, keyed by the OIDC `state`. This lives in
  // Postgres rather than process memory because the backend sleeps on Render's
  // free tier — a restart between /start and /callback would otherwise drop
  // every login in flight with an unexplained "invalid state" error.
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS sso_auth_states (
        state         TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL REFERENCES sso_connections(id) ON DELETE CASCADE,
        code_verifier TEXT NOT NULL,
        nonce         TEXT NOT NULL,
        return_to     TEXT,
        -- 'login' is a real sign-in; 'test' is a school admin verifying a
        -- connection before enabling it, which also auto-verifies their email
        -- domain from the resulting ID token.
        purpose       TEXT NOT NULL DEFAULT 'login' CHECK (purpose IN ('login','test')),
        initiated_by  TEXT REFERENCES users(id) ON DELETE CASCADE,
        expires_at    TIMESTAMPTZ NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
  } catch {}

  // Single-use, short-lived handoff from the IdP redirect back to the SPA, so
  // the app JWT never travels in a URL (where it would leak via history and
  // Referer). Mirrors the TOTP temp-token step in server/routes/auth.js.
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS sso_login_codes (
        code       TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at    TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
  } catch {}

  try { await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sso_connection_id TEXT REFERENCES sso_connections(id) ON DELETE SET NULL`) } catch {}
  try { await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sso_subject TEXT`) } catch {}
  try { await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'password'`) } catch {}
  try { await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_auth_provider_check`) } catch {}
  try { await query(`ALTER TABLE users ADD CONSTRAINT users_auth_provider_check CHECK (auth_provider IN ('password','sso'))`) } catch {}

  // One IdP subject maps to at most one account per connection.
  try { await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_sso ON users (sso_connection_id, sso_subject) WHERE sso_subject IS NOT NULL`) } catch {}
  try { await query(`CREATE INDEX IF NOT EXISTS idx_sso_domains_connection ON sso_email_domains(connection_id)`) } catch {}
  try { await query(`CREATE INDEX IF NOT EXISTS idx_sso_connections_school ON sso_connections(school_id)`) } catch {}

  // ---------------------------------------------------------------------
  // Per-tenant hostnames. A school reaches VolunTrack on its own hostname
  // and the SPA resolves which tenant that is from window.location.hostname
  // (GET /api/tenant/by-host). See server/routes/tenant.js.
  //
  // 'vanity'  = a subdomain of our own zone, e.g. lincoln.voluntrack.app
  // 'custom'  = customer-owned, e.g. volunteer.lincolnhs.edu, which needs
  //             on-demand TLS (Cloudflare for SaaS) — cf_hostname_id and
  //             tls_status mirror that provisioning and stay NULL until it
  //             is wired up. Tracked on #124.
  // ---------------------------------------------------------------------
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS tenant_domains (
        id              TEXT PRIMARY KEY,
        school_id       TEXT REFERENCES schools(id) ON DELETE CASCADE,
        organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
        hostname        TEXT UNIQUE NOT NULL,
        kind            TEXT NOT NULL DEFAULT 'custom' CHECK (kind IN ('vanity','custom')),
        -- Only 'active' rows are ever served. Everything else is a hostname
        -- someone has claimed but not yet proven or provisioned.
        status          TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','verifying','active','disabled')),
        verify_token    TEXT,
        cf_hostname_id  TEXT,
        tls_status      TEXT,
        verified_at     TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
  } catch {}

  try { await query(`CREATE INDEX IF NOT EXISTS idx_tenant_domains_school ON tenant_domains(school_id)`) } catch {}
  try { await query(`CREATE INDEX IF NOT EXISTS idx_tenant_domains_org ON tenant_domains(organization_id)`) } catch {}

  // Light white-label branding shown on a tenant's login page.
  try { await query(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS brand_logo_url TEXT`) } catch {}
  try { await query(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS brand_color TEXT`) } catch {}
  try { await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS brand_logo_url TEXT`) } catch {}
  try { await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS brand_color TEXT`) } catch {}

  return true
}
