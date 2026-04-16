-- Migration 028: OKR system with agent progress links
-- Tracks Objectives and Key Results per product per quarter.
-- Agents can own individual Key Results and post progress updates.

-- company_okrs: top-level objectives, typically set per quarter
-- progress_pct is a 0-100 roll-up derived from underlying key results
CREATE TABLE IF NOT EXISTS company_okrs (
  id               TEXT PRIMARY KEY,
  product_id       TEXT NOT NULL,
  period           TEXT NOT NULL,          -- e.g. '2024-Q1', '2024-H2'
  objective_text   TEXT NOT NULL,
  objective_owner  TEXT NOT NULL DEFAULT 'founder',
  status           TEXT NOT NULL DEFAULT 'on_track'
                     CHECK (status IN ('on_track','at_risk','off_track','completed','cancelled')),
  progress_pct     INTEGER NOT NULL DEFAULT 0,  -- 0-100
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_okrs_product ON company_okrs(product_id, period);

-- key_results: measurable outcomes that define success for an OKR
-- current_value is updated by agent sessions or the founder manually
-- owner_agent identifies which agent is responsible for tracking this KR
CREATE TABLE IF NOT EXISTS key_results (
  id              TEXT PRIMARY KEY,
  okr_id          TEXT NOT NULL REFERENCES company_okrs(id),
  description     TEXT NOT NULL,
  metric_name     TEXT,                    -- programmatic metric identifier
  start_value     REAL NOT NULL DEFAULT 0,
  target_value    REAL NOT NULL,
  current_value   REAL NOT NULL DEFAULT 0,
  unit            TEXT,                    -- e.g. '%', '$', 'count', 'days'
  owner_agent     TEXT,                    -- agent name, or NULL for founder-owned
  status          TEXT NOT NULL DEFAULT 'on_track'
                    CHECK (status IN ('on_track','at_risk','off_track','completed')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_key_results_okr ON key_results(okr_id);

-- okr_progress_updates: immutable history of each value change on a KR
-- source distinguishes agent-driven updates from founder manual entries
CREATE TABLE IF NOT EXISTS okr_progress_updates (
  id              TEXT PRIMARY KEY,
  key_result_id   TEXT NOT NULL REFERENCES key_results(id),
  previous_value  REAL,
  new_value       REAL NOT NULL,
  source          TEXT NOT NULL CHECK (source IN ('agent_session','founder_manual')),
  source_id       TEXT,   -- agent_sessions.id when source = 'agent_session'
  note            TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_okr_updates_kr ON okr_progress_updates(key_result_id);
