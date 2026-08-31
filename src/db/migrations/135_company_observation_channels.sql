-- Migration 135: company-defined observation channels.
--
-- THE DEFECT THIS CLOSES. Independent observation — the evidence that lets a
-- responsibility enter Shadowing — was admissible only for twelve hard-coded
-- fields: new_mrr_cents, activation_rate, day_30_retention, churn_rate,
-- signups_7d, nps_score and friends. Those are SaaS metrics, and worse, each is
-- a physical COLUMN in `metric_snapshots`, so observing anything else required
-- a schema migration.
--
-- The consequence was structural, not cosmetic. A marina, a dance school, an
-- agency or a bakery can be Visible (a founder can report an obligation) and
-- Understood (a founder can supply facts), and then the ladder DEAD-ENDS: no
-- reading it could ever produce is admissible, so Shadowing is unreachable and
-- Assisting can never be earned. "Boats serviced this week" is not a metric the
-- kernel was willing to hear.
--
-- That is a business-specific branch inside the constitution — the thing the
-- architecture is explicitly not allowed to contain. A new company type must
-- need an adapter, not a kernel change.
--
-- WHAT THIS ADDS. A company declares a quantity it actually tracks, in its own
-- words. The kernel treats it as an OPAQUE NAMED QUANTITY: it knows the channel
-- exists, that readings arrived, and whether the latest reading rose, fell, or
-- held. It does not know or care what the quantity means. Direction over time is
-- business-independent; "boats serviced" and "churn rate" are the same shape to
-- an institution that is only asking whether reality moved the way someone said
-- it would.
--
-- WHAT THIS DELIBERATELY DOES NOT ADD. No readings table. Readings are canonical
-- signal events already — that is where the existing metric path puts them, and
-- where Shadowing resolution reads them from. Adding a parallel store would be a
-- second truth for one fact. Only the DECLARATION needs a table, because
-- admission has to be checkable by a guard before evidence is accepted, exactly
-- as `support_channels` gates inbound messages.
CREATE TABLE company_observation_channels (
  id                 TEXT PRIMARY KEY,
  product_id         TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  -- The kernel's identifier for the quantity. Company-defined, never parsed.
  channel_key        TEXT NOT NULL,
  -- The founder's own words for it, for founder-facing surfaces only.
  label              TEXT NOT NULL,
  -- Optional unit, again the founder's words: 'boats', 'classes', 'orders'.
  unit               TEXT,
  -- The canonical evidence that this company said it tracks this.
  evidence_signal_id TEXT NOT NULL,
  revoked_at         TEXT,
  created_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, channel_key)
);

CREATE INDEX idx_company_observation_channels
  ON company_observation_channels(product_id, revoked_at);

CREATE TRIGGER company_observation_channel_guard
BEFORE INSERT ON company_observation_channels
BEGIN
  -- Every predicate coalesces its absence. A guard whose condition evaluates to
  -- NULL never fires, which is how missing values have repeatedly walked past
  -- guards in this schema.

  -- The key becomes part of an event type and is matched against stored
  -- evidence, so its shape is bounded: lower-case, starts with a letter, and
  -- nothing that could be mistaken for structure or a path.
  SELECT RAISE(ABORT,'observation_channel:key_invalid')
  WHERE COALESCE(NEW.channel_key,'') NOT GLOB '[a-z][a-z0-9_]*'
     OR length(COALESCE(NEW.channel_key,'')) < 3
     OR length(COALESCE(NEW.channel_key,'')) > 40;

  -- A company channel may not shadow a built-in metric name. If it could, the
  -- same identifier would mean two different things depending on which source
  -- wrote it, and neither the founder nor the institution could tell which
  -- reality a reading described. Mirrors OBSERVABLE_FIELDS; a test asserts the
  -- two never drift apart.
  SELECT RAISE(ABORT,'observation_channel:reserved_key')
  WHERE COALESCE(NEW.channel_key,'') IN (
    'new_mrr_cents','expansion_mrr_cents','contraction_mrr_cents','churned_mrr_cents',
    'activation_rate','day_30_retention','churn_rate','mrr_health_ratio',
    'signups_7d','active_users','support_volume_7d','nps_score');

  SELECT RAISE(ABORT,'observation_channel:label_invalid')
  WHERE trim(COALESCE(NEW.label,''))=''
     OR length(COALESCE(NEW.label,'')) > 80
     OR length(COALESCE(NEW.unit,'')) > 24;

  -- Declaring a channel is a company assertion and must carry provenance. The
  -- evidence row must be this company's own — a channel justified by another
  -- tenant's signal would be an attribution leak in both directions.
  SELECT RAISE(ABORT,'observation_channel:evidence_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM signal_events e
    WHERE e.id=NEW.evidence_signal_id AND e.product_id=NEW.product_id);
END;

-- The key is the identity that past evidence was recorded against. Renaming it
-- would silently re-point every historical reading at a quantity nobody
-- measured, so the binding is immutable; revocation is the way to stop using a
-- channel, and it leaves the record of what was already observed intact.
CREATE TRIGGER company_observation_channel_immutable
BEFORE UPDATE ON company_observation_channels
WHEN COALESCE(OLD.channel_key,'') <> COALESCE(NEW.channel_key,'')
  OR COALESCE(OLD.product_id,'') <> COALESCE(NEW.product_id,'')
BEGIN
  SELECT RAISE(ABORT,'observation_channel:immutable');
END;

-- ─────────────────────────────────────────────────────────────────────────────
-- The other half of the same branch.
--
-- Migration 127's guard repeats the twelve SaaS field names in SQL, so the
-- DATABASE refused a company-defined observation no matter what any service
-- decided. Relaxing the service alone would have produced a system that admits
-- a boatyard's readings right up until the insert, which is worse than refusing
-- them honestly.
--
-- The vocabulary becomes: the built-in metrics, OR a quantity THIS company has
-- declared and not revoked. Everything else the guard enforced is untouched —
-- payload shape, numeric types, and the three directions arithmetic on two
-- numbers can support. Note the tenant binding in the subquery: one company's
-- declaration never admits another company's readings.
DROP TRIGGER IF EXISTS external_metric_observation_guard;

CREATE TRIGGER external_metric_observation_guard
BEFORE INSERT ON signal_events
WHEN NEW.source='external_metric_ingest'
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

  -- Reproduced verbatim from migration 127. Replacing a trigger means
  -- reproducing ALL of it: the first version of this migration recreated only
  -- the vocabulary checks, silently dropping the two guards below, and the
  -- independence tests caught it. Widening a vocabulary must not become a way
  -- to quietly narrow everything else the guard enforced.

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
