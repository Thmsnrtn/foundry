-- =============================================================================
-- 362 — WHO CHECKS A VENUE'S BUYER MESSAGES, AND HOW OFTEN.
--
-- The owner's handoff of 28 September, step 1: where a venue does not expose
-- buyer messages to Foundry, the absence reading must say exactly who checks
-- them and when, and must not silently certify unattended care. Etsy lets no
-- app read a shop's messages. So the owner says, once, how often he checks
-- them and whether he does while away; the absence reading holds only when
-- that covers the absence (`findability.ts`, `absence-test.ts`).
--
-- His word, as his: only the owner of the company, only as himself, and about
-- the shop confirmed as his when he said it (`account_ref`, as migration 359).
-- Said is said: a new statement is a new row.
-- =============================================================================

CREATE TABLE venue_care_checks (
  id           TEXT PRIMARY KEY,
  founder_id   TEXT NOT NULL REFERENCES founders(id),
  product_id   TEXT NOT NULL REFERENCES products(id),
  provider     TEXT NOT NULL CHECK (provider = lower(provider) AND length(provider) > 0),
  account_ref  TEXT,
  every_days   INTEGER NOT NULL CHECK (typeof(every_days) = 'integer' AND every_days BETWEEN 1 AND 30),
  while_away   INTEGER NOT NULL CHECK (while_away IN (0, 1)),
  said_by      TEXT NOT NULL CHECK (said_by = 'founder:' || founder_id),
  said_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX venue_care_checks_by_shop ON venue_care_checks (product_id, provider, said_at);

CREATE TRIGGER venue_care_checks_said_is_said
BEFORE UPDATE ON venue_care_checks
BEGIN
  SELECT RAISE(ABORT, 'venue_care_checks:said_is_said');
END;
