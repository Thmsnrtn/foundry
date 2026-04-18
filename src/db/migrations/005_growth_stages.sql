-- =============================================================================
-- Migration 005: Growth Stage Detection
-- Auto-classifies products by lifecycle stage.
-- =============================================================================

ALTER TABLE products ADD COLUMN growth_stage TEXT DEFAULT 'pre_launch';

ALTER TABLE products ADD COLUMN growth_stage_updated_at TEXT;

ALTER TABLE products ADD COLUMN growth_stage_overridden INTEGER DEFAULT 0;
