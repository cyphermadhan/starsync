CREATE TABLE IF NOT EXISTS subscribers (
  id TEXT PRIMARY KEY,
  email_encrypted TEXT NOT NULL,
  email_hash TEXT NOT NULL UNIQUE,
  name_encrypted TEXT NOT NULL,
  dob_encrypted TEXT NOT NULL,
  tob_encrypted TEXT NOT NULL,
  pob_encrypted TEXT NOT NULL,
  role_encrypted TEXT NOT NULL,
  rasi TEXT,
  nakshatra TEXT,
  pada INTEGER,
  preferred_send_minute_utc INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'trial' CHECK (status IN ('trial', 'active', 'paused', 'cancelled')),
  trial_ends_at TEXT NOT NULL,
  razorpay_customer_id TEXT,
  razorpay_subscription_id TEXT,
  razorpay_subscription_url TEXT,
  unsubscribe_token TEXT NOT NULL UNIQUE,
  last_sent_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_subscribers_send_minute ON subscribers (preferred_send_minute_utc, status);

-- No REFERENCES subscribers(id) here, deliberately — this is the retained
-- billing/audit trail for tax/accounting purposes, meant to outlive the
-- subscriber row once it's deleted (PII itself is deleted immediately on
-- cancellation; this isn't PII, see /privacy). A hard FK would make that
-- impossible to enforce.
CREATE TABLE IF NOT EXISTS billing_events (
  id TEXT PRIMARY KEY,
  subscriber_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_billing_events_subscriber ON billing_events (subscriber_id);

CREATE TABLE IF NOT EXISTS delivery_log (
  id TEXT PRIMARY KEY,
  subscriber_id TEXT NOT NULL REFERENCES subscribers (id),
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_delivery_log_subscriber ON delivery_log (subscriber_id);

-- Instant free preview reading (idea-v2 branch) — a shared, permanent cache
-- keyed by chart combo (not per-user, not per-day), plus an IP-based daily
-- try counter. No PII — nothing here references a real subscriber or birth
-- details.
CREATE TABLE IF NOT EXISTS preview_readings (
  id TEXT PRIMARY KEY,
  rasi TEXT NOT NULL,
  nakshatra TEXT NOT NULL,
  pada INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (rasi, nakshatra, pada)
);

CREATE TABLE IF NOT EXISTS preview_quota (
  ip_hash TEXT NOT NULL,
  quota_date TEXT NOT NULL,
  tries_used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, quota_date)
);
