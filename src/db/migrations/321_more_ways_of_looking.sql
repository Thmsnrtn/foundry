-- =============================================================================
-- MORE WAYS OF LOOKING
--
-- Two real eyes — a package registry and one forum — and no real candidate has
-- ever survived, because a candidate takes two genuinely different ways of
-- knowing and a registry read fifteen times is one. This opens six more, all
-- public, none needing a credential or an account, each supplying a kind of
-- knowing the constitution already names (migration 236) and the stance it
-- carries (253):
--
--   Apple's App Store search      app_store        substitute
--   Apple's App Store reviews     review           satisfaction
--   DuckDuckGo autocomplete       search_evidence  demand_signal
--   Remotive's jobs feed          job_posting      procurement_labour
--   GitHub's public issue search  community        problem_pain
--   Wikipedia pageviews           public_dataset   usage
--
-- Each arrives DECLARED, as the first two did, and is proven by the sense
-- check asking it one dull question — or found broken by the same check and
-- left unasked until it answers again.
--
-- And what three of those stances can settle, which the bearings table did
-- not yet say. A missing row means a source says nothing, so without these
-- the new eyes could be read and could never bear on anything. Each row is
-- one direction of one question, and says why in words.
-- =============================================================================

-- Two capabilities are new; the other four eyes supply capabilities the
-- constitution already names (243, 249) and are providers of those.
DROP TRIGGER capabilities_constitutional_insert;
INSERT INTO capabilities (capability_key, family, what_it_does, rung, sort_order) VALUES
  ('read_app_store', 'research',
   'see which apps already exist for a problem, how they are rated, and when they were last touched',
   'observe', 14),
  ('read_search_demand', 'research',
   'see what people are typing into a search box about a problem', 'observe', 15);
CREATE TRIGGER capabilities_constitutional_insert BEFORE INSERT ON capabilities
BEGIN SELECT RAISE(ABORT,'capability:constitutional'); END;

-- And on what basis each may be looked through (migration 266): public
-- observation, no credential, no cost, and never a hand.
INSERT INTO capability_access
  (capability_key, basis, why, needs_credential, may_cost_cents, never_grants, established_by)
VALUES
  ('read_app_store','public_observation',
   'a store front anybody may browse, with no account and no payment',0,0,
   'installing, buying, rating, or contacting a developer',
   'institution:constitutional'),
  ('read_search_demand','public_observation',
   'a search box anybody may type into, with no account and no payment',0,0,
   'clicking anything found, or acting on what is suggested',
   'institution:constitutional');

INSERT INTO capability_providers
  (id, capability_key, provider, how, tool, cost_note, maturity, sort_order, supplies_source_type) VALUES
  ('cp_apple_app_store', 'read_app_store', 'apple_app_store', 'api', NULL,
   'nothing - public, no credential, no account', 'declared', 11, 'app_store'),
  ('cp_apple_app_reviews', 'read_reviews', 'apple_app_reviews', 'api', NULL,
   'nothing - public, no credential, no account', 'declared', 12, 'review'),
  ('cp_ddg_autocomplete', 'read_search_demand', 'duckduckgo_autocomplete', 'api', NULL,
   'nothing - public, no credential, no account', 'declared', 13, 'search_evidence'),
  ('cp_remotive_jobs', 'read_job_postings', 'remotive', 'api', NULL,
   'nothing - public, no credential, no account; remote roles only', 'declared', 14, 'job_posting'),
  ('cp_github_issues', 'read_community_discussion', 'github_issues', 'api', NULL,
   'nothing - public, no credential; a handful of requests a minute', 'declared', 15, 'community'),
  ('cp_wikipedia_pageviews', 'read_public_dataset', 'wikipedia_pageviews', 'api', NULL,
   'nothing - public, no credential; asks for a named user agent', 'declared', 16, 'public_dataset');

DROP TRIGGER stance_bearings_constitutional_insert;
INSERT INTO stance_bearings (stance, about, when_it, bearing, because) VALUES
  ('demand_signal', 'enough_people', 'found', 'narrows',
   'people look for it by name, which is attention and not yet a count of them'),
  ('demand_signal', 'reachable', 'found', 'supports',
   'people already look for it by name, so it can be found without buying attention'),
  ('demand_signal', 'pain_exists', 'found', 'narrows',
   'people search for a way out of it, which is a want rather than a described cost'),
  ('satisfaction', 'pain_exists', 'found', 'supports',
   'people who use what exists describe what still fails, which is the work still costing them'),
  ('procurement_labour', 'enough_people', 'found', 'narrows',
   'organisations pay people for it, which is money against the work and not a count of buyers'),
  ('procurement_labour', 'pain_exists', 'found', 'supports',
   'an organisation pays a person to do it, which is the work costing them money'),
  ('usage', 'gap_exists', 'found', 'narrows',
   'measured attention says the subject is real and says nothing about what serves it');
CREATE TRIGGER stance_bearings_constitutional_insert
BEFORE INSERT ON stance_bearings
BEGIN SELECT RAISE(ABORT,'stance_bearing:constitutional'); END;
