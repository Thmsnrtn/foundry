-- =============================================================================
-- THE CHANNEL WE SAID WE WOULD WATCH.
--
-- `beginResponsibilityShadowing` writes a transition whose reason reads: "A
-- current independent observation channel can test a bounded expectation." That
-- sentence is the whole justification for entering Shadowing. The rule it
-- states is enforced three times over, and each of the three keys on the SHAPE
-- OF THE EXPECTATION rather than on the channel:
--
--   migration 119   trigger matching `expected_event_type LIKE
--                   'development_verified:%'`, hardcoding
--                   source='development_verification'
--   migration 127   trigger matching `expected_event_type LIKE
--                   'external_metric:%'`, hardcoding
--                   source='external_metric_ingest'
--   both callers    each filters its own observation query by that source
--
-- `beginResponsibilityShadowing` accepts ANY `expectedEventType`. So a third
-- kind of shadowing is created with a reason in the transition log saying an
-- independent channel makes it legitimate, and NO guard at all — not a weaker
-- one, none, because neither trigger's LIKE would match. Silently.
--
-- A NOTE ON HOW THIS WAS NEARLY GOT WRONG, because it changes what the fix is.
-- The obvious general rule is "the observation must come from the same source
-- as the signal in `observation_source_evidence_ref`". That column does not
-- mean one thing. In external shadowing it holds a signal FROM the ingest
-- channel (source='external_metric_ingest'). In development shadowing it holds
-- a `repository` signal recording the NEED — the verification has not happened
-- yet, so there is no signal from the observing channel to point at. A trigger
-- built on source equality refused every development comparison, which is how
-- this was found: the suite said so.
--
-- So the channel is named DIRECTLY. `observation_source_kind` is the
-- `signal_events.source` that may resolve this expectation, stated by the
-- caller when the expectation is created — exactly what the two triggers
-- hardcode, moved to where a third caller cannot avoid supplying it. Existing
-- rows are backfilled from the same two prefixes those triggers match, so the
-- backfill is not a guess: it is the rule already in force, written down.
--
-- The two prefix-keyed triggers stay. 127 also carries the
-- predates-the-expectation check, and a proven guard is not worth reworking to
-- be tidy. This is the floor beneath them.
-- =============================================================================

ALTER TABLE responsibility_shadow_expectations ADD COLUMN observation_source_kind TEXT;

UPDATE responsibility_shadow_expectations
   SET observation_source_kind = 'development_verification'
 WHERE expected_event_type LIKE 'development_verified:%';

UPDATE responsibility_shadow_expectations
   SET observation_source_kind = 'external_metric_ingest'
 WHERE expected_event_type LIKE 'external_metric:%';

-- Every NEW expectation must name its channel. NOT NULL cannot be added to an
-- existing column without rebuilding the table, and a rebuild here would be a
-- larger risk than the guard is worth; a trigger refuses the same thing and
-- says why in words the caller can act on.
CREATE TRIGGER shadow_expectation_names_its_channel
BEFORE INSERT ON responsibility_shadow_expectations
WHEN NEW.observation_source_kind IS NULL OR trim(NEW.observation_source_kind)=''
BEGIN
  SELECT RAISE(ABORT,'shadowing:expectation_names_no_observation_channel');
END;

-- And the observation must come from it. Whatever kind of expectation this is.
CREATE TRIGGER shadow_observation_matches_nominated_channel
BEFORE INSERT ON responsibility_shadow_comparisons
BEGIN
  SELECT RAISE(ABORT,'shadowing:observation_channel_not_the_nominated_one') WHERE EXISTS (
    SELECT 1 FROM responsibility_shadow_expectations x
     WHERE x.id=NEW.expectation_id AND x.product_id=NEW.product_id
       AND x.observation_source_kind IS NOT NULL
  ) AND NOT EXISTS (
    SELECT 1
      FROM responsibility_shadow_expectations x
      JOIN signal_events observed
        ON NEW.observation_ref='signal_event:' || observed.id
       AND observed.product_id=NEW.product_id
     WHERE x.id=NEW.expectation_id
       AND x.product_id=NEW.product_id
       AND observed.source=x.observation_source_kind
  );
END;
