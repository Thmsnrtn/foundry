-- =============================================================================
-- A SENSE IS NOT A HAND
--
-- The owner's rule, made structural: "GitHub read access may allow Foundry to
-- understand software. It does not automatically grant code mutation authority.
-- Stripe observation may allow Foundry to understand revenue. It does not
-- automatically grant the ability to move money."
--
-- Until now a connection was an `integrations` row: a provider name, a
-- credential and a sync cadence. That is a fact about plumbing. It does not say
-- WHAT FOUNDRY IS TRYING TO LEARN, why that matters, what remains invisible, or
-- — the load-bearing one — WHAT CONNECTING IT DOES NOT ALLOW. So the owner was
-- asked to "connect an integration", which is a question about software, when
-- the question he can actually answer is "may I see your revenue".
--
-- THREE TABLES, THREE DIFFERENT KINDS OF FACT.
--
--   `senses`           what Foundry can try to learn about any company, and
--                      what learning it never grants. Constitutional.
--   `sense_providers`  who could supply it, in which mode, and what the
--                      connection technically hands over. Constitutional.
--   `company_senses`   what is actually connected for one company, how fresh it
--                      is, and whether it is healthy. Ordinary state.
--
-- WHY THE VOCABULARIES ARE IMMUTABLE. A list of what a connection may NOT do is
-- a governance control. One that code can widen at runtime is one a compromised
-- path can widen, and the owner would have agreed to a sentence that later
-- meant something else. Same posture as `governed_effect_kinds` (136) and
-- `owner_boundary_subjects` (225).
--
-- THREE SOURCE MODES, AND WHY THE THIRD IS NOT A DETAIL.
--
--   real       a real provider reporting a real company. The only evidence
--              about the world.
--   sandbox    a real provider's TEST mode against a real company — Stripe's
--              test keys, a staging project. The whole production path runs;
--              the numbers are not the world's.
--   reference  the reference world (migrations 222-223).
--
-- The mandate is explicit that business logic must not fork on which of these
-- it is: "Provenance and authority differ. The company intelligence should
-- survive unchanged." So the mode never reaches the reasoning. It decides ONE
-- thing — which observation channel a reading is written to — and every count
-- of independent evidence keeps working, unchanged, because the channel already
-- carried that meaning before this migration existed.
-- =============================================================================

CREATE TABLE senses (
  sense_key      TEXT PRIMARY KEY,
  -- Completes "I cannot see ...". The sentence the owner reads first.
  cannot_see     TEXT NOT NULL,
  -- Completes "Connecting it would let me understand ...".
  would_learn    TEXT NOT NULL,
  -- Completes "It would not let me ...". THE LOAD-BEARING COLUMN.
  never_grants   TEXT NOT NULL,
  -- Which of a company's numbers this sense can supply, as a JSON array. Empty
  -- is honest for a sense that feeds understanding rather than a metric.
  channels_json  TEXT NOT NULL DEFAULT '[]',
  sort_order     INTEGER NOT NULL
);

INSERT INTO senses (sense_key, cannot_see, would_learn, never_grants, channels_json, sort_order) VALUES
  ('revenue', 'what it earns',
   'revenue, subscriptions, failed payments, and what customers actually pay',
   'move money, refund anyone, change prices, or change a subscription',
   '["mrr_cents","new_mrr_cents","expansion_mrr_cents","contraction_mrr_cents","churned_mrr_cents","churn_rate","mrr_health_ratio"]', 1),
  ('customers', 'who its customers are',
   'how many people are using it, who is new, and who has left',
   'contact a customer, change an account, or cancel anyone',
   '["active_users","signups_7d","day_30_retention"]', 2),
  ('product_usage', 'what people do in it',
   'what people actually do in the product, and where they get stuck',
   'change the product, run an experiment on real people, or track anyone new',
   '["activation_rate","active_users","signups_7d"]', 3),
  ('support', 'what customers are asking for',
   'what customers are writing in about, and how much of it there is',
   'reply to anyone, close a conversation, or promise a customer anything',
   '["support_volume_7d"]', 4),
  ('software', 'what it is built from',
   'what the software is, what changed in it, and what is being worked on',
   'change the code, merge anything, or deploy',
   '[]', 5),
  ('errors', 'what is breaking',
   'what is failing in production, how often, and for how many people',
   'change the code, restart anything, or touch infrastructure',
   '[]', 6),
  ('costs', 'what it costs to run',
   'what the infrastructure and services cost, and which way that is going',
   'change a plan, cancel a service, or spend anything',
   '[]', 7);

CREATE TRIGGER senses_constitutional_insert BEFORE INSERT ON senses
BEGIN SELECT RAISE(ABORT,'sense:constitutional'); END;
CREATE TRIGGER senses_constitutional_update BEFORE UPDATE ON senses
BEGIN SELECT RAISE(ABORT,'sense:constitutional'); END;
CREATE TRIGGER senses_constitutional_delete BEFORE DELETE ON senses
BEGIN SELECT RAISE(ABORT,'sense:constitutional'); END;

-- WHO COULD SUPPLY IT, AND WHAT THE CONNECTION ACTUALLY HANDS OVER.
--
-- `hands_over` is the honest disclosure and is deliberately separate from the
-- sense's `never_grants`. The sense says what FOUNDRY will not do. This says
-- what the CREDENTIAL would technically permit if it were misused — which is a
-- different and less comfortable fact, and the owner is entitled to both.
CREATE TABLE sense_providers (
  provider     TEXT NOT NULL,
  sense_key    TEXT NOT NULL REFERENCES senses(sense_key),
  mode         TEXT NOT NULL CHECK (mode IN ('real','sandbox','reference')),
  -- What the owner is told the credential is scoped to.
  reads        TEXT NOT NULL,
  -- What that credential could technically do beyond reading, said plainly, or
  -- 'nothing beyond reading' when the scope genuinely cannot.
  hands_over   TEXT NOT NULL,
  PRIMARY KEY (provider, sense_key, mode)
);

INSERT INTO sense_providers (provider, sense_key, mode, reads, hands_over) VALUES
  ('stripe', 'revenue', 'real',
   'charges, subscriptions, invoices and payment failures, read-only',
   'a Stripe key with write scope could move money; Foundry asks for read scope and the outbound door refuses money regardless'),
  ('stripe', 'revenue', 'sandbox',
   'the same, against Stripe test mode — the whole path, none of the world',
   'nothing that touches a real account or a real card'),
  ('stripe', 'customers', 'real',
   'customer records and subscription state, read-only',
   'a Stripe key with write scope could cancel a subscription; Foundry asks for read scope'),
  ('stripe', 'customers', 'sandbox',
   'the same, against Stripe test mode', 'nothing that touches a real customer'),
  ('posthog', 'product_usage', 'real',
   'event counts and funnels for the project you name, read-only',
   'nothing beyond reading'),
  ('posthog', 'customers', 'real',
   'how many distinct people used it, read-only', 'nothing beyond reading'),
  ('plausible', 'product_usage', 'real',
   'page and visitor counts, read-only', 'nothing beyond reading'),
  ('github', 'software', 'real',
   'the repository, its commits and its pull requests, read-only',
   'a token with write scope could push; Foundry asks for read scope, and changing code is a separate permission it has to earn'),
  ('sentry', 'errors', 'real',
   'error events and their frequency, read-only', 'nothing beyond reading'),
  ('linear', 'software', 'real',
   'issues and what is being worked on, read-only', 'nothing beyond reading'),
  ('intercom', 'support', 'real',
   'conversation counts and what customers wrote in about, read-only',
   'an Intercom token with write scope could reply to a customer; Foundry asks for read scope and the outbound door refuses sending regardless'),
  -- THE REFERENCE WORLD IS A PROVIDER LIKE ANY OTHER, which is the point: the
  -- company product consumes it through the same contract it will consume
  -- Stripe through, so connecting a real source later replaces a source rather
  -- than rebuilding a path.
  ('reference_world', 'revenue', 'reference',
   'the reference world reporting a company that does not exist', 'nothing; there is nothing there'),
  ('reference_world', 'customers', 'reference',
   'the reference world reporting a company that does not exist', 'nothing; there is nothing there'),
  ('reference_world', 'product_usage', 'reference',
   'the reference world reporting a company that does not exist', 'nothing; there is nothing there'),
  ('reference_world', 'support', 'reference',
   'the reference world reporting a company that does not exist', 'nothing; there is nothing there');

CREATE TRIGGER sense_providers_constitutional_insert BEFORE INSERT ON sense_providers
BEGIN SELECT RAISE(ABORT,'sense_provider:constitutional'); END;
CREATE TRIGGER sense_providers_constitutional_update BEFORE UPDATE ON sense_providers
BEGIN SELECT RAISE(ABORT,'sense_provider:constitutional'); END;
CREATE TRIGGER sense_providers_constitutional_delete BEFORE DELETE ON sense_providers
BEGIN SELECT RAISE(ABORT,'sense_provider:constitutional'); END;

-- WHAT IS ACTUALLY CONNECTED, FOR ONE COMPANY.
--
-- `integrations` still holds the credential and the cadence; this holds the
-- MEANING. They are one-to-many: a single Stripe connection can be two senses
-- (revenue and customers), and the owner granted one thing and understands two.
CREATE TABLE company_senses (
  id                TEXT PRIMARY KEY,
  product_id        TEXT NOT NULL REFERENCES products(id),
  sense_key         TEXT NOT NULL REFERENCES senses(sense_key),
  provider          TEXT NOT NULL,
  mode              TEXT NOT NULL CHECK (mode IN ('real','sandbox','reference')),
  -- The credential's row, when there is one. NULL for the reference world,
  -- which needs none — and that absence is itself informative.
  integration_id    TEXT,
  connected_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- What the owner saw when he agreed. Kept so that a later widening of the
  -- vocabulary cannot retroactively change what he consented to.
  disclosure        TEXT NOT NULL,
  last_observed_at  TEXT,
  last_error        TEXT,
  disconnected_at   TEXT,
  disconnect_reason TEXT
);

-- A company may hold one live connection per sense. Two providers answering the
-- same question is a conflict the institution would have to resolve on the
-- owner's behalf, and picking is exactly the judgement that is his.
CREATE UNIQUE INDEX idx_company_sense_one_live
  ON company_senses(product_id, sense_key) WHERE disconnected_at IS NULL;

CREATE TRIGGER company_sense_guard
BEFORE INSERT ON company_senses
BEGIN
  SELECT RAISE(ABORT,'company_sense:disclosure_required')
    WHERE trim(NEW.disclosure) = '';
  -- The (provider, sense, mode) triple has to be one the vocabulary declares.
  -- Without this a caller could connect 'stripe' as the 'software' sense and
  -- the owner would be shown a disclosure about code for a payments key.
  SELECT RAISE(ABORT,'company_sense:not_a_declared_provider') WHERE NOT EXISTS (
    SELECT 1 FROM sense_providers p
     WHERE p.provider = NEW.provider AND p.sense_key = NEW.sense_key AND p.mode = NEW.mode);
  -- A COMPANY THAT DOES NOT EXIST MAY NOT HAVE A REAL SENSE, and a real company
  -- may not have a reference one. The same rule migration 223 applies to
  -- readings, applied one level up at the source: without it, a reference
  -- company could hold a live Stripe credential.
  SELECT RAISE(ABORT,'company_sense:reference_company_real_sense')
    WHERE NEW.mode <> 'reference'
      AND EXISTS (SELECT 1 FROM products WHERE id = NEW.product_id AND reality = 'reference');
  SELECT RAISE(ABORT,'company_sense:real_company_reference_sense')
    WHERE NEW.mode = 'reference'
      AND EXISTS (SELECT 1 FROM products WHERE id = NEW.product_id AND reality = 'real');
END;

-- Disconnection is one-way for a row, for the reason lifting a boundary is: a
-- sense that could be reconnected in place would leave a record saying it was
-- live during a period when it was not. Reconnecting writes a new row.
CREATE TRIGGER company_sense_disconnect_is_one_way
BEFORE UPDATE ON company_senses
BEGIN
  -- A DISCONNECTED SENSE IS FINISHED, and comparing the two timestamps to
  -- decide would have let a re-disconnect through inside the same second —
  -- `datetime('now')` has one-second resolution, so `IS NOT` is false exactly
  -- when the attempt is fastest. The rule is about the row's state, not about
  -- whether the new value happens to differ.
  SELECT RAISE(ABORT,'company_sense:already_disconnected')
    WHERE OLD.disconnected_at IS NOT NULL;
  SELECT RAISE(ABORT,'company_sense:disconnect_needs_reason')
    WHERE NEW.disconnected_at IS NOT NULL
      AND trim(coalesce(NEW.disconnect_reason,'')) = '';
  SELECT RAISE(ABORT,'company_sense:immutable')
    WHERE NEW.sense_key IS NOT OLD.sense_key OR NEW.provider IS NOT OLD.provider
       OR NEW.mode IS NOT OLD.mode OR NEW.product_id IS NOT OLD.product_id
       OR NEW.disclosure IS NOT OLD.disclosure;
END;

CREATE INDEX idx_company_senses_live
  ON company_senses(product_id, sense_key) WHERE disconnected_at IS NULL;
