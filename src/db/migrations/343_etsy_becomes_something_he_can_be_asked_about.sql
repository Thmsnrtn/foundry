-- =============================================================================
-- ETSY BECOMES SOMETHING HE CAN BE ASKED ABOUT.
--
-- Migration 338 declared the three read scopes an Etsy connection would be
-- allowed to ask for. It did not make the connection ASKABLE, and a
-- reconstruction found the gap: `whatItCannotSee` builds the owner's offer list
-- by joining `senses` to `sense_providers`, and there has never been an Etsy
-- row in `sense_providers`. So the scopes stood declared and bounded, and no
-- surface in the institution could offer them. The button did not exist.
--
-- That is the whole of this migration: one row, so the offer page can render a
-- question the owner is able to answer. It grants nothing. A row in this table
-- is an offer to ask, and asking is still his to accept.
--
-- `hands_over` IS LITERALLY TRUE HERE, which is worth saying because it is the
-- load-bearing column and because the Stripe and GitHub rows beside it cannot
-- say the same. Theirs read "a key with write scope could move money" and "a
-- token with write scope could push", because those providers issue one
-- credential whose power depends on what was asked for. Etsy's write scope is
-- `listings_w`; it appears nowhere in the adapter, the scope table is closed by
-- constitutional triggers, and the three acts that would use it —
-- `draft_on_marketplace`, `upload_product_file`, `list_on_marketplace` — carry
-- `tool = NULL` in the capability registry, which in this schema means they
-- have no door to arrive at. Nothing beyond reading is not a promise made here.
-- It is a description of four rows elsewhere.
--
-- REAL MODE ONLY. There is no Etsy sandbox that would exercise this path
-- against numbers that are not the world's, so none is offered. The reference
-- world already plays the provider's part for the credential lifecycle, which
-- is the rehearsal this institution actually has.
--
-- WHAT IT CANNOT SEE IS PART OF THE OFFER. Etsy does not expose shop
-- statistics through its API — no daily views, visits, favourites, impressions
-- or search queries — and says so deliberately, having found the data used to
-- infer its own financials ahead of its announcements. Only a listing's
-- lifetime views and favourite count are readable, with receipts. `reads` says
-- so, because an offer that overstated what connecting would buy would be the
-- owner agreeing to something on a false account of it.
-- =============================================================================

DROP TRIGGER sense_providers_constitutional_insert;

INSERT INTO sense_providers (provider, sense_key, mode, reads, hands_over) VALUES
  ('etsy', 'revenue', 'real',
   'which shop this is by name and address, whether the listing is still up and what it says, '
   || 'and the orders and the fees Etsy kept — read-only. Not daily views, visits, favourites, '
   || 'impressions or search queries: Etsy does not report shop statistics through its API at all, '
   || 'so those stay yours to enter by hand',
   'nothing beyond reading — publishing a listing needs a write scope this deployment never asks '
   || 'for, and the three acts that would use it are registered with no tool to act through');

CREATE TRIGGER sense_providers_constitutional_insert
BEFORE INSERT ON sense_providers
BEGIN SELECT RAISE(ABORT,'sense_provider:constitutional'); END;
