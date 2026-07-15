-- =============================================================================
-- Migration 098: Autonomy consent ledger (Protective Wrapper primitive 2)
--
-- The founder's shield (LIABILITY-AUDIT.md + AcreOS pax-jarvis.md): raising a
-- capability to 'act' — the tier that can take real action on the founder's
-- behalf — requires an explicit, RECORDED acknowledgment: who, which product,
-- which capability, from/to mode, the disclosure version they saw, and when.
-- No grant to 'act' without a row here. This is what makes "the user
-- authorized this" provable, not merely asserted.
-- =============================================================================

CREATE TABLE IF NOT EXISTS autonomy_consents (
  id                  TEXT PRIMARY KEY,
  founder_id          TEXT NOT NULL,
  product_id          TEXT NOT NULL,
  capability          TEXT NOT NULL,          -- autopilot category
  from_mode           TEXT NOT NULL,
  to_mode             TEXT NOT NULL,
  disclosure_version  TEXT NOT NULL,          -- which disclosure text they accepted
  accepted_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  revoked_at          DATETIME                -- set when the capability drops below 'act'
);

CREATE INDEX IF NOT EXISTS idx_autonomy_consents
  ON autonomy_consents(product_id, capability, revoked_at);
