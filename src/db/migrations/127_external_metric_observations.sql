-- Migration 127: independently observed reality for Shadowing.
--
-- Shadowing was the last rung with no honest supply. Every observation Foundry
-- could produce came from Foundry: an expectation cannot test itself, a claim
-- derived from the expectation is the expectation restated, and a plan echoing
-- it is not evidence. The rung stayed unreachable, correctly.
--
-- Audit of existing production-facing paths, before adding anything: the
-- strongest external source already in the system is `POST /ingest/:token` — a
-- public, token-authenticated endpoint that any outside tool (a payment
-- processor, an automation, the founder's own cron) posts company metrics to.
-- It is genuinely external: the data originates outside Foundry, arrives over
-- an authenticated tenant-bound channel, and knows nothing about any
-- expectation. It wrote `metric_snapshots` and nothing else, so the institution
-- never saw it. No new integration was created for this.
--
-- INDEPENDENCE IS PROVENANCE, NOT PLUMBING. An observation is not independent
-- because it arrived through a different function. Three properties, all
-- enforced below rather than trusted to a caller:
--
--   1. Origin. The observation's source is the external intake, and its payload
--      records the concrete outside reading it came from.
--   2. No echo. It may not name the expectation, responsibility, judgment, or
--      claim it will be compared against. An observer that can see the
--      expectation makes a fabricated match indistinguishable from a real one.
--   3. Temporality. It must postdate the expectation it resolves. Evidence must
--      follow the prediction it tests, and same-instant evidence is ambiguous.

-- A reading reported from outside, reduced to the one thing the institution can
-- honestly say about it: a named company metric moved in a named direction
-- between two externally supplied values.
CREATE TRIGGER external_metric_observation_guard
BEFORE INSERT ON signal_events WHEN NEW.source='external_metric_ingest'
BEGIN
  -- Every absence is coalesced before comparison. `X NOT IN (...)` is NULL when
  -- X is missing, and a NULL condition does not fire RAISE — so an unguarded
  -- check of this shape accepts exactly the payload it was written to refuse:
  -- the one with the field left out entirely.
  SELECT RAISE(ABORT,'external_observation:payload_invalid') WHERE
    json_valid(NEW.payload_json)=0
    OR trim(coalesce(json_extract(NEW.payload_json,'$.origin'),''))=''
    OR coalesce(json_type(NEW.payload_json,'$.observed_value'),'absent') NOT IN ('integer','real')
    OR coalesce(json_type(NEW.payload_json,'$.previous_value'),'absent') NOT IN ('integer','real');

  -- Closed vocabulary: the metric columns the public intake actually accepts,
  -- and the only three movements arithmetic on two numbers can support.
  SELECT RAISE(ABORT,'external_observation:field_invalid')
  WHERE coalesce(json_extract(NEW.payload_json,'$.field'),'absent') NOT IN (
    'new_mrr_cents','expansion_mrr_cents','contraction_mrr_cents','churned_mrr_cents',
    'activation_rate','day_30_retention','churn_rate','mrr_health_ratio',
    'signups_7d','active_users','support_volume_7d','nps_score');
  SELECT RAISE(ABORT,'external_observation:direction_invalid')
  WHERE coalesce(json_extract(NEW.payload_json,'$.direction'),'absent') NOT IN ('rose','fell','held');

  -- The event type is derived from the reading, so a comparison matches on what
  -- was observed rather than on a label a caller chose.
  SELECT RAISE(ABORT,'external_observation:event_type_mismatch')
  WHERE NEW.event_type <> 'external_metric:'
    || json_extract(NEW.payload_json,'$.field') || ':'
    || json_extract(NEW.payload_json,'$.direction');

  -- No echo. An external observer cannot know what it is being compared
  -- against, so an observation that names one is not external.
  SELECT RAISE(ABORT,'external_observation:circular_grounding') WHERE
    json_extract(NEW.payload_json,'$.expectation_id') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.responsibility_id') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.judgment_id') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.claim_id') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.expected_event_type') IS NOT NULL;
END;

-- An expectation about externally observed company reality may only be resolved
-- by such an observation. The same rule migration 119 established for
-- development verification, keyed on the shape of the expectation rather than
-- on a capability label.
CREATE TRIGGER external_shadow_observation_independence_guard
BEFORE INSERT ON responsibility_shadow_comparisons
BEGIN
  SELECT RAISE(ABORT,'external_shadowing:observation_not_independent') WHERE EXISTS (
    SELECT 1 FROM responsibility_shadow_expectations x
    WHERE x.id=NEW.expectation_id AND x.product_id=NEW.product_id
      AND x.expected_event_type LIKE 'external_metric:%'
  ) AND NOT EXISTS (
    SELECT 1 FROM signal_events e
    WHERE NEW.observation_ref='signal_event:' || e.id
      AND e.product_id=NEW.product_id AND e.source='external_metric_ingest');

  -- Evidence must follow the prediction it tests. An observation recorded
  -- before — or in the same instant as — the expectation cannot be news about
  -- it, and ambiguity is refused rather than believed.
  SELECT RAISE(ABORT,'external_shadowing:observation_predates_expectation') WHERE EXISTS (
    SELECT 1 FROM responsibility_shadow_expectations x, signal_events e
    WHERE x.id=NEW.expectation_id AND x.product_id=NEW.product_id
      AND x.expected_event_type LIKE 'external_metric:%'
      AND NEW.observation_ref='signal_event:' || e.id
      AND datetime(e.created_at)<=datetime(x.created_at));
END;
