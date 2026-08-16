-- Migration 119: independence of development verification observations.
--
-- Software development is being made an ordinary company responsibility. It
-- reuses the existing responsibility, understanding, and Shadowing machinery
-- unchanged; the only thing that genuinely differs is what counts as an
-- independent observation of development reality.
--
-- No new expectation, comparison, or responsibility table is introduced.

-- A development observation is a canonical signal event carrying the real
-- check that ran and the real result it produced.
CREATE TRIGGER development_verification_observation_guard
BEFORE INSERT ON signal_events WHEN NEW.source='development_verification'
BEGIN
  SELECT RAISE(ABORT,'development_observation:payload_invalid') WHERE
    json_valid(NEW.payload_json)=0
    OR trim(coalesce(json_extract(NEW.payload_json,'$.check'),''))=''
    OR trim(coalesce(json_extract(NEW.payload_json,'$.result'),''))='';

  -- The observer may not see, cite, or echo the expectation it will be
  -- compared against. Verification that can read the expectation is
  -- self-confirming, not independent, and a fabricated pass would be
  -- indistinguishable from a real one.
  SELECT RAISE(ABORT,'development_observation:circular_grounding') WHERE
    json_extract(NEW.payload_json,'$.expectation_id') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.expected_event_type') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.responsibility_id') IS NOT NULL;
END;

-- An expectation about what a repository check will report may only be
-- resolved by such an observation. An arbitrary self-authored signal —
-- including one a model or a proposer wrote — cannot satisfy it.
--
-- The guard keys on the shape of the expectation, not on the responsibility's
-- capability label. Development-capability responsibilities that shadow
-- ordinary company events keep the generic Shadowing contract under which they
-- were already benchmarked; only a claim about verification carries the
-- stricter independence requirement.
CREATE TRIGGER development_shadow_observation_independence_guard
BEFORE INSERT ON responsibility_shadow_comparisons
BEGIN
  SELECT RAISE(ABORT,'development_shadowing:observation_not_independent') WHERE EXISTS (
    SELECT 1 FROM responsibility_shadow_expectations x
    WHERE x.id=NEW.expectation_id AND x.product_id=NEW.product_id
      AND x.expected_event_type LIKE 'development_verified:%'
  ) AND NOT EXISTS (
    SELECT 1 FROM signal_events e
    WHERE NEW.observation_ref='signal_event:' || e.id
      AND e.product_id=NEW.product_id AND e.source='development_verification'
  );
END;
