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
  role          TEXT NOT NULL CHECK (role IN ('admin','school','school_staff','student','volunteer','parent')),
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
  id          TEXT PRIMARY KEY,
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  name        TEXT,
  email       TEXT,
  role        TEXT,
  approved    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
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
  try { await query(`ALTER TABLE admin_notifications ADD COLUMN IF NOT EXISTS school_id TEXT REFERENCES schools(id) ON DELETE CASCADE`) } catch {}
  // 2FA columns
  try { await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT`) } catch {}
  try { await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false`) } catch {}
  try { await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS backup_codes TEXT`) } catch {}
  try { await query(`ALTER TABLE supervisor_verifications ADD COLUMN IF NOT EXISTS student_email TEXT`) } catch {}

  // Parent portal
  try { await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS child_link_code TEXT UNIQUE`) } catch {}
  try { await query(`ALTER TABLE logs ADD COLUMN IF NOT EXISTS supervisor_name TEXT`) } catch {}
  try { await query(`ALTER TABLE logs ADD COLUMN IF NOT EXISTS supervisor_email TEXT`) } catch {}
  try {
    await query(`ALTER TABLE logs ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'none' CHECK (verification_status IN ('none','pending','approved','rejected'))`)
  } catch {}
  try { await query(`ALTER TABLE logs ADD COLUMN IF NOT EXISTS verification_token TEXT UNIQUE`) } catch {}
  try { await query(`ALTER TABLE supervisor_verifications ADD COLUMN IF NOT EXISTS log_id TEXT REFERENCES logs(id) ON DELETE SET NULL`) } catch {}

  // Widen the role CHECK constraint to allow 'parent'. This is the first
  // migration that modifies an existing constraint rather than adding a
  // column, so the constraint name is looked up dynamically instead of
  // assumed, then dropped and recreated — idempotent across boots.
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
          CHECK (role IN ('admin','school','student','volunteer','parent'));
      END $$;
    `)
  } catch (error) { console.error('role constraint migration failed:', error) }

  // Widen again to allow 'school_staff' — school co-admins (up to 10 per
  // school, see POST /school/staff) who share day-to-day dashboard access
  // but not billing/account-deletion actions.
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
          CHECK (role IN ('admin','school','school_staff','student','volunteer','parent'));
      END $$;
    `)
  } catch (error) { console.error('role constraint migration failed:', error) }

  // Organizations — an entity above schools (e.g. a district or nonprofit
  // running multiple schools/chapters) that can add schools under itself
  // without going through the platform admin. See server/routes/organization.js.
  try { await query(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL`) } catch {}
  try { await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL`) } catch {}
  try { await query(`ALTER TABLE school_invites ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL`) } catch {}

  // Widen again to allow 'org' — an organization's own admin account.
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

  return true
}
