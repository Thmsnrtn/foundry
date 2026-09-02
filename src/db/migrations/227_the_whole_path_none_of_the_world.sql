-- =============================================================================
-- THE WHOLE PATH, NONE OF THE WORLD
--
-- The owner's instruction: build and controlled-prove the complete sense
-- architecture "using the Reference World and provider sandboxes/test modes
-- where appropriate", so that a real credential becomes "the final replacement
-- of a controlled source with a real source — not the thing required for you to
-- discover how the system should work".
--
-- Stripe has a test mode. It is a real provider, real HTTP, real webhook
-- shapes, real failure modes, real pagination, real rate limits — against
-- money that does not exist. Running Foundry against it exercises everything
-- except the one thing it must not claim: that these numbers describe the
-- world.
--
-- Migration 223 established that the world's readings and the reference world's
-- are different channels, and that the channel — not a join, not a caller's
-- word — is what makes "has this been proven against reality?" a question SQL
-- can answer. A sandbox reading is a third answer to that question and needs a
-- third channel, for exactly the same reason:
--
--   external_metric_ingest    a real provider reported a real company.
--                             THE ONLY EVIDENCE ABOUT THE WORLD.
--   sandbox_metric_ingest     a real provider's test mode reported a real
--                             company. The path is real; the numbers are not.
--   reference_metric_ingest   the reference world reported a company that does
--                             not exist.
--
-- The consequence is the one that matters and it is free: every existing query
-- that counts `external_metric_ingest` — every readiness check, every
-- admission, every count that decides what Foundry has earned — excluded
-- sandbox evidence the moment this ran, with no change to it and nobody
-- remembering a join.
--
-- ONE GUARD, THREE CHANNELS. The contract is identical: payload shape, numeric
-- types, closed field vocabulary, three directions, no echo of what it will be
-- compared against. A rehearsal that travels a laxer path rehearses nothing.
-- =============================================================================

DROP TRIGGER IF EXISTS external_metric_observation_guard;

CREATE TRIGGER external_metric_observation_guard
BEFORE INSERT ON signal_events
WHEN NEW.source IN
  ('external_metric_ingest','sandbox_metric_ingest','reference_metric_ingest')
BEGIN
  SELECT RAISE(ABORT,'external_observation:payload_invalid') WHERE
    json_valid(NEW.payload_json)=0
    OR trim(coalesce(json_extract(NEW.payload_json,'$.origin'),''))=''
    OR coalesce(json_type(NEW.payload_json,'$.observed_value'),'absent') NOT IN ('integer','real')
    OR coalesce(json_type(NEW.payload_json,'$.previous_value'),'absent') NOT IN ('integer','real');

  SELECT RAISE(ABORT,'external_observation:field_invalid')
  WHERE coalesce(json_extract(NEW.payload_json,'$.field'),'absent') NOT IN (
    'new_mrr_cents','expansion_mrr_cents','contraction_mrr_cents','churned_mrr_cents',
    'activation_rate','day_30_retention','churn_rate','mrr_health_ratio',
    'signups_7d','active_users','support_volume_7d','nps_score')
  AND NOT EXISTS (
    SELECT 1 FROM company_observation_channels c
    WHERE c.product_id = NEW.product_id
      AND c.channel_key = coalesce(json_extract(NEW.payload_json,'$.field'),'absent')
      AND c.revoked_at IS NULL);

  SELECT RAISE(ABORT,'external_observation:direction_invalid')
  WHERE coalesce(json_extract(NEW.payload_json,'$.direction'),'absent') NOT IN ('rose','fell','held');

  -- The event type is derived from the reading AND from the channel, so a
  -- reading announces which world it came from in the type the prefix-keyed
  -- independence guards match on.
  SELECT RAISE(ABORT,'external_observation:event_type_mismatch')
  WHERE NEW.event_type <> (CASE NEW.source
        WHEN 'reference_metric_ingest' THEN 'reference_metric:'
        WHEN 'sandbox_metric_ingest' THEN 'sandbox_metric:'
        ELSE 'external_metric:' END)
    || json_extract(NEW.payload_json,'$.field') || ':'
    || json_extract(NEW.payload_json,'$.direction');

  SELECT RAISE(ABORT,'external_observation:circular_grounding') WHERE
    json_extract(NEW.payload_json,'$.expectation_id') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.responsibility_id') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.judgment_id') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.claim_id') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.expected_event_type') IS NOT NULL;
END;

-- WHICH CHANNEL A COMPANY MAY WRITE IS STILL NOT ITS CHOICE.
--
-- Replaces migration 223's rule with the same rule over three channels. A
-- reference company may write only the reference channel; a real company may
-- write the world's or the sandbox's, and which one is decided by the mode of
-- the sense that produced it — never by the caller.
DROP TRIGGER IF EXISTS signal_event_evidence_matches_reality;

CREATE TRIGGER signal_event_evidence_matches_reality
BEFORE INSERT ON signal_events
WHEN NEW.source IN ('external_metric_ingest','effect_outcome_report',
                    'sandbox_metric_ingest','reference_metric_ingest')
BEGIN
  SELECT RAISE(ABORT,'reference_company:world_evidence_refused')
   WHERE NEW.source IN ('external_metric_ingest','effect_outcome_report','sandbox_metric_ingest')
     AND EXISTS (SELECT 1 FROM products
                  WHERE id=NEW.product_id AND reality='reference');

  SELECT RAISE(ABORT,'real_company:reference_evidence_refused')
   WHERE NEW.source='reference_metric_ingest'
     AND EXISTS (SELECT 1 FROM products
                  WHERE id=NEW.product_id AND reality='real');
END;

-- THE SAME INDEPENDENCE, IN THE SANDBOX. Sibling of migrations 127 and 223,
-- keyed on the sandbox prefix. A company being exercised against a provider's
-- test mode walks the identical ladder under identical rules; what it may never
-- do is have that count as the world agreeing with it.
CREATE TRIGGER sandbox_shadow_observation_independence_guard
BEFORE INSERT ON responsibility_shadow_comparisons
BEGIN
  SELECT RAISE(ABORT,'sandbox_shadowing:observation_not_independent') WHERE EXISTS (
    SELECT 1 FROM responsibility_shadow_expectations x
    WHERE x.id=NEW.expectation_id AND x.product_id=NEW.product_id
      AND x.expected_event_type LIKE 'sandbox_metric:%'
  ) AND NOT EXISTS (
    SELECT 1 FROM signal_events e
    WHERE NEW.observation_ref='signal_event:' || e.id
      AND e.product_id=NEW.product_id AND e.source='sandbox_metric_ingest');

  SELECT RAISE(ABORT,'sandbox_shadowing:observation_predates_expectation') WHERE EXISTS (
    SELECT 1 FROM responsibility_shadow_expectations x, signal_events e
    WHERE x.id=NEW.expectation_id AND x.product_id=NEW.product_id
      AND x.expected_event_type LIKE 'sandbox_metric:%'
      AND NEW.observation_ref='signal_event:' || e.id
      AND datetime(e.created_at)<=datetime(x.created_at));
END;
