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
  unsubscribe_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_subscribers_send_minute ON subscribers (preferred_send_minute_utc, status);

CREATE TABLE IF NOT EXISTS billing_events (
  id TEXT PRIMARY KEY,
  subscriber_id TEXT NOT NULL REFERENCES subscribers (id),
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
