-- =============================================================================
-- 367 — WHAT FOUNDRY COSTS TO CARRY.
--
-- The executive review of 29 September 2026 found no single figure for what
-- running Foundry costs: model spend was measured, but hosting, Cloudflare,
-- domains, Clerk and the marketplace's fees were written down nowhere, so the
-- hold rule (value against the owner's time) had no denominator (F-1).
--
-- The bills Foundry cannot read are STATED by the owner, one line per
-- provider, each with where the number came from. A new statement is a new
-- row; the reading uses the newest. NULL is "I do not know yet", which is
-- different from zero and is never read as zero.
-- =============================================================================

CREATE TABLE foundry_cost_lines (
  id            TEXT PRIMARY KEY,
  founder_id    TEXT NOT NULL REFERENCES founders(id),
  provider      TEXT NOT NULL CHECK (provider IN ('fly','cloudflare','domains','clerk','etsy','github','other')),
  monthly_cents INTEGER CHECK (monthly_cents IS NULL OR (monthly_cents >= 0 AND monthly_cents <= 10000000)),
  source        TEXT NOT NULL CHECK (length(trim(source)) > 0),
  said_by       TEXT NOT NULL,
  said_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (said_by = 'founder:' || founder_id)
);
CREATE INDEX idx_foundry_cost_lines_newest ON foundry_cost_lines(founder_id, provider, said_at);

-- Said is said: a correction is a new line, never an edit of the old one.
CREATE TRIGGER foundry_cost_lines_said_is_said BEFORE UPDATE ON foundry_cost_lines
BEGIN SELECT RAISE(ABORT,'foundry_cost_lines:said_is_said'); END;
