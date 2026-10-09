-- =============================================================================
-- 393 — EVERY CHANNEL (F2, 9 October 2026; PENDING 42, 43, 44).
--
-- The owner decided on 9 October 2026 that Foundry sells each product on every
-- channel it can reach: Etsy, Gumroad, Lemon Squeezy and the Workshop's own
-- Stripe page. Three facts are added, and none of them grants anything:
--
--   * DEFAULTS THAT SAY "NOT YET", as 'policy' rows the institution seeds with
--     no founder: one per channel ("not granted": PENDING 43) and the pricing
--     floor ("not set": PENDING 44). Only the owner's own row, written through
--     supersedeOriginationPolicy and signed founder:<id> (the guard of
--     migration 277 refuses anything else), opens a channel or sets a floor.
--
--   * channel_sales: what each channel says it sold and returned, as the
--     channel said it, one row per sale or refund, immutable. A merchant of
--     record keeps the tax it collected; that is recorded apart and never
--     counted as revenue. A fee the channel did not state is NULL — "not
--     known" — never zero.
--
--   * channel_listings: a listing placed on a channel, with the version it
--     carries and the AI disclosure the adapter applied, so the canonical
--     product and its version are one fact whatever channel shows it.
--
--   * demand_signals: Foundry's own demand, recorded monthly from the day F2
--     opened (visits, sales, refunds per theme and channel), so seasonality is
--     read from its own history rather than assumed for ever.
-- =============================================================================

INSERT INTO origination_policy (id, founder_id, requirement, treatment, value, why, set_by) VALUES
  ('f2_channel_etsy', NULL, 'channel_grant:etsy', 'policy', 'not_granted',
   'listing on Etsy needs his shop and Etsy''s write scope, granted by him (PENDING 25, 43); Foundry''s Etsy sense reads and never lists',
   'owner_decision:2026-10-09:every_channel'),
  ('f2_channel_gumroad', NULL, 'channel_grant:gumroad', 'policy', 'not_granted',
   'selling on Gumroad needs his account and an API grant he makes (PENDING 43)',
   'owner_decision:2026-10-09:every_channel'),
  ('f2_channel_lemonsqueezy', NULL, 'channel_grant:lemonsqueezy', 'policy', 'not_granted',
   'selling on Lemon Squeezy needs his store and an API key he makes (PENDING 43)',
   'owner_decision:2026-10-09:every_channel'),
  ('f2_price_floor', NULL, 'price_floor', 'policy', 'not_set',
   'the lowest price a product may carry against its fees is a pricing decision, and pricing is his (PENDING 44); until he sets one, no channel listing is placed',
   'owner_decision:2026-10-09:every_channel');

CREATE TABLE channel_sales (
  id              TEXT PRIMARY KEY,
  founder_id      TEXT NOT NULL REFERENCES founders(id),
  experiment_id   TEXT NOT NULL,
  -- The version of the canonical product the channel sold, when it said.
  version         INTEGER,
  channel         TEXT NOT NULL CHECK (channel IN ('etsy','gumroad','lemonsqueezy')),
  kind            TEXT NOT NULL CHECK (kind IN ('sale','refund')),
  -- The channel's own id for the sale (or for the refund of it).
  provider_ref    TEXT NOT NULL,
  -- What the buyer paid for the product, before any tax, in minor units.
  gross_cents     INTEGER NOT NULL CHECK (gross_cents >= 0),
  -- What the channel kept, as it said. NULL: it did not say, so not known.
  fee_cents       INTEGER CHECK (fee_cents IS NULL OR fee_cents >= 0),
  -- Tax a merchant of record collected and pays itself. Never revenue.
  tax_cents       INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  currency        TEXT NOT NULL,
  occurred_at     TEXT NOT NULL,
  evidence_mode   TEXT NOT NULL CHECK (evidence_mode IN ('real','sandbox','reference')),
  read_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(channel, provider_ref, kind)
);
CREATE INDEX idx_channel_sales_stream ON channel_sales(founder_id, experiment_id, occurred_at);

CREATE TRIGGER channel_sales_immutable
BEFORE UPDATE ON channel_sales
BEGIN
  SELECT RAISE(ABORT,'channel_sales:immutable');
END;

CREATE TABLE channel_listings (
  id              TEXT PRIMARY KEY,
  founder_id      TEXT NOT NULL REFERENCES founders(id),
  experiment_id   TEXT NOT NULL,
  version         INTEGER NOT NULL CHECK (version >= 1),
  channel         TEXT NOT NULL CHECK (channel IN ('etsy','gumroad','lemonsqueezy')),
  external_ref    TEXT NOT NULL,
  price_cents     INTEGER NOT NULL CHECK (price_cents > 0),
  -- What the adapter applied for the channel's AI-disclosure rule, in words.
  ai_disclosure   TEXT NOT NULL CHECK (trim(ai_disclosure) <> ''),
  evidence_mode   TEXT NOT NULL CHECK (evidence_mode IN ('real','sandbox','reference')),
  listed_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(channel, external_ref, version)
);
CREATE INDEX idx_channel_listings_experiment ON channel_listings(founder_id, experiment_id, channel);

CREATE TABLE demand_signals (
  id              TEXT PRIMARY KEY,
  founder_id      TEXT NOT NULL REFERENCES founders(id),
  -- The calendar month the signal is about, YYYY-MM.
  month           TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  signal          TEXT NOT NULL CHECK (signal IN ('visits','sales','refunds','net_cents')),
  -- The product's theme, or '' for all of them.
  theme           TEXT NOT NULL DEFAULT '',
  -- The channel, or '' for all of them.
  channel         TEXT NOT NULL DEFAULT '',
  value           INTEGER NOT NULL,
  -- Where the number was read from, in words: a count over named rows.
  source          TEXT NOT NULL CHECK (trim(source) <> ''),
  evidence_mode   TEXT NOT NULL CHECK (evidence_mode IN ('real','sandbox','reference')),
  recorded_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(founder_id, month, signal, theme, channel, evidence_mode)
);

-- ─── Gumroad at the door, graded by the capabilities that already exist ──────
-- Migration 339 named and graded the three acts of putting a file on sale:
-- draft and upload are `prepare` (nothing public), activation is the existing
-- `list_on_marketplace` at `public`, drawing on the allowance. Gumroad's are
-- the same three acts, so they are bound to the same three capabilities and
-- judged by rows they did not get to choose. DECLARED: no request has been
-- answered by Gumroad; nothing arrives proven. Etsy's remain unbound (its
-- write scope is not granted, PENDING 25).
INSERT INTO capability_providers
  (id, capability_key, provider, how, tool, cost_note, maturity, sort_order)
VALUES
  ('cp_gumroad_file', 'upload_product_file', 'gumroad', 'api', 'gumroad_upload_product_file',
   'nothing', 'declared', 2),
  ('cp_gumroad_draft', 'draft_on_marketplace', 'gumroad', 'api', 'gumroad_create_draft_product',
   'nothing; a draft is not for sale', 'declared', 2),
  ('cp_gumroad_activate', 'list_on_marketplace', 'gumroad', 'api', 'gumroad_enable_product',
   'no listing fee; 10% + $0.50 of each direct sale (30% of a sale Gumroad''s Discover brings), per gumroad.com/pricing read 2026-10-09',
   'declared', 2);
