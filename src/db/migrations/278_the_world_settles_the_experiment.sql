-- =============================================================================
-- THE WORLD SETTLES THE EXPERIMENT, AND THE INSTITUTION KNOWS WHICH ONE
--
-- An experiment's prediction was sealed at approval and could be settled by
-- exactly one thing: the owner typing in what happened. That is a rehearsal of
-- the return leg, not the return leg. A real business outcome — a stranger
-- arriving, paying, receiving — comes from a provider, and until this migration
-- there was nowhere for it to land and nothing that could map it back to the
-- test it belongs to.
--
-- THREE THINGS, KEPT APART:
--
--   EXPOSURE      where an offer was actually placed for a given experiment,
--                 with the reference the provider will report against.
--   EVENT         what a provider said happened at that exposure. Kinds closed.
--                 No payer identity. Counterparty classified by control path.
--   SETTLEMENT    the rule sealed at approval for what counts, applied by a
--                 tick to the events, resolving the prediction by
--                 `business_outcome` — never by the owner's opinion, never by
--                 the model.
--
-- AND VALIDITY IS A SEPARATE AXIS FROM VERDICT. A checkout that never worked
-- did not test willingness to pay; a market that said no did. The first must
-- not be blamed on the market and the second must not be escaped by finding
-- an unrelated operational surprise. Only a MEASUREMENT-CRITICAL execution act
-- resolved 'surprised' can invalidate the market inference, and which acts are
-- critical is sealed at approval and immutable afterwards.
-- =============================================================================

-- ─── WHERE THE OFFER WAS PLACED ──────────────────────────────────────────────
CREATE TABLE experiment_exposures (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  experiment_id  TEXT NOT NULL REFERENCES venture_experiments(id),
  -- The asset the offer belongs to, once one exists. NULL only for exposures
  -- placed before the asset machinery existed — none, today.
  product_id     TEXT REFERENCES products(id),
  provider       TEXT NOT NULL,
  -- The reference the provider will report against: a listing id, a page
  -- path, a checkout link id. Opaque to the institution.
  exposure_ref   TEXT NOT NULL,
  evidence_mode  TEXT NOT NULL CHECK (evidence_mode IN ('real','sandbox','reference')),
  placed_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- The act that placed it, so the exposure walks back to an approval.
  placed_by      TEXT NOT NULL,
  withdrawn_at   TEXT
);
CREATE UNIQUE INDEX idx_experiment_exposure_one_live
  ON experiment_exposures(experiment_id) WHERE withdrawn_at IS NULL;
CREATE UNIQUE INDEX idx_experiment_exposure_ref
  ON experiment_exposures(provider, exposure_ref);

CREATE TRIGGER experiment_exposure_guard
BEFORE INSERT ON experiment_exposures
BEGIN
  SELECT RAISE(ABORT,'experiment_exposure:incomplete')
    WHERE trim(NEW.provider) = '' OR trim(NEW.exposure_ref) = ''
       OR trim(NEW.placed_by) = '';
  SELECT RAISE(ABORT,'experiment_exposure:cannot_arrive_withdrawn')
    WHERE NEW.withdrawn_at IS NOT NULL;
  -- ONLY AN APPROVED TEST HAS AN OFFER. An exposure for an experiment nobody
  -- approved is an offer nobody authorised.
  SELECT RAISE(ABORT,'experiment_exposure:experiment_not_approved')
    WHERE NOT EXISTS (SELECT 1 FROM venture_experiments
                       WHERE id = NEW.experiment_id AND decision = 'approved');
  -- THE WORLD OF THE EXPOSURE IS THE WORLD OF THE EXPERIMENT. A reference
  -- experiment may not be exposed for real; a real one may not be rehearsed
  -- into a reference exposure and read as the world.
  SELECT RAISE(ABORT,'experiment_exposure:world_mismatch')
    WHERE EXISTS (SELECT 1 FROM venture_experiments e
                   WHERE e.id = NEW.experiment_id
                     AND ((e.evidence_mode = 'reference') <> (NEW.evidence_mode = 'reference')));
  SELECT RAISE(ABORT,'experiment_exposure:asset_mismatch')
    WHERE NEW.product_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM products p
                       WHERE p.id = NEW.product_id AND p.from_experiment_id = NEW.experiment_id);
END;

-- ─── WHAT THE PROVIDER SAID HAPPENED ─────────────────────────────────────────
CREATE TABLE business_outcome_event_kinds (
  kind        TEXT PRIMARY KEY,
  what_it_is  TEXT NOT NULL,
  -- Whether this kind is money leaving a stranger's hands. The milestone
  -- predicate reads this rather than a list kept in code.
  is_payment  INTEGER NOT NULL DEFAULT 0,
  is_delivery INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL
);
INSERT INTO business_outcome_event_kinds (kind, what_it_is, is_payment, is_delivery, sort_order) VALUES
  ('arrival',          'somebody reached the offer',                                  0, 0, 1),
  ('offer_viewed',     'somebody saw the price',                                      0, 0, 2),
  ('checkout_started', 'somebody began to pay',                                       0, 0, 3),
  ('payment',          'somebody paid',                                               1, 0, 4),
  ('delivery',         'what they paid for reached them',                             0, 1, 5),
  ('delivery_failed',  'what they paid for did not reach them',                       0, 0, 6),
  ('refund',           'money went back',                                             0, 0, 7),
  ('dispute',          'somebody contested a charge',                                 0, 0, 8),
  ('complaint',        'somebody said the thing was wrong',                           0, 0, 9);
CREATE TRIGGER business_outcome_event_kinds_constitutional_insert
BEFORE INSERT ON business_outcome_event_kinds
BEGIN SELECT RAISE(ABORT,'business_outcome_event_kind:constitutional'); END;
CREATE TRIGGER business_outcome_event_kinds_constitutional_update
BEFORE UPDATE ON business_outcome_event_kinds
BEGIN SELECT RAISE(ABORT,'business_outcome_event_kind:constitutional'); END;
CREATE TRIGGER business_outcome_event_kinds_constitutional_delete
BEFORE DELETE ON business_outcome_event_kinds
BEGIN SELECT RAISE(ABORT,'business_outcome_event_kind:constitutional'); END;

CREATE TABLE business_outcome_events (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  exposure_id    TEXT NOT NULL REFERENCES experiment_exposures(id),
  kind           TEXT NOT NULL REFERENCES business_outcome_event_kinds(kind),
  amount_cents   INTEGER,
  currency       TEXT NOT NULL DEFAULT 'usd',
  -- THE SOURCE'S CLOCK, refused more than fifteen minutes ahead of ours (the
  -- migration 217 rule): a skew allowance, not a grace period.
  observed_at    TEXT NOT NULL,
  provider       TEXT NOT NULL,
  -- The provider's own id for the event. Dedup, and the receipt a reconciler
  -- would ask the other side about.
  provider_event_ref   TEXT NOT NULL,
  evidence_mode  TEXT NOT NULL CHECK (evidence_mode IN ('real','sandbox','reference')),
  -- WHO WAS ON THE OTHER SIDE, AS FAR AS THE CONTROL PATH CAN SAY. Never a
  -- name, never an email, never inferred by a model. 'unmatched_external' is
  -- exactly what it says: a real-mode provider supplied a payer reference that
  -- matched no owner, internal, reference, sandbox or test identity. It is not
  -- 'stranger'; the evidence cannot establish social independence and the
  -- column does not pretend to.
  counterparty   TEXT NOT NULL DEFAULT 'unknown' CHECK (counterparty IN
                   ('unmatched_external','owner','internal','reference','sandbox',
                    'test','known_invalid','unknown')),
  -- Where the arrival came from when the provider says: recorded, never
  -- inferred. Public distribution provenance strengthens independence.
  arrived_via    TEXT,
  recorded_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_business_outcome_provider_event_ref
  ON business_outcome_events(provider, provider_event_ref);
CREATE INDEX idx_business_outcome_exposure
  ON business_outcome_events(exposure_id, kind, observed_at);

CREATE TRIGGER business_outcome_event_guard
BEFORE INSERT ON business_outcome_events
BEGIN
  SELECT RAISE(ABORT,'business_outcome_event:incomplete')
    WHERE trim(NEW.provider) = '' OR trim(NEW.provider_event_ref) = '';
  SELECT RAISE(ABORT,'business_outcome_event:observed_in_the_future')
    WHERE datetime(NEW.observed_at) > datetime('now', '+15 minutes');
  SELECT RAISE(ABORT,'business_outcome_event:money_is_not_negative')
    WHERE NEW.amount_cents IS NOT NULL AND NEW.amount_cents < 0;
  SELECT RAISE(ABORT,'business_outcome_event:payment_needs_an_amount')
    WHERE NEW.kind = 'payment' AND NEW.amount_cents IS NULL;
  -- THE WORLD OF THE EVENT IS THE WORLD OF THE EXPOSURE.
  SELECT RAISE(ABORT,'business_outcome_event:world_mismatch')
    WHERE NOT EXISTS (SELECT 1 FROM experiment_exposures x
                       WHERE x.id = NEW.exposure_id AND x.evidence_mode = NEW.evidence_mode);
  -- COUNTERPARTY IS FORCED BY MODE. A rehearsal can never carry an external
  -- counterparty, and a sandbox cannot either.
  SELECT RAISE(ABORT,'business_outcome_event:reference_counterparty')
    WHERE NEW.evidence_mode = 'reference' AND NEW.counterparty <> 'reference';
  SELECT RAISE(ABORT,'business_outcome_event:sandbox_counterparty')
    WHERE NEW.evidence_mode = 'sandbox' AND NEW.counterparty <> 'sandbox';
  SELECT RAISE(ABORT,'business_outcome_event:real_cannot_be_reference')
    WHERE NEW.evidence_mode = 'real' AND NEW.counterparty IN ('reference','sandbox');
END;
-- A LEDGER OF WHAT THE WORLD DID IS NEVER REWRITTEN. Append-only means history
-- is not edited; it does not mean a person's data outlives their right to have
-- it removed, so deletion is left to the erasure path and refused nowhere else
-- in code that has a reason to keep a row.
CREATE TRIGGER business_outcome_event_immutable
BEFORE UPDATE ON business_outcome_events
BEGIN SELECT RAISE(ABORT,'business_outcome_event:immutable'); END;

-- ─── WHO THE OWNER IS, TO THE PROVIDER, WITHOUT SAYING WHO HE IS ─────────────
-- Keyed hashes of identifiers the owner registers as his own or internal:
-- a provider-side customer id, or an HMAC of an email under the server key.
-- The raw identifier is never stored. A provider event whose payer reference
-- matches a row here is 'owner' or 'internal'; one that matches nothing, from
-- a real-mode provider that supplied a reference at all, is 'unmatched_external'.
CREATE TABLE internal_counterparties (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  provider       TEXT NOT NULL,
  -- 'owner' or 'internal' (household, collaborator, own test account).
  relation       TEXT NOT NULL CHECK (relation IN ('owner','internal','test')),
  -- HMAC-SHA256 of the identifier under the server key, hex. Never the value.
  reference_hmac TEXT NOT NULL,
  registered_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  registered_by  TEXT NOT NULL,
  retired_at     TEXT
);
CREATE UNIQUE INDEX idx_internal_counterparty
  ON internal_counterparties(founder_id, provider, reference_hmac) WHERE retired_at IS NULL;
CREATE TRIGGER internal_counterparty_guard
BEFORE INSERT ON internal_counterparties
BEGIN
  SELECT RAISE(ABORT,'internal_counterparty:incomplete')
    WHERE trim(NEW.provider) = '' OR trim(NEW.registered_by) = ''
       OR length(NEW.reference_hmac) <> 64;
  -- ONLY A PERSON REGISTERS WHO IS INTERNAL. An institution that could declare
  -- a counterparty internal could also declare one external.
  SELECT RAISE(ABORT,'internal_counterparty:owner_only')
    WHERE NEW.registered_by NOT LIKE 'founder:%';
END;

-- ─── THE RULE SEALED WITH THE PREDICTION ─────────────────────────────────────
-- JSON: {"event":"payment","at_least":1,"out_of":"arrival","at_most":30,"within_days":14}
-- Written at proposal, sealed at approval with the rest of the prediction.
ALTER TABLE venture_experiments ADD COLUMN settles_when TEXT;

-- ─── VALIDITY IS NOT VERDICT ─────────────────────────────────────────────────
CREATE TABLE experiment_invalidity_kinds (
  kind        TEXT PRIMARY KEY,
  what_it_is  TEXT NOT NULL,
  sort_order  INTEGER NOT NULL
);
INSERT INTO experiment_invalidity_kinds (kind, what_it_is, sort_order) VALUES
  ('offer_not_published',            'the offer never appeared where people could see it', 1),
  ('checkout_broken',                'somebody tried to pay and could not',                 2),
  ('analytics_absent',               'nothing counted who arrived',                          3),
  ('delivery_failed_before_exposure','the thing failed before anybody could reach it',      4),
  ('provider_outage',                'the provider was down for the window',                5),
  ('instrumentation_defect',         'the measurement itself was wrong',                    6),
  ('wrong_audience_by_error',        'the offer reached people it was not for, by our mistake', 7);
CREATE TRIGGER experiment_invalidity_kinds_constitutional_insert
BEFORE INSERT ON experiment_invalidity_kinds
BEGIN SELECT RAISE(ABORT,'experiment_invalidity_kind:constitutional'); END;
CREATE TRIGGER experiment_invalidity_kinds_constitutional_update
BEFORE UPDATE ON experiment_invalidity_kinds
BEGIN SELECT RAISE(ABORT,'experiment_invalidity_kind:constitutional'); END;
CREATE TRIGGER experiment_invalidity_kinds_constitutional_delete
BEFORE DELETE ON experiment_invalidity_kinds
BEGIN SELECT RAISE(ABORT,'experiment_invalidity_kind:constitutional'); END;

ALTER TABLE venture_experiments ADD COLUMN validity TEXT NOT NULL DEFAULT 'valid'
  CHECK (validity IN ('valid','invalid'));
ALTER TABLE venture_experiments ADD COLUMN invalid_because TEXT
  REFERENCES experiment_invalidity_kinds(kind);
ALTER TABLE venture_experiments ADD COLUMN invalidated_by TEXT;
ALTER TABLE venture_experiments ADD COLUMN invalidated_at TEXT;
ALTER TABLE venture_experiments ADD COLUMN rerun_of TEXT REFERENCES venture_experiments(id);

-- ─── EXECUTION ACTS BELONG TO THEIR EXPERIMENT, AND SAY WHETHER THEY MATTER ──
ALTER TABLE proposed_acts ADD COLUMN experiment_id TEXT REFERENCES venture_experiments(id);
-- Declared when the plan is sealed. 1 = a failure here destroys the intended
-- measurement (the checkout of a willingness-to-pay test); 0 = a capability
-- prediction that settles on its own and touches the market claim not at all.
ALTER TABLE proposed_acts ADD COLUMN measurement_critical INTEGER;

-- (the triggers below enforce the rules named above)

-- ─── VALIDITY TRANSITIONS ────────────────────────────────────────────────────
-- Invalid is a terminal state that says the test did not measure what it was
-- for. It needs its kind, who said so and when; a valid experiment carries
-- none of those; and nothing goes back from invalid to valid — a re-run is a
-- new experiment that names this one.
CREATE TRIGGER venture_experiment_validity
BEFORE UPDATE OF validity, invalid_because, invalidated_by, invalidated_at ON venture_experiments
BEGIN
  SELECT RAISE(ABORT,'venture_experiment:invalid_needs_kind_witness_and_time')
    WHERE NEW.validity = 'invalid'
      AND (NEW.invalid_because IS NULL OR trim(coalesce(NEW.invalidated_by,'')) = ''
           OR NEW.invalidated_at IS NULL);
  SELECT RAISE(ABORT,'venture_experiment:valid_carries_no_invalidity')
    WHERE NEW.validity = 'valid'
      AND (NEW.invalid_because IS NOT NULL OR NEW.invalidated_by IS NOT NULL
           OR NEW.invalidated_at IS NOT NULL);
  SELECT RAISE(ABORT,'venture_experiment:invalid_is_final')
    WHERE OLD.validity = 'invalid' AND (NEW.validity <> 'invalid'
       OR NEW.invalid_because IS NOT OLD.invalid_because
       OR NEW.invalidated_by IS NOT OLD.invalidated_by
       OR NEW.invalidated_at IS NOT OLD.invalidated_at);
  -- ONLY AN APPROVED, UNSETTLED TEST CAN BE INVALID. Before approval there is
  -- nothing to invalidate; after a verdict the market has spoken and the
  -- verdict cannot be escaped by finding the measurement wanting afterwards.
  SELECT RAISE(ABORT,'venture_experiment:invalidity_needs_an_approved_unsettled_test')
    WHERE NEW.validity = 'invalid' AND OLD.validity = 'valid'
      AND (coalesce(OLD.decision,'') <> 'approved' OR OLD.verdict IS NOT NULL);
END;
-- A VERDICT AND INVALIDITY CANNOT BOTH BE TRUE. An invalid test has no market
-- verdict; the two columns are exclusive at the row.
CREATE TRIGGER venture_experiment_verdict_needs_validity
BEFORE UPDATE OF ran_at, verdict ON venture_experiments
BEGIN
  SELECT RAISE(ABORT,'venture_experiment:invalid_test_has_no_verdict')
    WHERE OLD.validity = 'invalid' AND (NEW.verdict IS NOT NULL OR NEW.ran_at IS NOT NULL);
END;

-- ─── THE SETTLEMENT RULE IS SEALED WITH THE PREDICTION ───────────────────────
CREATE TRIGGER venture_experiment_settlement_sealed
BEFORE UPDATE OF settles_when ON venture_experiments
BEGIN
  SELECT RAISE(ABORT,'venture_experiment:settlement_rule_is_sealed')
    WHERE OLD.decision IS NOT NULL AND NEW.settles_when IS NOT OLD.settles_when;
END;
-- A RE-RUN NAMES WHAT IT RE-RUNS, AND SAYS IT FROM BIRTH.
CREATE TRIGGER venture_experiment_rerun_immutable
BEFORE UPDATE OF rerun_of ON venture_experiments
BEGIN
  SELECT RAISE(ABORT,'venture_experiment:rerun_of_is_immutable')
    WHERE NEW.rerun_of IS NOT OLD.rerun_of;
END;
-- A RE-RUN AFTER A VALID CONTRADICTION NEEDS A REVISED CLAIM. The market said
-- no and the measurement was sound: running the same test again is hoping the
-- world changes its mind. Re-running an INVALID test needs nothing, because
-- the world was never asked.
CREATE TRIGGER venture_experiment_rerun_guard
BEFORE INSERT ON venture_experiments
WHEN NEW.rerun_of IS NOT NULL
BEGIN
  SELECT RAISE(ABORT,'venture_experiment:rerun_of_unknown')
    WHERE NOT EXISTS (SELECT 1 FROM venture_experiments WHERE id = NEW.rerun_of);
  SELECT RAISE(ABORT,'venture_experiment:rerun_must_be_of_the_same_candidate')
    WHERE NOT EXISTS (SELECT 1 FROM venture_experiments o
                       WHERE o.id = NEW.rerun_of AND o.opportunity_id = NEW.opportunity_id
                         AND o.evidence_mode = NEW.evidence_mode);
  SELECT RAISE(ABORT,'venture_experiment:rerun_of_an_unfinished_test')
    WHERE EXISTS (SELECT 1 FROM venture_experiments o
                   WHERE o.id = NEW.rerun_of AND o.validity = 'valid' AND o.ran_at IS NULL);
  SELECT RAISE(ABORT,'venture_experiment:rerun_needs_a_revised_claim')
    WHERE EXISTS (SELECT 1 FROM venture_experiments o
                   WHERE o.id = NEW.rerun_of AND o.validity = 'valid' AND o.verdict = 'surprised'
                     AND o.claim_id IS NOT NULL
                     AND NOT EXISTS (SELECT 1 FROM market_claims c
                                      WHERE c.id = o.claim_id AND c.revised_at IS NOT NULL
                                        AND datetime(c.revised_at) > datetime(o.ran_at)));
END;

-- ─── AN ACT'S PLACE IN ITS EXPERIMENT IS FIXED ONCE THE TEST IS DECIDED ──────
-- Which acts are measurement-critical is part of what the owner approved.
-- Declaring one critical after a failure to escape a verdict, or declaring one
-- non-critical after a failure to keep one, is the same move from two sides.
CREATE TRIGGER proposed_act_experiment_binding_sealed
BEFORE UPDATE OF experiment_id, measurement_critical ON proposed_acts
BEGIN
  SELECT RAISE(ABORT,'proposed_act:experiment_binding_is_sealed')
    WHERE OLD.experiment_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM venture_experiments e
                   WHERE e.id = OLD.experiment_id AND e.decision IS NOT NULL)
      AND (NEW.experiment_id IS NOT OLD.experiment_id
        OR NEW.measurement_critical IS NOT OLD.measurement_critical);
  SELECT RAISE(ABORT,'proposed_act:experiment_id_is_immutable')
    WHERE OLD.experiment_id IS NOT NULL AND NEW.experiment_id IS NOT OLD.experiment_id;
  SELECT RAISE(ABORT,'proposed_act:criticality_needs_an_experiment')
    WHERE NEW.measurement_critical IS NOT NULL AND NEW.experiment_id IS NULL;
END;
CREATE TRIGGER proposed_act_experiment_binding_guard
BEFORE INSERT ON proposed_acts
BEGIN
  SELECT RAISE(ABORT,'proposed_act:criticality_needs_an_experiment')
    WHERE NEW.measurement_critical IS NOT NULL AND NEW.experiment_id IS NULL;
  SELECT RAISE(ABORT,'proposed_act:experiment_binding_needs_criticality')
    WHERE NEW.experiment_id IS NOT NULL AND NEW.measurement_critical IS NULL;
  -- The act belongs to the asset the experiment made, or to nothing yet.
  SELECT RAISE(ABORT,'proposed_act:experiment_asset_mismatch')
    WHERE NEW.experiment_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM products p WHERE p.id = NEW.product_id AND p.from_experiment_id IS NOT NULL
                   AND p.from_experiment_id <> NEW.experiment_id);
END;
CREATE INDEX idx_proposed_act_experiment ON proposed_acts(experiment_id) WHERE experiment_id IS NOT NULL;
CREATE INDEX idx_venture_experiment_rerun ON venture_experiments(rerun_of) WHERE rerun_of IS NOT NULL;
