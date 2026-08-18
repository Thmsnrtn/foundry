-- =============================================================================
-- Migration 149: a push that was never dispatched has no status to be written
--
-- An earlier fix in this campaign separated "we dispatched it" from "the sender
-- returned quietly because its credentials are unset", and wrote the second as
--
--   status = 'not_configured'
--
-- `push_log.status` permits sent, delivered, failed, clicked. Not that. So on
-- a real database the INSERT raised, the surrounding catch counted the
-- notification as FAILED, and no log row was written at all — the fix was
-- inert in production and correct only against the test's own table, which had
-- no CHECK on it.
--
-- 'failed' would be the wrong home for it. A failure is an attempt that did
-- not succeed; this is an attempt that was never made, and the difference is
-- the whole reason the value exists. Nothing was wrong with the subscription,
-- the founder, or the network — the platform credentials are simply not set,
-- which is a fact about the deployment.
--
-- `push_log` has two indexes, no triggers, and two foreign keys, so the
-- rebuild is the ordinary one.
-- =============================================================================

PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS push_log_new (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL REFERENCES founders(id),
  product_id TEXT REFERENCES products(id),
  subscription_id TEXT REFERENCES push_subscriptions(id),
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data TEXT,
  status TEXT CHECK(status IN (
    'sent', 'delivered', 'failed', 'clicked',
    -- Never attempted: the platform's credentials are not configured. Not a
    -- failure, and not a delivery.
    'not_configured'
  )),
  error TEXT,
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  delivered_at DATETIME,
  clicked_at DATETIME
);

INSERT INTO push_log_new (
  id, founder_id, product_id, subscription_id, notification_type, title, body,
  data, status, error, sent_at, delivered_at, clicked_at
)
  SELECT
    id, founder_id, product_id, subscription_id, notification_type, title, body,
    data, status, error, sent_at, delivered_at, clicked_at
  FROM push_log;

DROP TABLE push_log;
ALTER TABLE push_log_new RENAME TO push_log;

CREATE INDEX IF NOT EXISTS idx_push_log_founder ON push_log(founder_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_push_log_type ON push_log(notification_type, sent_at DESC);

PRAGMA foreign_keys=ON;
