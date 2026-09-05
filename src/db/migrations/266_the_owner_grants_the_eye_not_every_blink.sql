-- THE OWNER GRANTS THE EYE. HE DOES NOT APPROVE EVERY BLINK.
--
-- A SENSE IS NOT A HAND, and the machinery had quietly stopped believing it.
-- Everything an act could be was being routed through consequential authority,
-- so asking a public registry when a package was last published produced an
-- owner decision — and a mature institution with hundreds of continuous
-- observational capabilities would produce hundreds of them. That is owner
-- machinery at scale, which is the thing this institution exists to absorb.
--
-- THREE INDEPENDENT QUESTIONS, forced through one mechanism:
--
--   CAPABILITY — can Foundry do this at all, with what provider, how proven?
--     Already modelled: `capabilities`, `capability_providers`, maturity.
--   ACCESS BASIS — may it look at this, given credential, privacy, legal
--     footing, cost, rate and data sensitivity?
--     NOT MODELLED AT ALL. `senses` covers one basis — a company's private data
--     the owner connected — and public observation had no representation, so it
--     fell through to the only mechanism that existed.
--   CONSEQUENTIAL AUTHORITY — may it cause this external effect?
--     Modelled: rungs, boundaries, delegations.
--
-- This is the missing middle one.
--
-- IT IS NOT "ALL OBSERVATION IS ALLOWED". Connecting Stripe, reading customer
-- data, granting OAuth, buying a dataset, accepting a provider's terms and
-- anything whose legal footing is uncertain all still take an owner act. What
-- changes is that once the eye exists, ordinary looking through it stops
-- consuming per-act authority.

CREATE TABLE capability_access (
  capability_key TEXT PRIMARY KEY REFERENCES capabilities(capability_key),
  basis          TEXT NOT NULL CHECK (basis IN
                   ('public_observation','owner_connected','bounded_delegation',
                    'exact_approval')),
  why            TEXT NOT NULL,
  -- Whether looking through this requires something the owner connected.
  needs_credential INTEGER NOT NULL DEFAULT 0,
  -- What an ordinary look may cost. Above this it is not ordinary perception,
  -- whatever else is true of it: spending is a hand.
  may_cost_cents INTEGER NOT NULL DEFAULT 0,
  -- What this basis does NOT permit, in the tradition of `senses.never_grants`.
  never_grants   TEXT NOT NULL,
  established_by TEXT NOT NULL,
  established_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO capability_access
  (capability_key, basis, why, needs_credential, may_cost_cents, never_grants,
   established_by)
VALUES
  ('read_public_web','public_observation',
   'a page anybody may fetch, with no account and no payment',0,0,
   'changing anything on the page, or acting on what it says',
   'institution:constitutional'),
  ('search_public_web','public_observation',
   'a search anybody may run, with no account and no payment',0,0,
   'contacting anybody found, or acting on what is found',
   'institution:constitutional'),
  ('read_package_registry','public_observation',
   'a public registry published for exactly this purpose, free and without an account',0,0,
   'changing a dependency, opening a pull request, or contacting a maintainer',
   'institution:constitutional'),
  ('read_community_discussion','public_observation',
   'archives of what people said in public, readable without an account',0,0,
   'replying to anybody, or contacting anybody who wrote what was read',
   'institution:constitutional'),
  ('read_marketplace_listings','public_observation',
   'a shelf anybody may browse',0,0,
   'listing anything, buying anything, or contacting a seller',
   'institution:constitutional'),
  ('read_reviews','public_observation',
   'reviews published for the public to read',0,0,
   'replying to a review or contacting a reviewer',
   'institution:constitutional'),
  ('read_job_postings','public_observation',
   'postings published so that strangers will read them',0,0,
   'applying, replying, or contacting anybody who posted',
   'institution:constitutional'),
  ('read_public_dataset','public_observation',
   'a dataset published for anybody to download, at no cost',0,0,
   'buying a dataset, accepting a licence, or redistributing what was read',
   'institution:constitutional');

-- WHAT AN OWNER-CONNECTED SENSE STILL COSTS HIM: one act, once, to connect it.
-- Named here so the difference from public observation is a row rather than a
-- convention, and so nothing can drift into treating a private source as
-- ordinary perception.
INSERT INTO capability_access
  (capability_key, basis, why, needs_credential, may_cost_cents, never_grants,
   established_by)
SELECT capability_key, 'owner_connected',
       'a private source that only exists to him, reachable only with something '
       || 'he connected',
       1, 0,
       'acting on what it shows, spending, or reaching anybody it names',
       'institution:constitutional'
  FROM capabilities
 WHERE capability_key IN ('read_repository','read_support_queue')
   AND capability_key NOT IN (SELECT capability_key FROM capability_access);

CREATE TRIGGER capability_access_constitutional_update
BEFORE UPDATE ON capability_access
BEGIN SELECT RAISE(ABORT,'capability_access:constitutional'); END;
CREATE TRIGGER capability_access_constitutional_delete
BEFORE DELETE ON capability_access
BEGIN SELECT RAISE(ABORT,'capability_access:constitutional'); END;

-- A PUBLIC BASIS MAY NEVER REQUIRE A CREDENTIAL OR COST MONEY.
--
-- The two things that would turn ordinary perception back into something that
-- should reach him. Enforced here so a later row cannot quietly widen what
-- "public" means.
CREATE TRIGGER capability_access_public_is_actually_public
BEFORE INSERT ON capability_access
WHEN NEW.basis = 'public_observation'
     AND (NEW.needs_credential <> 0 OR NEW.may_cost_cents <> 0)
BEGIN SELECT RAISE(ABORT,'capability_access:public_means_free_and_open'); END;
