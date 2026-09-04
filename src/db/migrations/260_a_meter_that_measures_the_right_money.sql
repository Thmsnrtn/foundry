-- A METER THAT MEASURES THE RIGHT MONEY, AND A HAND THAT IS NOT A PUBLIC ACT.
--
-- Two holes that are harmless today only because nothing can yet spend or
-- click, and that open the moment one real provider is connected.
--
-- ONE. `allowanceFor()` counts spend from `ai_daily_spend` — Anthropic token
-- cost. `consequenceAllows` then authorises the whole financial rung — register
-- a domain, buy a service, run a paid experiment — while `remainingCents > 0`.
-- So an allowance depletes when the institution THINKS and never when it SPENDS.
-- Its own docstring reasons correctly that two counters for one quantity is the
-- shape this codebase keeps finding broken; the error is subtler than that. It
-- is one counter for two quantities, and the quantity it counts is the cheapest
-- thing the institution does.
--
-- The fix is the one its docstring already argues for: one meter, two sources.
-- Token spend stays a source rather than becoming a peer.

CREATE TABLE asset_money_spent (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL REFERENCES products(id),
  capability    TEXT,
  tool          TEXT NOT NULL,
  -- What act this was, so a line in the meter can be walked back to a decision.
  act_ref       TEXT,
  amount_cents  INTEGER NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'usd',
  -- reserved: committed before the wire. settled: the provider's own receipt.
  -- reversed: it did not happen, or came back.
  source        TEXT NOT NULL CHECK (source IN ('reserved','settled','reversed')),
  provider_ref  TEXT,
  recorded_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_asset_money_spent_product ON asset_money_spent(product_id, recorded_at);

-- REAL MONEY IS NEVER NEGATIVE, AND A REVERSAL IS A ROW RATHER THAN AN EDIT.
CREATE TRIGGER asset_money_is_not_negative
BEFORE INSERT ON asset_money_spent
WHEN NEW.amount_cents < 0
BEGIN SELECT RAISE(ABORT,'asset_money:negative'); END;

-- A LEDGER THAT CAN BE REWRITTEN IS NOT A LEDGER.
CREATE TRIGGER asset_money_is_append_only
BEFORE UPDATE ON asset_money_spent
BEGIN SELECT RAISE(ABORT,'asset_money:append_only'); END;

CREATE TRIGGER asset_money_is_not_deleted
BEFORE DELETE ON asset_money_spent
BEGIN SELECT RAISE(ABORT,'asset_money:append_only'); END;

-- TWO. `act_in_a_browser` sits at the `public` rung and is therefore
-- auto-allowed, and pressing a button on a site is how one accepts terms,
-- creates an account in the institution's name, or authorises a payment. The
-- constitution says a materially irreversible act may never be silently
-- absorbed into ordinary autonomous authority; a browser at `public` absorbs
-- all of them, because the rung was attached to the CAPABILITY and consequence
-- belongs to the ACT.
--
-- So the act must name itself, and the higher of the two rungs governs.

CREATE TABLE browser_act_kinds (
  kind        TEXT PRIMARY KEY,
  what_it_is  TEXT NOT NULL,
  rung        TEXT NOT NULL REFERENCES consequence_rungs(rung),
  sort_order  INTEGER NOT NULL
);

INSERT INTO browser_act_kinds (kind, what_it_is, rung, sort_order) VALUES
  ('read_only', 'looking at a page and reading what is on it', 'observe', 1),
  ('submit_form', 'entering something in a form and sending it', 'public', 2),
  ('create_account', 'bringing an account into existence in somebody''s name',
   'legal', 3),
  ('accept_terms', 'agreeing to somebody else''s terms on the institution''s behalf',
   'legal', 4),
  ('authorise_payment', 'causing money to move', 'financial', 5);

-- Constitutional: what a kind of act MEANS is not a runtime setting.
CREATE TRIGGER browser_act_kinds_constitutional_insert
BEFORE INSERT ON browser_act_kinds
BEGIN SELECT RAISE(ABORT,'browser_act_kind:constitutional'); END;
CREATE TRIGGER browser_act_kinds_constitutional_update
BEFORE UPDATE ON browser_act_kinds
BEGIN SELECT RAISE(ABORT,'browser_act_kind:constitutional'); END;
CREATE TRIGGER browser_act_kinds_constitutional_delete
BEFORE DELETE ON browser_act_kinds
BEGIN SELECT RAISE(ABORT,'browser_act_kind:constitutional'); END;
