-- =============================================================================
-- AN EXPERIMENT DECLARES ITS INSTRUMENT BEFORE IT ASKS THE WORLD.
--
-- Experiment 001 executed correctly and settled correctly. Twenty-one messages
-- were written, nineteen were delivered, the sealed rule counted confirmed
-- payments, there were none, and the rule said so on the day it said it would.
-- Every internal state was right. The reply path those nineteen messages
-- invited people to use was not routed.
--
-- The institution has learned this shape of lesson twice before, each time one
-- level further out:
--
--   `run-state.ts`  — "it ran without throwing" is not "it did what it was for"
--   `the-instrument.ts` — "it did what it was for" is not "the result means
--                          what it appears to mean"
--   and now         — none of that is "the path required to obtain or observe
--                      the outcome was working while the question was open"
--
-- FIVE LAYERS THAT MUST NOT COLLAPSE INTO ONE. The economic event; the outside
-- system it happens through; the instrument Foundry observes it with; the
-- record of that observation; and the interpretation drawn from the record.
-- An absence in the fourth is evidence about the first ONLY if the second and
-- third were working. This migration gives the third layer a name, per
-- experiment, so the question can be asked before, during and after rather
-- than discovered afterwards by a person.
--
-- WHAT IS DERIVED AND WHAT IS DECLARED. The paths an experiment depends on are
-- not a judgment made at launch: they follow from the rule it sealed with its
-- prediction (`settlement_event_paths` below) and from what its offer asks a
-- stranger to do. That derivation is written down here rather than kept in
-- code, in the same way `business_outcome_event_kinds.is_payment` is, so it
-- can be read, audited and not quietly re-decided by whoever edits a file.
-- =============================================================================

-- ─── The channels a public path can be observed on ───────────────────────────
-- Migration 327 fixed these five in a CHECK constraint. A sixth was needed
-- within the week — the path that carries a payment event to us — which is the
-- usual argument for a vocabulary table over a constraint: a list that grows
-- belongs where it can be read and extended, not where extending it means
-- rebuilding a table that holds records nobody may lose.
CREATE TABLE public_channel_kinds (
  channel     TEXT PRIMARY KEY,
  what_it_is  TEXT NOT NULL,
  sort_order  INTEGER NOT NULL
);
INSERT INTO public_channel_kinds (channel, what_it_is, sort_order) VALUES
  ('site',       'the public pages, served as they were published',            1),
  ('cloudflare', 'the provider that carries the domain, the pages and the post', 2),
  ('sending',    'the identity mail goes out as, authenticated at the provider', 3),
  ('replyInbox', 'the route an answer takes to reach the Workshop',            4),
  ('mail',       'the Workshop''s ears: whether a message handed in is kept',  5),
  ('payments',   'the route a payment, refund or dispute takes to reach us',   6);
CREATE TRIGGER public_channel_kinds_constitutional_insert
BEFORE INSERT ON public_channel_kinds
BEGIN SELECT RAISE(ABORT,'public_channel_kind:constitutional'); END;
CREATE TRIGGER public_channel_kinds_constitutional_update
BEFORE UPDATE ON public_channel_kinds
BEGIN SELECT RAISE(ABORT,'public_channel_kind:constitutional'); END;
CREATE TRIGGER public_channel_kinds_constitutional_delete
BEFORE DELETE ON public_channel_kinds
BEGIN SELECT RAISE(ABORT,'public_channel_kind:constitutional'); END;

-- ─── The day record, rebuilt to read its channels from that table ────────────
-- Every row is carried across: the days already recorded are the only evidence
-- there is about whether the Workshop's paths were working, and a migration
-- that loses them would be the same defect in a new form.
-- The canonical SQLite rebuild, in the order the table gates follow it:
-- CREATE the replacement, copy, DROP the original, RENAME into its place.
DROP TRIGGER public_channel_day_keeps_the_worst;

CREATE TABLE public_channel_days_new (
  founder_id   TEXT NOT NULL REFERENCES founders(id),
  channel      TEXT NOT NULL REFERENCES public_channel_kinds(channel),
  day          TEXT NOT NULL,
  -- THE WORST OF THE DAY, not the last. A path that was down for an hour could
  -- not carry a reply sent in that hour, and the last reading of the day would
  -- call that day healthy.
  worst_status TEXT NOT NULL CHECK (worst_status IN ('healthy','needs_attention','unknown')),
  detail       TEXT,
  -- How many readings the day got, so a day watched once is not read as a day
  -- that was watched.
  readings     INTEGER NOT NULL DEFAULT 1 CHECK (readings > 0),
  last_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (founder_id, channel, day)
);
INSERT INTO public_channel_days_new (founder_id, channel, day, worst_status, detail, readings, last_at)
  SELECT founder_id, channel, day, worst_status, detail, readings, last_at FROM public_channel_days;
DROP TABLE public_channel_days;
ALTER TABLE public_channel_days_new RENAME TO public_channel_days;
CREATE INDEX idx_public_channel_days ON public_channel_days(founder_id, channel, day);

-- A DAY DOES NOT GET BETTER AFTER THE FACT.
CREATE TRIGGER public_channel_day_keeps_the_worst
BEFORE UPDATE ON public_channel_days
BEGIN
  SELECT RAISE(ABORT,'public_channel_day:immutable') WHERE
    NEW.founder_id <> OLD.founder_id OR NEW.channel <> OLD.channel OR NEW.day <> OLD.day;
  SELECT RAISE(ABORT,'public_channel_day:a_day_does_not_get_better')
    WHERE OLD.worst_status = 'needs_attention' AND NEW.worst_status <> 'needs_attention';
  SELECT RAISE(ABORT,'public_channel_day:a_day_does_not_get_better')
    WHERE OLD.worst_status = 'unknown' AND NEW.worst_status = 'healthy';
  SELECT RAISE(ABORT,'public_channel_day:readings_only_rise') WHERE NEW.readings < OLD.readings;
END;

-- ─── The kinds of path an experiment can depend on ───────────────────────────
-- `observed_on` names the channel whose day record says whether the path was
-- working. Where it is null the path has no day record yet and the reader says
-- so rather than assuming it was well.
CREATE TABLE experiment_path_kinds (
  kind        TEXT PRIMARY KEY,
  what_it_is  TEXT NOT NULL,
  observed_on TEXT REFERENCES public_channel_kinds(channel),
  -- SOME PATHS DO NOT EXIST UNTIL THE OWNER APPROVES THE TEST, because
  -- approving it is what creates them: the act that mints the way to pay and
  -- the authority to give money back is the owner's Allow. A check before
  -- approval that asked for them would refuse every test for lacking the thing
  -- approval is for. They are checked where they matter instead — before
  -- anybody is written to, and every morning after.
  exists_after_approval INTEGER NOT NULL DEFAULT 0 CHECK (exists_after_approval IN (0,1)),
  sort_order  INTEGER NOT NULL
);
INSERT INTO experiment_path_kinds (kind, what_it_is, observed_on, exists_after_approval, sort_order) VALUES
  ('offer_page',  'the page that carries the offer, reachable and saying what it was published saying', 'site',       0, 1),
  ('sending',     'the way an offer reaches a person, and the receipt that says it did',                'sending',    0, 2),
  ('reply',       'the way a person answers, and whether the answer is kept',                           'replyInbox', 0, 3),
  ('payment',     'the way a person pays',                                                              NULL,         1, 4),
  ('payment_observation', 'the way a payment, refund or dispute becomes a fact Foundry knows',           'payments',   0, 5),
  ('fulfilment',  'the way what was paid for reaches the person who paid',                              'sending',    0, 6),
  ('refund',      'the way money goes back when it should',                                             NULL,         1, 7);
CREATE TRIGGER experiment_path_kinds_constitutional_insert
BEFORE INSERT ON experiment_path_kinds
BEGIN SELECT RAISE(ABORT,'experiment_path_kind:constitutional'); END;
CREATE TRIGGER experiment_path_kinds_constitutional_update
BEFORE UPDATE ON experiment_path_kinds
BEGIN SELECT RAISE(ABORT,'experiment_path_kind:constitutional'); END;
CREATE TRIGGER experiment_path_kinds_constitutional_delete
BEFORE DELETE ON experiment_path_kinds
BEGIN SELECT RAISE(ABORT,'experiment_path_kind:constitutional'); END;

-- ─── WHAT MUST BE WORKING FOR AN EVENT TO BE OBSERVED AT ALL ─────────────────
-- The bridge from a sealed settlement rule to the instrument it requires. A
-- rule that settles on `payment` cannot be measured if nothing carries a
-- payment to us; a rule that counts `complaint` cannot be measured if nothing
-- carries a reply. This is the derivation, and it is constitutional because an
-- institution that could re-decide it could also decide that the rule it
-- failed to measure needed nothing in particular.
CREATE TABLE settlement_event_paths (
  event_kind TEXT NOT NULL REFERENCES business_outcome_event_kinds(kind),
  path_kind  TEXT NOT NULL REFERENCES experiment_path_kinds(kind),
  PRIMARY KEY (event_kind, path_kind)
);
INSERT INTO settlement_event_paths (event_kind, path_kind) VALUES
  ('offer_delivered',       'sending'),
  ('arrival',               'offer_page'),
  ('offer_viewed',          'offer_page'),
  ('checkout_started',      'payment_observation'),
  ('payment',               'payment_observation'),
  ('payment',               'payment'),
  ('delivery',              'fulfilment'),
  ('delivery_failed',       'fulfilment'),
  ('refund',                'payment_observation'),
  ('dispute',               'payment_observation'),
  ('complaint',             'reply'),
  ('declined_value',        'reply'),
  ('continuation_requested','reply');
CREATE TRIGGER settlement_event_paths_constitutional_insert
BEFORE INSERT ON settlement_event_paths
BEGIN SELECT RAISE(ABORT,'settlement_event_path:constitutional'); END;
CREATE TRIGGER settlement_event_paths_constitutional_update
BEFORE UPDATE ON settlement_event_paths
BEGIN SELECT RAISE(ABORT,'settlement_event_path:constitutional'); END;
CREATE TRIGGER settlement_event_paths_constitutional_delete
BEFORE DELETE ON settlement_event_paths
BEGIN SELECT RAISE(ABORT,'settlement_event_path:constitutional'); END;

-- ─── ONE EXPERIMENT'S DECLARED INSTRUMENT ────────────────────────────────────
-- Written before the first consequential act, from the experiment's own sealed
-- rule and its own offer. `bears_on` is the whole point of the row:
--
--   measurement — the rule's events are observed through it. Broken, and the
--                 test did not measure what it was for.
--   invitation  — the offer ASKS A STRANGER to use it. Broken, and we are
--                 inviting people into a void, which is a thing not to do
--                 rather than a thing to note.
--   obligation  — we need it to keep a promise to somebody who paid.
--
-- Experiment 001's reply path was an INVITATION its rule never counted. That
-- is why nothing caught it: the measurement was sound and the invitation was
-- not, and the institution had no word for the second.
CREATE TABLE experiment_paths (
  experiment_id TEXT NOT NULL REFERENCES venture_experiments(id),
  -- Carried as its siblings carry it (`experiment_fulfilments`,
  -- `experiment_run_state`): a test belongs to one person, the erasure walks
  -- founder-scoped tables by that column, and a child that made the erasure
  -- take a different route would be a child the erasure could miss.
  founder_id    TEXT NOT NULL REFERENCES founders(id),
  kind          TEXT NOT NULL REFERENCES experiment_path_kinds(kind),
  bears_on      TEXT NOT NULL CHECK (bears_on IN ('measurement','invitation','obligation')),
  -- In the owner's words, why this test depends on this path.
  why           TEXT NOT NULL,
  -- Whether the test may not proceed without it. Derived, never argued down.
  essential     INTEGER NOT NULL DEFAULT 1 CHECK (essential IN (0,1)),
  declared_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- The last verification against the world, and what it found.
  verified_at     TEXT,
  verified_status TEXT CHECK (verified_status IN ('working','not_working','unknown')),
  verified_detail TEXT,
  -- When it was first found not working and not yet found working since. The
  -- interval an owner needs to know about, and the reader's evidence that a
  -- window was measured through a broken instrument.
  broken_since  TEXT,
  broken_detail TEXT,
  PRIMARY KEY (experiment_id, kind)
);
CREATE INDEX idx_experiment_paths_broken ON experiment_paths(experiment_id, broken_since);

CREATE TRIGGER experiment_path_is_declared_once
BEFORE UPDATE ON experiment_paths
BEGIN
  -- WHY A TEST DEPENDS ON A PATH IS SETTLED WHEN IT IS DECLARED. Rewriting it
  -- afterwards would let a launch that failed a check pass by restating what
  -- the check was about.
  SELECT RAISE(ABORT,'experiment_path:immutable')
    WHERE NEW.kind <> OLD.kind OR NEW.bears_on <> OLD.bears_on OR NEW.why <> OLD.why
       OR NEW.declared_at <> OLD.declared_at;
  -- A DEPENDENCY IS NEVER ARGUED DOWN. Essentiality follows from the sealed
  -- rule and the offer; nothing may lower it to make a refusal go away.
  SELECT RAISE(ABORT,'experiment_path:essential_does_not_fall')
    WHERE OLD.essential = 1 AND NEW.essential = 0;
  -- A PATH IS NOT WORKING AND BROKEN AT THE SAME TIME. Recovery clears
  -- `broken_since` in the same statement that records the working reading.
  SELECT RAISE(ABORT,'experiment_path:working_while_broken')
    WHERE NEW.verified_status = 'working' AND NEW.broken_since IS NOT NULL;
END;

CREATE TRIGGER experiment_path_declares_something
BEFORE INSERT ON experiment_paths
BEGIN
  SELECT RAISE(ABORT,'experiment_path:unsaid') WHERE trim(NEW.why) = '';
  SELECT RAISE(ABORT,'experiment_path:working_while_broken')
    WHERE NEW.verified_status = 'working' AND NEW.broken_since IS NOT NULL;
END;
