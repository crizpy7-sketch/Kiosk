-- Wild Frame AI — initial schema.
--
-- Runs on plain PostgreSQL 14+ and on Supabase unchanged. Row Level Security is
-- enabled on every table with no permissive policy, so a leaked Supabase anon
-- key reaches nothing: all application access goes through the server using the
-- owner/service role connection. See docs/SECURITY.md.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- users -----
-- Staff and owners only. Customers never get an account (see the scope limits).
CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at  TIMESTAMPTZ
);

-- --------------------------------------------------------------- kiosks -----
CREATE TABLE kiosks (
  id                     TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  location_label         TEXT NOT NULL DEFAULT '',
  status                 TEXT NOT NULL DEFAULT 'offline'
                           CHECK (status IN ('online', 'offline', 'maintenance')),
  last_seen_at           TIMESTAMPTZ,
  current_app_version    TEXT,
  configured_language    TEXT NOT NULL DEFAULT 'en' CHECK (configured_language IN ('en', 'es')),
  daily_ai_limit_seconds INTEGER NOT NULL DEFAULT 3600 CHECK (daily_ai_limit_seconds > 0),
  battery_percent        INTEGER CHECK (battery_percent BETWEEN 0 AND 100),
  battery_charging       BOOLEAN,
  active                 BOOLEAN NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------- experiences -----
-- Prompts live in code (src/lib/config/experiences.ts). This table carries only
-- the operational switches an owner may flip at runtime.
CREATE TABLE experiences (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  featured    BOOLEAN NOT NULL DEFAULT FALSE,
  price_cents INTEGER NOT NULL CHECK (price_cents BETWEEN 100 AND 9999),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------- orders -----
CREATE TABLE orders (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Short human-quotable reference for staff ("order WF-7Q2M4X"). Random, not
  -- sequential: it must not leak how many transformations we have sold.
  public_reference           TEXT NOT NULL UNIQUE,
  kiosk_id                   TEXT NOT NULL REFERENCES kiosks(id),
  experience_id              TEXT NOT NULL REFERENCES experiences(id),
  status                     TEXT NOT NULL DEFAULT 'created',
  language                   TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'es')),
  price_cents                INTEGER NOT NULL,
  currency                   TEXT NOT NULL DEFAULT 'usd',
  demo                       BOOLEAN NOT NULL DEFAULT FALSE,
  stripe_checkout_session_id TEXT UNIQUE,
  stripe_payment_intent_id   TEXT,
  paid_at                    TIMESTAMPTZ,
  consented_at               TIMESTAMPTZ,
  generation_started_at      TIMESTAMPTZ,
  generation_completed_at    TIMESTAMPTZ,
  delivered_at               TIMESTAMPTZ,
  failed_at                  TIMESTAMPTZ,
  refunded_at                TIMESTAMPTZ,
  error_code                 TEXT,
  retake_used                BOOLEAN NOT NULL DEFAULT FALSE,
  staff_note                 TEXT,
  helped_at                  TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX orders_status_idx      ON orders (status);
CREATE INDEX orders_created_at_idx  ON orders (created_at DESC);
CREATE INDEX orders_kiosk_idx       ON orders (kiosk_id, created_at DESC);
CREATE INDEX orders_paid_at_idx     ON orders (paid_at DESC) WHERE paid_at IS NOT NULL;

-- -------------------------------------------------- generation_sessions -----
CREATE TABLE generation_sessions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                  UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider                  TEXT NOT NULL,
  model                     TEXT NOT NULL,
  provider_session_id       TEXT,
  started_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at                  TIMESTAMPTZ,
  billable_seconds_estimate NUMERIC(10, 2) NOT NULL DEFAULT 0,
  status                    TEXT NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'completed', 'failed', 'timeout', 'canceled')),
  normalized_error_code     TEXT,
  is_retake                 BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX generation_sessions_order_idx   ON generation_sessions (order_id);
CREATE INDEX generation_sessions_started_idx ON generation_sessions (started_at DESC);

-- --------------------------------------------------------------- assets -----
-- Only approved final results. Raw camera frames never reach this table.
CREATE TABLE assets (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type                 TEXT NOT NULL CHECK (type IN ('final_image')),
  private_storage_path TEXT NOT NULL,
  content_type         TEXT NOT NULL DEFAULT 'image/jpeg',
  byte_size            INTEGER NOT NULL DEFAULT 0,
  -- SHA-256 of a 32-byte random download token. The plaintext token exists only
  -- inside the QR code on the customer's phone; a database dump cannot
  -- reconstruct a working link.
  download_token_hash  TEXT NOT NULL UNIQUE,
  expires_at           TIMESTAMPTZ NOT NULL,
  deleted_at           TIMESTAMPTZ,
  downloaded_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX assets_order_idx   ON assets (order_id);
CREATE INDEX assets_expiry_idx  ON assets (expires_at) WHERE deleted_at IS NULL;

-- --------------------------------------------------------- audit_events -----
CREATE TABLE audit_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_label   TEXT NOT NULL DEFAULT 'system',
  kiosk_id      TEXT REFERENCES kiosks(id),
  order_id      UUID REFERENCES orders(id) ON DELETE SET NULL,
  event_type    TEXT NOT NULL,
  safe_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_created_idx ON audit_events (created_at DESC);
CREATE INDEX audit_events_order_idx   ON audit_events (order_id);
CREATE INDEX audit_events_type_idx    ON audit_events (event_type);

-- ------------------------------------------------------ webhook_events -----
-- Stripe delivers at-least-once. The unique key on the provider event id is what
-- makes fulfilment idempotent: a duplicate delivery loses the INSERT race and
-- is acknowledged without re-running fulfilment.
CREATE TABLE webhook_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     TEXT NOT NULL,
  event_id     TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  processed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);

-- --------------------------------------------------------------- limits -----
CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------ admin_sessions -----
CREATE TABLE admin_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX admin_sessions_expiry_idx ON admin_sessions (expires_at);

-- ------------------------------------------------------------------ RLS -----
-- Deny-by-default. No policies are created, so the Supabase `anon` and
-- `authenticated` roles reach nothing — a leaked publishable key is inert. The
-- application connects as the table owner / service role, which bypasses RLS by
-- design; the browser never holds a database credential of any kind.
--
-- Deliberately NOT using FORCE ROW LEVEL SECURITY: with zero policies defined,
-- FORCE would lock out the owner role too and take the application down with it.
ALTER TABLE users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE kiosks              ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiences         ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders              ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets              ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_sessions      ENABLE ROW LEVEL SECURITY;
