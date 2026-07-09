-- =============================================================================
-- Migration 082: Fix notifications.type CHECK constraint (walkthrough finding)
--
-- notifications.type was created (003_ux_intelligence) with a CHECK that allows
-- only ('milestone','risk_state_change','stressor_critical','decision_overdue',
-- 'pr_opened','pr_merged','audit_complete','competitive_signal','dna_nudge',
-- 'system'). But the codebase writes THREE types that aren't in that list:
--   • 'signal_alert'          — signal_alert_check job (every 2h)
--   • 'decision_followup'     — decision follow-up job
--   • 'decision_retrospective'— decision retrospective job
-- On any real database, every one of those createNotification() calls FAILS the
-- CHECK, so the founder never receives the alert and the job errors out. This is
-- the same schema-vs-code drift found in founders.tier (080) and integrations
-- (081): CHECK enums can't be ALTERed in SQLite, so they silently rot.
--
-- Fix: rebuild notifications with the type CHECK removed (type is a small,
-- app-controlled vocabulary — validating it in the DB only produces silent
-- drift). All columns, the FK references, and the index are preserved.
-- =============================================================================

PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS notifications_new (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL REFERENCES founders(id),
  product_id TEXT REFERENCES products(id),
  type TEXT NOT NULL,                          -- CHECK removed (app-validated)
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  action_url TEXT,
  action_label TEXT,
  read_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO notifications_new (
  id, founder_id, product_id, type, title, body, action_url, action_label,
  read_at, created_at
)
  SELECT
    id, founder_id, product_id, type, title, body, action_url, action_label,
    read_at, created_at
  FROM notifications;

DROP TABLE notifications;
ALTER TABLE notifications_new RENAME TO notifications;

CREATE INDEX IF NOT EXISTS idx_notifications_founder ON notifications(founder_id, read_at);

PRAGMA foreign_keys=ON;
