-- Removes the REFERENCES subscribers(id) foreign key on billing_events.
-- billing_events is the retained billing/audit trail (tax/accounting), and
-- is meant to survive after a subscriber's PII row is deleted on
-- cancellation/expiry — a hard FK made that structurally impossible (every
-- delete of a subscriber with any billing_events row threw a FOREIGN KEY
-- constraint error). SQLite can't drop a FK via ALTER TABLE, so this
-- rebuilds the table.
CREATE TABLE billing_events_new (
  id TEXT PRIMARY KEY,
  subscriber_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO billing_events_new SELECT id, subscriber_id, event_type, created_at FROM billing_events;

DROP TABLE billing_events;

ALTER TABLE billing_events_new RENAME TO billing_events;

CREATE INDEX IF NOT EXISTS idx_billing_events_subscriber ON billing_events (subscriber_id);
