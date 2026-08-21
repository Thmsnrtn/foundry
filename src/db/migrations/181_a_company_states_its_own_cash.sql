-- =============================================================================
-- Migration 181: a company states its own cash, or its runway is unknown
--
-- Foundry has never known any company's cash balance and had no way to be told.
-- It computed runway anyway, in TWO places, by two different inventions:
--
--   scp/forecasting/runway.ts   cash = monthly burn x 12
--                               burn = products.operating_budget_monthly_usd
--   financial/simulator.ts      cash = monthly revenue x 6
--                               burn = 30% of revenue, or $500
--
-- The first is the worse of the two, and not only because the identity makes
-- runway exactly twelve months before growth is applied. `operating_budget_
-- monthly_usd` is the company's AI SPEND CAP, defaulting to $50 a month
-- (migration 017) — so a founder who never changed it was shown a business
-- burning $50 a month against $600 of cash. Those five scenarios then went
-- through a thousand-iteration Monte Carlo, and the page renders a median, a
-- p10-p90 band and a probability of surviving eighteen months. The statistics
-- are real. Every input to them was invented.
--
-- A cash balance cannot be derived from anything Foundry holds. It is a fact
-- about a bank account, and the only honest source is the person who has one.
-- So it is STATED, dated, and attributed — never inferred, and never defaulted.
-- Absent, runway is unknown and the page says what to enter.
--
-- `as_of_date` exists because a cash balance is a fact about a MOMENT. A
-- six-month-old figure is not wrong, but presenting it as today's is, and the
-- reader is shown how old it is.
-- =============================================================================

CREATE TABLE IF NOT EXISTS company_financial_position (
  product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  cash_on_hand_cents INTEGER NOT NULL,
  monthly_burn_cents INTEGER NOT NULL,
  -- The date the founder says these were true, not the date they typed them.
  as_of_date TEXT NOT NULL,
  -- Who said so. A financial position with no author is a number of unknown
  -- origin, and this one drives what a founder is told about survival.
  stated_by TEXT REFERENCES founders(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- NEGATIVE CASH AND NEGATIVE BURN ARE NOT POSITIONS. Refused here rather than
-- clamped in code, because a clamp turns a typo into a plausible number.
CREATE TRIGGER IF NOT EXISTS cfp_amounts_are_not_negative_ins
BEFORE INSERT ON company_financial_position
WHEN NEW.cash_on_hand_cents < 0 OR NEW.monthly_burn_cents < 0
BEGIN
  SELECT RAISE(ABORT, 'financial_position:cash and burn are amounts, not deltas');
END;

CREATE TRIGGER IF NOT EXISTS cfp_amounts_are_not_negative_upd
BEFORE UPDATE ON company_financial_position
WHEN NEW.cash_on_hand_cents < 0 OR NEW.monthly_burn_cents < 0
BEGIN
  SELECT RAISE(ABORT, 'financial_position:cash and burn are amounts, not deltas');
END;

-- A POSITION CANNOT BE DATED IN THE FUTURE. "As of next March" is a forecast,
-- and this table is the one place in the runway path that holds facts.
CREATE TRIGGER IF NOT EXISTS cfp_as_of_is_not_in_the_future_ins
BEFORE INSERT ON company_financial_position
WHEN date(NEW.as_of_date) > date('now')
BEGIN
  SELECT RAISE(ABORT, 'financial_position:as_of_date is when this was true, not a projection');
END;

CREATE TRIGGER IF NOT EXISTS cfp_as_of_is_not_in_the_future_upd
BEFORE UPDATE ON company_financial_position
WHEN date(NEW.as_of_date) > date('now')
BEGIN
  SELECT RAISE(ABORT, 'financial_position:as_of_date is when this was true, not a projection');
END;
