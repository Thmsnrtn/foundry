-- =============================================================================
-- FOUNDRY — Daily Actions System
-- Tracks autonomous daily actions taken by Foundry for each product.
-- =============================================================================

CREATE TABLE IF NOT EXISTS daily_actions (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  founder_id TEXT NOT NULL REFERENCES founders(id),
  action_type TEXT NOT NULL,
  gate INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail TEXT,
  draft_content TEXT,
  requires_approval INTEGER DEFAULT 0,
  action_url TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed', 'pending_approval', 'approved', 'dismissed')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_daily_actions_product ON daily_actions(product_id, created_at);
CREATE INDEX IF NOT EXISTS idx_daily_actions_founder ON daily_actions(founder_id);
CREATE INDEX IF NOT EXISTS idx_daily_actions_status ON daily_actions(status);

-- Autopilot configuration per product
CREATE TABLE IF NOT EXISTS autopilot_config (
  product_id TEXT PRIMARY KEY REFERENCES products(id),
  preferences TEXT NOT NULL DEFAULT '{}',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
