-- =============================================================================
-- Migration 143 — shared rate-limit counters
--
-- Every rate limit in this codebase is a Map in one Node process. fly.toml runs
-- `min_machines_running = 2`, and a load balancer spreads a caller's requests
-- across them, so each limit is really TWICE what its docstring says — and
-- three times, or ten, if the web process group is ever scaled up. Nothing
-- about that is visible at the call site: the numbers read as absolute.
--
-- For flood control that overshoot is tolerable; the point there is to blunt a
-- burst, and being twice as generous still blunts it. It is NOT tolerable for
-- the limits that exist to stop money being spent — the AI limit, the audit
-- limit, and the per-key model limit on the public API — because those are the
-- front stop to a real bill, and "the ceiling is whatever we multiplied it by
-- this month" is not a ceiling.
--
-- One row per (key, window). The window start is computed by the caller so the
-- row identity is deterministic, and the counter is incremented with a single
-- upsert rather than a read followed by a write: two machines incrementing at
-- once must not each read 9 and each write 10.
-- =============================================================================

CREATE TABLE IF NOT EXISTS rate_limit_counters (
  key           TEXT    NOT NULL,
  window_start  INTEGER NOT NULL,          -- epoch ms, floored to the window
  window_ms     INTEGER NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (key, window_start)
);

-- Expiry sweeps read by window, never by key.
CREATE INDEX IF NOT EXISTS idx_rate_limit_counters_window
  ON rate_limit_counters(window_start);
