-- =============================================================================
-- FOUNDRY — V3.1 Layer C: Data Classifications
-- Per-product per-surface classification policy used by the tool gateway to
-- decide whether outbound traffic carrying a given data class is allowed.
-- Distinct from `data_residency_settings` (region/GDPR scope). Surfaces are
-- caller-named buckets like 'email_outbound', 'public_landing', 'cs_thread'.
-- =============================================================================

CREATE TABLE IF NOT EXISTS data_classifications (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  surface TEXT NOT NULL,                          -- 'email_outbound'|'public_landing'|...
  allowed_classes TEXT NOT NULL,                  -- JSON array: ['general','customer']
  forbidden_classes TEXT,                         -- JSON array: ['pii_strict','financial_secret']
  notes TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_data_class_product_surface
  ON data_classifications(product_id, surface);
