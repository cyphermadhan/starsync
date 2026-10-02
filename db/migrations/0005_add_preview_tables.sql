-- Instant free preview reading (idea-v2): a shared, permanent cache of
-- generated content keyed by chart combo (not per-user, not per-day), plus
-- an IP-based daily try counter. No PII — nothing here references a real
-- subscriber or their birth details, by design.

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
