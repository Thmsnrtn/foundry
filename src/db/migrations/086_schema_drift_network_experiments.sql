-- =============================================================================
-- Migration 086: Reconcile the last schema-drift subsystems (batch 3).
--
--   • network_contributions / network_benchmarks — the benchmark subsystem
--     (services/network/benchmarks.ts) is the ONLY reader/writer of these two
--     tables, and it stores per-metric rows (metric/value/bracket) whereas the
--     original tables modelled something else and were never writable. Since the
--     subsystem is live and self-contained, rebuild both to the shape the code
--     uses. (No data to preserve — the mismatched INSERTs never succeeded.)
--   • experiments — the /api/v1/experiments endpoint records an optional
--     success_threshold; add the column (the endpoint also now creates the
--     required hypothesis row + A/B fields in code).
--   • decision_snooze_log — snoozeDecision() writes (…, reason) and omits the
--     previously-NOT-NULL decision_type/snoozed_by. Rebuild so the live signature
--     works: add reason, default decision_type, nullable snoozed_by, and the
--     UNIQUE(product_id, decision_id) its ON CONFLICT needs.
-- =============================================================================

ALTER TABLE experiments ADD COLUMN success_threshold REAL;

-- ── network_contributions → per-metric contribution rows ─────────────────────
DROP TABLE IF EXISTS network_contributions;
CREATE TABLE network_contributions (
  id               TEXT PRIMARY KEY,
  metric           TEXT NOT NULL,
  market_category  TEXT,
  lifecycle_stage  TEXT,
  mrr_bracket      TEXT,
  value            REAL,
  contributed_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_network_contrib_cell
  ON network_contributions(metric, lifecycle_stage, mrr_bracket);

-- ── network_benchmarks → computed percentile cells ───────────────────────────
DROP TABLE IF EXISTS network_benchmarks;
CREATE TABLE network_benchmarks (
  id               TEXT PRIMARY KEY,
  metric           TEXT NOT NULL,
  market_category  TEXT,
  lifecycle_stage  TEXT,
  mrr_bracket      TEXT,
  p25              REAL,
  p50              REAL,
  p75              REAL,
  sample_count     INTEGER,
  last_updated     DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(metric, market_category, lifecycle_stage, mrr_bracket)
);

-- ── decision_snooze_log → make the live signature valid ──────────────────────
PRAGMA foreign_keys=OFF;
CREATE TABLE decision_snooze_log_new (
  id             TEXT PRIMARY KEY,
  product_id     TEXT NOT NULL,
  decision_id    TEXT NOT NULL,
  decision_type  TEXT NOT NULL DEFAULT 'outbound_action',
  snoozed_until  TEXT NOT NULL,
  snoozed_by     TEXT,
  reason         TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(product_id, decision_id)
);
INSERT INTO decision_snooze_log_new (id, product_id, decision_id, decision_type, snoozed_until, snoozed_by, created_at)
  SELECT id, product_id, decision_id, decision_type, snoozed_until, snoozed_by, created_at FROM decision_snooze_log;
DROP TABLE decision_snooze_log;
ALTER TABLE decision_snooze_log_new RENAME TO decision_snooze_log;
CREATE INDEX IF NOT EXISTS idx_decision_snooze_until ON decision_snooze_log(product_id, snoozed_until);
PRAGMA foreign_keys=ON;
