-- =============================================================================
-- Migration 182: the quiet rung leaves a record
--
-- `ux/interruption.ts` decides how loudly to tell a founder something. Its two
-- quietest rungs — `letter` and `log` — wrote NOTHING, excused by a comment
-- saying "the Letter composes from the ledgers, so the event will appear
-- there".
--
-- The Letter composes from a specific list: completed executions, gate-0
-- decisions decided in the last day, the top pending decision, falsified
-- premises, the memory digest, peer-radar warnings, the trust ledger and
-- dissent. An event whose fact is in that list survives being quieted. An
-- event outside it — a Signal drop, a wellbeing pulse, drafts awaiting
-- approval, a milestone, a billing failure — was DROPPED, silently, by a
-- founder setting a lower ceiling than they realised they were setting.
--
-- So six notification paths could not be routed through the policy at all:
-- obeying the founder's ceiling would have cost them the fact. This table is
-- what makes the quiet rungs safe — an event quieted to the letter is written
-- here, and the Letter reads it back the next time it is composed.
--
-- ONE DAY'S WINDOW, NO STATE MACHINE. The Letter already composes its other
-- sources from the last 24 hours; a quieted event is read the same way. A row
-- is a fact about a moment, not a task with a lifecycle, and giving it a
-- delivered/undelivered flag would invent a second place for "did the founder
-- see this" to be wrong.
-- =============================================================================

CREATE TABLE IF NOT EXISTS quieted_events (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  founder_id TEXT NOT NULL REFERENCES founders(id),
  -- The rung the policy chose. 'log' is recorded too: an audit trail the
  -- founder can be shown if they ask why they were not told.
  channel TEXT NOT NULL CHECK (channel IN ('letter', 'log')),
  importance TEXT NOT NULL CHECK (importance IN ('info', 'attention', 'action_needed', 'critical')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  action_url TEXT,
  action_label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_quieted_events_product_day
  ON quieted_events(product_id, created_at);
