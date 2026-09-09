-- =============================================================================
-- THE DELIBERATION IS RECORDED BEFORE THE ANSWER
--
-- `services/founder/why.ts` has carried this sentence for months:
--
--   "A page whose whole purpose is showing its work may not manufacture a
--    thought process after the fact. The honest names are what the claim rests
--    on, what else is genuinely recorded, and what is still unknown — and a
--    later deliberation trace can persist the real thing prospectively, at
--    judgement time, where it would actually be evidence."
--
-- `otherRecordedPaths` has been an empty array for every experiment since,
-- because nothing wrote it. This is that trace. It is the one piece of new
-- ontology the quiet-estate direction earns, and it is earned by a defect the
-- codebase had already named.
--
-- WHAT IT IS. Before the owner decides, the institution records the thinking a
-- competent person would want to see: which uncertainty this test is for and
-- why that one, what else the same observation could mean, which exchange was
-- chosen and what it confounds, what the test can and cannot prove, what it
-- truly costs across the dimensions that are not cash, what would stop it
-- early, and what it recommends. Sealed with the prediction at approval, for
-- the same reason the prediction is: a deliberation that could be edited
-- afterwards is a story, not evidence.
--
-- WHAT IT IS NOT. Not a score. There is no weight, no confidence number and no
-- expected value anywhere in it. The direction that asked for this said
-- plainly that a numeric estimate becomes reality merely by being numeric; the
-- levels here are words, and every one of them carries its grounds.
--
-- Four constitutional vocabularies come with it — the exchanges an experiment
-- can offer, the dimensions a probe costs, the reasons it stops early, and the
-- relationships a participant can ask for. They are vocabularies rather than
-- free text for the same reason `business_outcome_event_kinds` is: an
-- institution that can invent a new kind of evidence at will cannot be
-- disagreed with.
-- =============================================================================

-- ─── The exchanges an experiment can offer ───────────────────────────────────
-- The exchange is an instrument, not a formality: it decides what reality is
-- able to say. An upfront price asks a stranger to trust before they can
-- judge, so a null result carries at least ten readings; delivering first and
-- letting them say what it was worth separates whether the thing helped from
-- whether they will pay in advance, and pays for that with free-riding.
-- Each row says what it reveals AND what it confounds, so choosing one is a
-- choice with a stated cost.
CREATE TABLE probe_exchanges (
  exchange         TEXT PRIMARY KEY,
  what_it_is       TEXT NOT NULL,
  reveals          TEXT NOT NULL,
  confounds        TEXT NOT NULL,
  -- The outcome kind that constitutes capture evidence under this exchange.
  capture_evidence TEXT REFERENCES business_outcome_event_kinds(kind),
  -- Whether the institution can actually execute it today. A design may name
  -- an exchange Foundry cannot yet run; the readiness check refuses the launch
  -- and says so, rather than the design quietly becoming something else.
  available        INTEGER NOT NULL DEFAULT 0,
  sort_order       INTEGER NOT NULL
);

INSERT INTO probe_exchanges (exchange, what_it_is, reveals, confounds, capture_evidence, available, sort_order) VALUES
  ('upfront_price', 'a fixed price paid before anything is received',
   'whether somebody will hand over money on the strength of a description alone',
   'trust in an unknown sender, the price itself, and the value of the thing are all one observation; a null result cannot say which',
   'payment', 1, 1),
  ('value_first', 'the thing is delivered first; afterwards they may pay what they judge it was worth, including nothing',
   'whether the thing actually helped, and what somebody who has experienced it will pay unprompted',
   'a voluntary payment after the fact is not the same evidence as a price paid in advance, and nothing paid may be free-riding rather than no value',
   'payment', 0, 2),
  ('sample_then_paid', 'a part is given away; the rest is bought',
   'whether the sample creates enough appetite to pay for depth',
   'the sample and the whole may not be the same product, and the split itself can create or destroy the appetite',
   'payment', 0, 3),
  ('deposit_then_valuation', 'a small amount upfront, then a valuation after use',
   'that the participant is real and willing, before it asks what the thing was worth',
   'the deposit anchors the later valuation',
   'payment', 0, 4),
  ('subscription', 'a recurring charge for continued access',
   'whether the value repeats often enough to be worth a standing commitment',
   'the first period is a trial decision; renewal is the real observation, and it arrives late',
   'payment', 0, 5),
  ('usage', 'payment per use',
   'how often the thing is actually worth reaching for',
   'a low unit price can be paid without the thing mattering',
   'payment', 0, 6),
  ('license', 'payment for the right to use or redistribute',
   'whether the underlying asset has value to somebody who will build on it',
   'a licence buyer is not an end user, and their reasons may not generalise',
   'payment', 0, 7),
  ('free_with_role', 'no charge, with an explicit downstream economic role',
   'whether anybody wants the thing at all, and whether the downstream role works',
   'free use says nothing about willingness to pay for anything',
   NULL, 0, 8);

CREATE TRIGGER probe_exchanges_constitutional_insert BEFORE INSERT ON probe_exchanges
BEGIN SELECT RAISE(ABORT,'probe_exchange:constitutional'); END;
CREATE TRIGGER probe_exchanges_constitutional_delete BEFORE DELETE ON probe_exchanges
BEGIN SELECT RAISE(ABORT,'probe_exchange:constitutional'); END;
-- Availability is the one thing that changes, and only as the institution
-- genuinely gains the ability to run an exchange. Everything else is fixed.
CREATE TRIGGER probe_exchanges_constitutional_update BEFORE UPDATE ON probe_exchanges
BEGIN
  SELECT RAISE(ABORT,'probe_exchange:constitutional') WHERE
    NEW.exchange IS NOT OLD.exchange OR NEW.what_it_is IS NOT OLD.what_it_is
    OR NEW.reveals IS NOT OLD.reveals OR NEW.confounds IS NOT OLD.confounds
    OR NEW.capture_evidence IS NOT OLD.capture_evidence OR NEW.sort_order IS NOT OLD.sort_order;
END;

-- ─── What a probe truly costs ────────────────────────────────────────────────
-- Cash is one dimension and usually not the largest. The first real experiment
-- was modelled at twenty-nine dollars and a hundred-dollar ceiling, and spent
-- hours of the one input that does not scale.
CREATE TABLE probe_cost_dimensions (
  dimension   TEXT PRIMARY KEY,
  what_it_is  TEXT NOT NULL,
  sort_order  INTEGER NOT NULL
);
INSERT INTO probe_cost_dimensions (dimension, what_it_is, sort_order) VALUES
  ('cash',              'money that leaves, and money at risk of leaving', 1),
  ('owner_attention',   'the owner''s own time, which does not scale and does not come back', 2),
  ('participant_burden','the time, attention and risk asked of the people it reaches', 3),
  ('reputation',        'the shared public standing every later experiment inherits', 4),
  ('legal_uncertainty', 'exposure whose size is not yet known', 5),
  ('support_burden',    'what somebody must answer, fix or explain afterwards', 6),
  ('infrastructure',    'accounts, domains, providers and configuration that must then be kept', 7),
  ('obligation',        'what is owed to somebody after it ends', 8),
  ('complexity',        'institutional surface that every later change must carry', 9),
  ('opportunity_cost',  'what the same attention and reputation could have bought instead', 10);
CREATE TRIGGER probe_cost_dimensions_constitutional_insert BEFORE INSERT ON probe_cost_dimensions
BEGIN SELECT RAISE(ABORT,'probe_cost_dimension:constitutional'); END;
CREATE TRIGGER probe_cost_dimensions_constitutional_update BEFORE UPDATE ON probe_cost_dimensions
BEGIN SELECT RAISE(ABORT,'probe_cost_dimension:constitutional'); END;
CREATE TRIGGER probe_cost_dimensions_constitutional_delete BEFORE DELETE ON probe_cost_dimensions
BEGIN SELECT RAISE(ABORT,'probe_cost_dimension:constitutional'); END;

-- ─── Why a probe stops before its budget is spent ────────────────────────────
-- A budget is a ceiling, not a target. Once the decision is clear, further
-- exposure buys nothing and costs reputation and other people's attention.
CREATE TABLE probe_stop_kinds (
  kind        TEXT PRIMARY KEY,
  what_it_is  TEXT NOT NULL,
  counts      TEXT NOT NULL,
  -- WHAT ONE OF THEM IS CALLED, so a threshold can be read as a sentence.
  -- "It stops at 1 complaint" is a thing the owner can hold in mind; "it stops
  -- at 1 people said the thing was wrong" is a database row with a number on
  -- it, and a summary written out of those is not a summary.
  counted_one  TEXT NOT NULL,
  counted_many TEXT NOT NULL,
  sort_order  INTEGER NOT NULL
);
INSERT INTO probe_stop_kinds (kind, what_it_is, counts, counted_one, counted_many, sort_order) VALUES
  ('complaints',     'people said the thing was wrong', 'complaint outcome events',
   'complaint', 'complaints', 1),
  ('bounces',        'messages did not arrive', 'offers whose delivery the provider reported as failed',
   'message that did not arrive', 'messages that did not arrive', 2),
  ('opt_outs',       'people asked not to be contacted', 'Workshop suppressions recorded from this experiment',
   'person asking not to be contacted', 'people asking not to be contacted', 3),
  ('declined_value', 'people who received it said it was not useful', 'declined_value outcome events',
   'person saying it was not useful', 'people saying it was not useful', 4),
  ('unfulfillable',  'more was bought than can be delivered well', 'purchases owed and not yet delivered',
   'purchase that could not be delivered', 'purchases that could not be delivered', 5);
CREATE TRIGGER probe_stop_kinds_constitutional_insert BEFORE INSERT ON probe_stop_kinds
BEGIN SELECT RAISE(ABORT,'probe_stop_kind:constitutional'); END;
CREATE TRIGGER probe_stop_kinds_constitutional_update BEFORE UPDATE ON probe_stop_kinds
BEGIN SELECT RAISE(ABORT,'probe_stop_kind:constitutional'); END;
CREATE TRIGGER probe_stop_kinds_constitutional_delete BEFORE DELETE ON probe_stop_kinds
BEGIN SELECT RAISE(ABORT,'probe_stop_kind:constitutional'); END;

-- ─── What a participant may ask for ──────────────────────────────────────────
-- An opt-out is one answer among several, and the only one the institution
-- could previously hear. Consent has scope: somebody who asks for one kind of
-- thing has not agreed to everything the Workshop will ever run.
CREATE TABLE continuation_kinds (
  kind         TEXT PRIMARY KEY,
  what_it_is   TEXT NOT NULL,
  -- Whether this answer permits any further contact at all.
  permits_more INTEGER NOT NULL,
  sort_order   INTEGER NOT NULL
);
INSERT INTO continuation_kinds (kind, what_it_is, permits_more, sort_order) VALUES
  ('never',              'do not contact me again', 0, 1),
  ('nothing',            'nothing further, but no objection to having been asked', 0, 2),
  ('more_like_this',     'send me more of this kind of thing', 1, 3),
  ('only_unusual',       'only tell me when something unusually relevant appears', 1, 4),
  ('would_pay_regularly','I would pay for this on an ongoing basis', 1, 5),
  ('will_explain',       'I will tell you what would make this more useful', 1, 6);
CREATE TRIGGER continuation_kinds_constitutional_insert BEFORE INSERT ON continuation_kinds
BEGIN SELECT RAISE(ABORT,'continuation_kind:constitutional'); END;
CREATE TRIGGER continuation_kinds_constitutional_update BEFORE UPDATE ON continuation_kinds
BEGIN SELECT RAISE(ABORT,'continuation_kind:constitutional'); END;
CREATE TRIGGER continuation_kinds_constitutional_delete BEFORE DELETE ON continuation_kinds
BEGIN SELECT RAISE(ABORT,'continuation_kind:constitutional'); END;

-- ─── The deliberation itself ─────────────────────────────────────────────────
CREATE TABLE probe_designs (
  experiment_id     TEXT PRIMARY KEY REFERENCES venture_experiments(id),
  founder_id        TEXT NOT NULL REFERENCES founders(id),
  -- THE UNCERTAINTY THIS TEST IS FOR, and why this one rather than another.
  -- "Does this idea work" is not an uncertainty; it is a mood.
  decides           TEXT NOT NULL,
  decides_because   TEXT NOT NULL,
  -- The instrument, and why it was chosen over the alternatives recorded below.
  exchange          TEXT NOT NULL REFERENCES probe_exchanges(exchange),
  exchange_because  TEXT NOT NULL,
  -- Stated before the result, so neither can be written to fit it.
  can_prove         TEXT NOT NULL,
  cannot_prove      TEXT NOT NULL,
  -- Doing nothing yet is always an alternative. Why is knowing this now worth
  -- more than waiting, observing, or spending the same attention elsewhere?
  rather_than_waiting TEXT NOT NULL,
  -- How cleanly it reaches reality: the acquisition path and what it costs.
  distribution      TEXT NOT NULL,
  -- What happens if it succeeds much faster than expected. Success is not
  -- permission to lose control of fulfilment, quality or obligations.
  if_it_succeeds    TEXT NOT NULL,
  -- The circuit breaker: purchases owed and undelivered beyond this stop the
  -- offer until the institution has caught up. NULL where nothing is sold.
  fulfilment_cap    INTEGER,
  recommendation    TEXT NOT NULL CHECK (recommendation IN ('run','reframe','defer','kill')),
  recommendation_because TEXT NOT NULL,
  designed_by       TEXT NOT NULL,
  designed_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Sealed when the owner decides, exactly as the prediction is.
  sealed_at         TEXT
);

CREATE TRIGGER probe_design_guard
BEFORE INSERT ON probe_designs
BEGIN
  SELECT RAISE(ABORT,'probe_design:incomplete')
    WHERE trim(NEW.decides) = '' OR trim(NEW.decides_because) = '' OR trim(NEW.exchange_because) = ''
       OR trim(NEW.can_prove) = '' OR trim(NEW.cannot_prove) = '' OR trim(NEW.rather_than_waiting) = ''
       OR trim(NEW.distribution) = '' OR trim(NEW.if_it_succeeds) = ''
       OR trim(NEW.recommendation_because) = '' OR trim(NEW.designed_by) = '';
  SELECT RAISE(ABORT,'probe_design:experiment_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM venture_experiments e WHERE e.id = NEW.experiment_id AND e.founder_id = NEW.founder_id);
  -- THE DELIBERATION COMES BEFORE THE DECISION. One written after the owner
  -- has already said yes is a justification, and the whole point of the row is
  -- that it is not one.
  SELECT RAISE(ABORT,'probe_design:after_the_decision') WHERE EXISTS (
    SELECT 1 FROM venture_experiments e WHERE e.id = NEW.experiment_id AND e.decision IS NOT NULL);
  SELECT RAISE(ABORT,'probe_design:cannot_arrive_sealed') WHERE NEW.sealed_at IS NOT NULL;
  SELECT RAISE(ABORT,'probe_design:cap_cannot_be_negative') WHERE NEW.fulfilment_cap IS NOT NULL AND NEW.fulfilment_cap < 1;
END;

CREATE TRIGGER probe_design_sealed
BEFORE UPDATE ON probe_designs
BEGIN
  SELECT RAISE(ABORT,'probe_design:immutable')
    WHERE NEW.experiment_id IS NOT OLD.experiment_id OR NEW.founder_id IS NOT OLD.founder_id
       OR NEW.designed_by IS NOT OLD.designed_by OR NEW.designed_at IS NOT OLD.designed_at;
  -- Once sealed, the thinking is what it was. A design that could be edited
  -- after exposure would let every outcome be narrated as the expected one.
  SELECT RAISE(ABORT,'probe_design:is_sealed')
    WHERE OLD.sealed_at IS NOT NULL
      AND (NEW.decides IS NOT OLD.decides OR NEW.decides_because IS NOT OLD.decides_because
        OR NEW.exchange IS NOT OLD.exchange OR NEW.exchange_because IS NOT OLD.exchange_because
        OR NEW.can_prove IS NOT OLD.can_prove OR NEW.cannot_prove IS NOT OLD.cannot_prove
        OR NEW.rather_than_waiting IS NOT OLD.rather_than_waiting
        OR NEW.distribution IS NOT OLD.distribution OR NEW.if_it_succeeds IS NOT OLD.if_it_succeeds
        OR NEW.fulfilment_cap IS NOT OLD.fulfilment_cap
        OR NEW.recommendation IS NOT OLD.recommendation
        OR NEW.recommendation_because IS NOT OLD.recommendation_because);
  SELECT RAISE(ABORT,'probe_design:unsealed_once_sealed')
    WHERE OLD.sealed_at IS NOT NULL AND NEW.sealed_at IS NULL;
END;

-- ─── What else the same observation could mean ───────────────────────────────
-- A null result has readings, and the design either separates them or it does
-- not. `distinguished_by` NULL is the honest admission that this test cannot
-- tell this reading apart from the others — which is what stops a silence
-- from being reported as "the market said no".
CREATE TABLE probe_interpretations (
  id              TEXT PRIMARY KEY,
  experiment_id   TEXT NOT NULL REFERENCES venture_experiments(id),
  founder_id      TEXT NOT NULL REFERENCES founders(id),
  observation     TEXT NOT NULL,
  reading         TEXT NOT NULL,
  distinguished_by TEXT,
  recorded_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_probe_interpretations ON probe_interpretations(experiment_id);
CREATE TRIGGER probe_interpretation_guard
BEFORE INSERT ON probe_interpretations
BEGIN
  SELECT RAISE(ABORT,'probe_interpretation:incomplete')
    WHERE trim(NEW.observation) = '' OR trim(NEW.reading) = '';
  SELECT RAISE(ABORT,'probe_interpretation:no_design') WHERE NOT EXISTS (
    SELECT 1 FROM probe_designs d WHERE d.experiment_id = NEW.experiment_id AND d.founder_id = NEW.founder_id);
  -- A SEALED DELIBERATION TAKES NOTHING NEW. Adding a reading, an alternative,
  -- a cost or a stop condition after the owner has decided is editing the
  -- thinking to fit the answer, which is the one thing this table exists to
  -- make impossible.
  SELECT RAISE(ABORT,'probe_interpretation:is_sealed') WHERE EXISTS (
    SELECT 1 FROM probe_designs d WHERE d.experiment_id = NEW.experiment_id AND d.sealed_at IS NOT NULL);
END;
CREATE TRIGGER probe_interpretation_sealed
BEFORE UPDATE ON probe_interpretations
BEGIN
  SELECT RAISE(ABORT,'probe_interpretation:is_sealed') WHERE EXISTS (
    SELECT 1 FROM probe_designs d WHERE d.experiment_id = OLD.experiment_id AND d.sealed_at IS NOT NULL);
END;

-- ─── The exchanges considered and not chosen ─────────────────────────────────
-- `why.ts` returns `otherRecordedPaths` empty for every experiment because
-- nothing has ever written what else was genuinely on the table. This is that.
CREATE TABLE probe_alternatives (
  id            TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES venture_experiments(id),
  founder_id    TEXT NOT NULL REFERENCES founders(id),
  exchange      TEXT NOT NULL REFERENCES probe_exchanges(exchange),
  not_chosen_because TEXT NOT NULL,
  recorded_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(experiment_id, exchange)
);
CREATE TRIGGER probe_alternative_guard
BEFORE INSERT ON probe_alternatives
BEGIN
  SELECT RAISE(ABORT,'probe_alternative:incomplete') WHERE trim(NEW.not_chosen_because) = '';
  SELECT RAISE(ABORT,'probe_alternative:no_design') WHERE NOT EXISTS (
    SELECT 1 FROM probe_designs d WHERE d.experiment_id = NEW.experiment_id AND d.founder_id = NEW.founder_id);
  -- The chosen exchange is not one of the alternatives.
  SELECT RAISE(ABORT,'probe_alternative:is_the_chosen_one') WHERE EXISTS (
    SELECT 1 FROM probe_designs d WHERE d.experiment_id = NEW.experiment_id AND d.exchange = NEW.exchange);
  -- A SEALED DELIBERATION TAKES NOTHING NEW. Adding a reading, an alternative,
  -- a cost or a stop condition after the owner has decided is editing the
  -- thinking to fit the answer, which is the one thing this table exists to
  -- make impossible.
  SELECT RAISE(ABORT,'probe_alternative:is_sealed') WHERE EXISTS (
    SELECT 1 FROM probe_designs d WHERE d.experiment_id = NEW.experiment_id AND d.sealed_at IS NOT NULL);
END;

-- ─── What it costs, across the dimensions that are not cash ──────────────────
CREATE TABLE probe_costs (
  id            TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES venture_experiments(id),
  founder_id    TEXT NOT NULL REFERENCES founders(id),
  dimension     TEXT NOT NULL REFERENCES probe_cost_dimensions(dimension),
  level         TEXT NOT NULL CHECK (level IN ('none','low','material','high')),
  grounds       TEXT NOT NULL,
  recorded_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(experiment_id, dimension)
);
CREATE TRIGGER probe_cost_guard
BEFORE INSERT ON probe_costs
BEGIN
  -- A LEVEL WITHOUT GROUNDS IS A NUMBER WITH A WORD ON IT.
  SELECT RAISE(ABORT,'probe_cost:grounds_required') WHERE trim(NEW.grounds) = '';
  SELECT RAISE(ABORT,'probe_cost:no_design') WHERE NOT EXISTS (
    SELECT 1 FROM probe_designs d WHERE d.experiment_id = NEW.experiment_id AND d.founder_id = NEW.founder_id);
  -- A SEALED DELIBERATION TAKES NOTHING NEW. Adding a reading, an alternative,
  -- a cost or a stop condition after the owner has decided is editing the
  -- thinking to fit the answer, which is the one thing this table exists to
  -- make impossible.
  SELECT RAISE(ABORT,'probe_cost:is_sealed') WHERE EXISTS (
    SELECT 1 FROM probe_designs d WHERE d.experiment_id = NEW.experiment_id AND d.sealed_at IS NOT NULL);
END;

-- ─── What stops it early ─────────────────────────────────────────────────────
CREATE TABLE probe_stop_conditions (
  id             TEXT PRIMARY KEY,
  experiment_id  TEXT NOT NULL REFERENCES venture_experiments(id),
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  kind           TEXT NOT NULL REFERENCES probe_stop_kinds(kind),
  threshold      INTEGER NOT NULL,
  because        TEXT NOT NULL,
  triggered_at   TEXT,
  triggered_detail TEXT,
  recorded_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(experiment_id, kind)
);
CREATE TRIGGER probe_stop_condition_guard
BEFORE INSERT ON probe_stop_conditions
BEGIN
  SELECT RAISE(ABORT,'probe_stop_condition:incomplete')
    WHERE trim(NEW.because) = '' OR NEW.threshold < 1;
  SELECT RAISE(ABORT,'probe_stop_condition:no_design') WHERE NOT EXISTS (
    SELECT 1 FROM probe_designs d WHERE d.experiment_id = NEW.experiment_id AND d.founder_id = NEW.founder_id);
  SELECT RAISE(ABORT,'probe_stop_condition:cannot_arrive_triggered') WHERE NEW.triggered_at IS NOT NULL;
  -- A SEALED DELIBERATION TAKES NOTHING NEW. Adding a reading, an alternative,
  -- a cost or a stop condition after the owner has decided is editing the
  -- thinking to fit the answer, which is the one thing this table exists to
  -- make impossible.
  SELECT RAISE(ABORT,'probe_stop_condition:is_sealed') WHERE EXISTS (
    SELECT 1 FROM probe_designs d WHERE d.experiment_id = NEW.experiment_id AND d.sealed_at IS NOT NULL);
END;
CREATE TRIGGER probe_stop_condition_triggered_once
BEFORE UPDATE ON probe_stop_conditions
BEGIN
  SELECT RAISE(ABORT,'probe_stop_condition:immutable')
    WHERE NEW.experiment_id IS NOT OLD.experiment_id OR NEW.kind IS NOT OLD.kind
       OR NEW.threshold IS NOT OLD.threshold OR NEW.because IS NOT OLD.because;
  SELECT RAISE(ABORT,'probe_stop_condition:triggered_once')
    WHERE OLD.triggered_at IS NOT NULL AND NEW.triggered_at IS NOT OLD.triggered_at;
  SELECT RAISE(ABORT,'probe_stop_condition:trigger_needs_detail')
    WHERE NEW.triggered_at IS NOT NULL AND trim(coalesce(NEW.triggered_detail,'')) = '';
END;

-- ─── What a participant asked for ────────────────────────────────────────────
CREATE TABLE workshop_continuations (
  id            TEXT PRIMARY KEY,
  founder_id    TEXT NOT NULL REFERENCES founders(id),
  email         TEXT NOT NULL,
  experiment_id TEXT REFERENCES venture_experiments(id),
  wants         TEXT NOT NULL REFERENCES continuation_kinds(kind),
  -- Their own words, when they left any. Never paraphrased into the kind.
  said          TEXT,
  recorded_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(founder_id, email, experiment_id)
);
CREATE INDEX idx_workshop_continuations ON workshop_continuations(founder_id, email);
CREATE TRIGGER workshop_continuation_guard
BEFORE INSERT ON workshop_continuations
BEGIN
  SELECT RAISE(ABORT,'workshop_continuation:email_invalid')
    WHERE NEW.email NOT LIKE '%_@_%.__%' OR NEW.email <> lower(trim(NEW.email));
END;
-- What somebody asked for is what they asked for. A change of mind is a new
-- row for a new experiment, or an opt-out, not an edit of the old one.
CREATE TRIGGER workshop_continuation_append_only_update
BEFORE UPDATE ON workshop_continuations
BEGIN SELECT RAISE(ABORT,'workshop_continuation:append_only'); END;
CREATE TRIGGER workshop_continuation_append_only_delete
BEFORE DELETE ON workshop_continuations
BEGIN
  SELECT RAISE(ABORT,'workshop_continuation:append_only') WHERE NOT EXISTS (
    SELECT 1 FROM products p WHERE p.owner_id = OLD.founder_id AND p.erasure_scheduled_at IS NOT NULL);
END;

-- ─── Commercial evidence keeps the exchange that produced it ─────────────────
-- "Paid twenty-nine dollars" is not one fact. Paid before receiving anything
-- and paid afterwards by somebody who had already read it are different
-- observations about willingness to pay, and the ledger could not tell them
-- apart. Nullable because every row written before this migration was written
-- under an exchange nobody recorded, and inventing one for them would be the
-- exact collapse this column exists to prevent.
ALTER TABLE business_outcome_events ADD COLUMN exchange TEXT REFERENCES probe_exchanges(exchange);

-- ─── Two observations the ladder could not hold ──────────────────────────────
-- The kinds ran from "somebody reached the offer" to "somebody contested a
-- charge". Between them sat two things a participant can volunteer that are
-- much stronger evidence than a bounce and were being recorded as nothing:
-- that they had it and it was not useful, and that they want more of it.
-- Neither is inferred. Both are stated by the person, on a page they chose to
-- open, with no tracking of any kind involved in seeing them.
DROP TRIGGER business_outcome_event_kinds_constitutional_insert;
INSERT INTO business_outcome_event_kinds (kind, what_it_is, is_payment, is_delivery, sort_order) VALUES
  ('declined_value',        'somebody who received it said it was not useful to them', 0, 0, 10),
  ('continuation_requested','somebody asked to keep hearing from it', 0, 0, 11);
CREATE TRIGGER business_outcome_event_kinds_constitutional_insert
BEFORE INSERT ON business_outcome_event_kinds
BEGIN SELECT RAISE(ABORT,'business_outcome_event_kind:constitutional'); END;
