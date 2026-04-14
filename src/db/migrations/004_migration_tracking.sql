-- =============================================================================
-- FOUNDRY — Migration Tracking
-- Records which migrations have been applied to prevent re-running.
-- =============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  checksum TEXT
);

-- Add ENCRYPTION_KEY notice column to products for tracking encrypted tokens
-- (no-op if the column structure is unchanged; the encryption is handled at app level)
