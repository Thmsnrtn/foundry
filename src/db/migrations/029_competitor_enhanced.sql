-- Migration 029: Enhanced competitive intelligence
-- Extends competitor tracking with historical pricing snapshots and
-- feature-level tracking to detect when competitors ship functionality
-- that overlaps with or threatens the product's roadmap.

-- competitor_pricing_snapshots: point-in-time captures of a competitor's pricing page
-- pricing_json stores the full tier/feature matrix so diffs can be computed later
-- pricing_changed = 1 flags snapshots where the scrape differs from the prior one
CREATE TABLE IF NOT EXISTS competitor_pricing_snapshots (
  id               TEXT PRIMARY KEY,
  product_id       TEXT NOT NULL,
  competitor_name  TEXT NOT NULL,
  snapshot_date    TEXT NOT NULL,   -- ISO date string (YYYY-MM-DD)
  pricing_json     TEXT NOT NULL,   -- JSON: { tiers: [{ name, price, features[] }] }
  pricing_changed  INTEGER NOT NULL DEFAULT 0,  -- 1 if different from previous snapshot
  change_summary   TEXT,            -- human-readable diff description when pricing_changed = 1
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_comp_pricing_product
  ON competitor_pricing_snapshots(product_id, competitor_name, snapshot_date);

-- competitor_feature_tracking: records individual features observed in competitor products
-- our_equivalent tracks whether we have built, plan to build, or won't build a response
-- source indicates where the feature was spotted (changelog, product page, job posting, review)
CREATE TABLE IF NOT EXISTS competitor_feature_tracking (
  id               TEXT PRIMARY KEY,
  product_id       TEXT NOT NULL,
  competitor_name  TEXT NOT NULL,
  feature_name     TEXT NOT NULL,
  first_seen_at    TEXT NOT NULL,   -- ISO datetime when feature was first detected
  source           TEXT NOT NULL CHECK (source IN ('changelog','product_page','job_posting','review')),
  notes            TEXT,
  our_equivalent   TEXT NOT NULL DEFAULT 'unknown'
                     CHECK (our_equivalent IN ('shipped','planned','not_planned','unknown')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Enforce uniqueness: one record per (product, competitor, feature)
CREATE UNIQUE INDEX IF NOT EXISTS idx_comp_feature_unique
  ON competitor_feature_tracking(product_id, competitor_name, feature_name);

CREATE INDEX IF NOT EXISTS idx_comp_feature_product
  ON competitor_feature_tracking(product_id, competitor_name);
