-- =============================================================================
-- Migration 033: Portfolio Mode (White-Label)
-- Multi-org portfolios, cross-portfolio benchmarking, investor dashboards.
-- =============================================================================

CREATE TABLE IF NOT EXISTS portfolios (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  organization_type TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  branding TEXT,
  custom_domain TEXT,
  api_key TEXT UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS portfolio_memberships (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL REFERENCES portfolios(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  founder_id TEXT NOT NULL,
  fund_vintage TEXT,
  investment_date TEXT,
  investment_amount REAL,
  board_seat INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  added_at TEXT DEFAULT (datetime('now')),
  UNIQUE(portfolio_id, product_id)
);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  total_companies INTEGER,
  avg_mrr REAL,
  median_mrr REAL,
  companies_green INTEGER,
  companies_yellow INTEGER,
  companies_red INTEGER,
  avg_growth_rate REAL,
  total_portfolio_mrr REAL,
  highlights TEXT,
  concerns TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS portfolio_alerts (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  acknowledged INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_portfolios_api ON portfolios(api_key);
CREATE INDEX IF NOT EXISTS idx_portfolio_members ON portfolio_memberships(portfolio_id, status);
CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots ON portfolio_snapshots(portfolio_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_portfolio_alerts ON portfolio_alerts(portfolio_id, acknowledged);
