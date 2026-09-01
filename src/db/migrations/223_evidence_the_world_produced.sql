-- =============================================================================
-- EVIDENCE THE WORLD PRODUCED
--
-- Migration 222 made a company's reality a fact it cannot edit, and scoped the
-- surfaces where the owner reads answers. That stops synthetic data from being
-- SHOWN as real. It does not stop synthetic data from being COUNTED as real,
-- which is the more dangerous half.
--
-- Everything the institution claims about itself is grounded in signal events.
-- Whether a responsibility may leave Shadowing, whether it may be admitted to
-- Assisting, whether the owner is asked to grant authority — each of those is
-- decided by counting observations of a particular `source`. A reference
-- company exists precisely to be run through that ladder, so it will produce
-- exactly those observations, in volume, on demand. If they carry the same
-- source string as a real provider's readings, then every count that decides
-- whether Foundry has earned something silently includes fiction, and no query
-- anywhere can tell the difference after the fact.
--
-- BUILT, CONTROLLED-PROVEN, REALITY-PROVEN must be a QUESTION THE DATABASE CAN
-- ANSWER, not a claim a person remembers to qualify. So the world's evidence
-- and the reference world's evidence are different channels, and which one a
-- company may write is decided by a column it cannot change:
--
--   external_metric_ingest    a real provider reported a real number about a
--                             real company. Only a real company may have one.
--   reference_metric_ingest   the reference world reported a number about a
--                             company that does not exist. Only a reference
--                             company may have one.
--
-- The consequence is that every existing query counting `external_metric_ingest`
-- became reference-safe the moment this migration ran, with no change to it and
-- no reliance on anyone remembering a join. That is the point: the leak surface
-- migration 222 had to patch by hand does not exist here.
--
-- WHY ONE GUARD AND NOT TWO. The contract for a reference reading is the SAME
-- contract — payload shape, numeric types, closed field vocabulary, the three
-- directions arithmetic supports, no echo of what it will be compared against.
-- A rehearsal that travels a laxer path rehearses nothing. So the guard is
-- widened rather than duplicated: two channels, one body, and no way for them
-- to drift apart. Migration 135 learned this the hard way in the other
-- direction — replacing a trigger silently dropped half of it — so the body
-- below is 135's, entire, with the source-dependent prefix as the only change.
--
-- WHAT IS DELIBERATELY NOT HERE. `effect_outcome_report` is refused for a
-- reference company rather than twinned. Its guard requires an
-- `outbound_actions` row that actually EXECUTED, and migration 222's kill
-- switch refuses a reference company at the single door to the world, so such a
-- row cannot exist. Refusing it is therefore the honest statement of what is
-- true today. A reference company will rehearse effects when there is an
-- executor that carries them out against the reference world instead of a
-- provider — and that executor brings its own channel with it. Twinning the
-- source now would create schema nothing can write and a contract nothing has
-- tested.
-- =============================================================================

-- ONE CONTRACT, TWO CHANNELS. Reproduced from migration 135 in full, for the
-- reason 135 itself records: replacing a trigger means replacing all of it.
DROP TRIGGER IF EXISTS external_metric_observation_guard;

CREATE TRIGGER external_metric_observation_guard
BEFORE INSERT ON signal_events
WHEN NEW.source IN ('external_metric_ingest','reference_metric_ingest')
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

  -- The event type is derived from the reading, so a comparison matches on what
  -- was observed rather than on a label a caller chose. It is ALSO derived from
  -- the channel: a reference reading announces itself as one in its event type,
  -- so the prefix-keyed independence guards below cannot confuse the two.
  SELECT RAISE(ABORT,'external_observation:event_type_mismatch')
  WHERE NEW.event_type <> (CASE NEW.source
        WHEN 'reference_metric_ingest' THEN 'reference_metric:'
        ELSE 'external_metric:' END)
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

-- WHICH CHANNEL A COMPANY MAY WRITE IS NOT ITS CHOICE.
--
-- Both directions are refused, and the second is not symmetry for its own sake.
-- A reference reading landing on a REAL company is the same corruption read
-- backwards: the owner's company would carry a number nothing in the world ever
-- reported, and it would count toward everything a real reading counts toward.
-- A seeding script with the wrong id in a variable is all it takes.
CREATE TRIGGER signal_event_evidence_matches_reality
BEFORE INSERT ON signal_events
WHEN NEW.source IN (
  'external_metric_ingest','effect_outcome_report','reference_metric_ingest')
BEGIN
  SELECT RAISE(ABORT,'reference_company:world_evidence_refused')
   WHERE NEW.source IN ('external_metric_ingest','effect_outcome_report')
     AND EXISTS (SELECT 1 FROM products
                  WHERE id=NEW.product_id AND reality='reference');

  SELECT RAISE(ABORT,'real_company:reference_evidence_refused')
   WHERE NEW.source='reference_metric_ingest'
     AND EXISTS (SELECT 1 FROM products
                  WHERE id=NEW.product_id AND reality='real');
END;

-- THE SAME INDEPENDENCE, IN THE RIGHT WORLD.
--
-- Migration 127's guard stays exactly as it is — a proven guard is not reworked
-- to be tidy, and it also carries the temporality check. This is its sibling
-- for the reference channel, keyed on the reference event-type prefix. A
-- reference company therefore walks the IDENTICAL ladder under the IDENTICAL
-- rules; what differs is only which world's readings may satisfy it.
CREATE TRIGGER reference_shadow_observation_independence_guard
BEFORE INSERT ON responsibility_shadow_comparisons
BEGIN
  SELECT RAISE(ABORT,'reference_shadowing:observation_not_independent') WHERE EXISTS (
    SELECT 1 FROM responsibility_shadow_expectations x
    WHERE x.id=NEW.expectation_id AND x.product_id=NEW.product_id
      AND x.expected_event_type LIKE 'reference_metric:%'
  ) AND NOT EXISTS (
    SELECT 1 FROM signal_events e
    WHERE NEW.observation_ref='signal_event:' || e.id
      AND e.product_id=NEW.product_id AND e.source='reference_metric_ingest');

  -- Evidence must follow the prediction it tests, here as there.
  SELECT RAISE(ABORT,'reference_shadowing:observation_predates_expectation') WHERE EXISTS (
    SELECT 1 FROM responsibility_shadow_expectations x, signal_events e
    WHERE x.id=NEW.expectation_id AND x.product_id=NEW.product_id
      AND x.expected_event_type LIKE 'reference_metric:%'
      AND NEW.observation_ref='signal_event:' || e.id
      AND datetime(e.created_at)<=datetime(x.created_at));
END;
