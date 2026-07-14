-- =============================================================================
-- Migration 096: Operator attention memory (Jarvis slice 1)
--
-- The seed of the founder-scoped memory spine. ADMISSION CONTROL is the
-- design: only EXPLICIT founder reactions are stored (opened / acted /
-- dismissed on a surfaced item) — never inferred signals, never noise.
-- Ranking reads it bounded (±5) so facts always dominate learned taste.
-- =============================================================================

CREATE TABLE IF NOT EXISTS operator_attention (
  id          TEXT PRIMARY KEY,
  founder_id  TEXT NOT NULL,
  product_id  TEXT NOT NULL,
  item_kind   TEXT NOT NULL,             -- 'needs_you' | future kinds
  item_ref    TEXT NOT NULL,             -- e.g. decision id
  reaction    TEXT NOT NULL CHECK(reaction IN ('opened', 'acted', 'dismissed')),
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_operator_attention
  ON operator_attention(founder_id, product_id, created_at);
