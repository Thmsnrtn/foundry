-- Migration 036: Founder journal and focus settings
-- Gives founders a private space to record thoughts and mood that agents can
-- optionally read as context. Also controls pacing (max decisions/day, vacation
-- mode, preferred briefing format) and allows individual decisions to be snoozed.

-- founder_journal_entries: private notes written by the founder
-- mood is an optional 1-5 integer (1 = very low, 5 = very high)
-- tags is a JSON array of topic labels for later filtering
-- is_agent_visible = 1 means agents will pull recent entries as context
--   when forming briefings; set to 0 for strictly private notes
CREATE TABLE IF NOT EXISTS founder_journal_entries (
  id               TEXT PRIMARY KEY,
  product_id       TEXT NOT NULL,
  founder_id       TEXT NOT NULL,
  content          TEXT NOT NULL,
  mood             INTEGER CHECK (mood BETWEEN 1 AND 5),   -- optional
  tags             TEXT NOT NULL DEFAULT '[]',              -- JSON array
  is_agent_visible INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_journal_entries_product
  ON founder_journal_entries(product_id, is_agent_visible, created_at);

-- founder_focus_settings: one row per product; controls agent behaviour and pacing
-- focus_area narrows the scope of agent proactivity to a single domain
-- focus_ends_at is when the focus mode expires (NULL = indefinite)
-- vacation_mode_until suppresses all non-critical agent output until that datetime
-- max_decisions_per_day caps how many pending decisions the UI surfaces per day
-- briefing_format controls the verbosity level of daily briefings
-- preferred_timezone is used to schedule briefing delivery time
CREATE TABLE IF NOT EXISTS founder_focus_settings (
  id                    TEXT PRIMARY KEY,
  product_id            TEXT NOT NULL UNIQUE,   -- one settings row per product
  focus_area            TEXT,                   -- e.g. 'retention','acquisition','fundraising'
  focus_ends_at         TEXT,                   -- NULL = no expiry
  vacation_mode_until   TEXT,                   -- NULL = not in vacation mode
  max_decisions_per_day INTEGER NOT NULL DEFAULT 20,
  briefing_format       TEXT NOT NULL DEFAULT 'full'
                          CHECK (briefing_format IN ('full','summary','critical_only')),
  preferred_timezone    TEXT NOT NULL DEFAULT 'UTC',
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- decision_snooze_log: records when the founder defers a decision to a later time
-- decision_type distinguishes between outbound_actions and generic agent decisions
-- snoozed_until is the datetime after which the decision should resurface
-- snoozed_by is the founder_id who triggered the snooze
CREATE TABLE IF NOT EXISTS decision_snooze_log (
  id             TEXT PRIMARY KEY,
  product_id     TEXT NOT NULL,
  decision_id    TEXT NOT NULL,   -- outbound_actions.id or other decision reference
  decision_type  TEXT NOT NULL CHECK (decision_type IN ('outbound_action','agent_decision')),
  snoozed_until  TEXT NOT NULL,
  snoozed_by     TEXT NOT NULL,   -- founder_id
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_snooze_log_product
  ON decision_snooze_log(product_id, snoozed_until);
