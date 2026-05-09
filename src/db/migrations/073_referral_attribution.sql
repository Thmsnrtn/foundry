-- =============================================================================
-- FOUNDRY — Referral Attribution on Founders (Wave 3 wiring)
-- founders.referred_by_code captures the inviter's referral code at
-- signup so we can fire the 'paid' conversion event when subscription
-- activates (Stripe webhook arrives without the original cookie).
-- =============================================================================

ALTER TABLE founders ADD COLUMN referred_by_code TEXT;

CREATE INDEX IF NOT EXISTS idx_founders_referred_by
  ON founders(referred_by_code) WHERE referred_by_code IS NOT NULL;
