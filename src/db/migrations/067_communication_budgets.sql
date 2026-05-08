-- =============================================================================
-- FOUNDRY — V3.1 Layer C: Communication Budgets
-- Per-product per-customer-key weekly cap on outbound communications.
-- Lighthouse's recursion finding: prevent cumulative-across-agents pressure
-- on a single customer (e.g. churn email + survey + announcement + nudge,
-- each from a different agent, all in the same week).
-- =============================================================================

CREATE TABLE IF NOT EXISTS communication_budgets (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  customer_external_id TEXT NOT NULL,             -- stable id (email, stripe id, etc.)
  week_starting TEXT NOT NULL,                    -- 'YYYY-MM-DD' Monday
  sent_count INTEGER NOT NULL DEFAULT 0,
  cap INTEGER NOT NULL DEFAULT 3,                 -- per week
  last_sent_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_comm_budget_unique
  ON communication_budgets(product_id, customer_external_id, week_starting);
