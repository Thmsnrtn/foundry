-- =============================================================================
-- THE WORLD PRODUCES SIGNALS; FOUNDRY PRODUCES HYPOTHESES ABOUT THEM
--
-- Discovery has one failure mode worth designing against, and it is not
-- laziness. It is that a model generates plausible startup ideas and then goes
-- looking for things that sound supportive - which produces sourced, dated,
-- confident nonsense, and is the exact shape of every defect this institution
-- has found in itself so far.
--
-- So discovery starts from a NEED rather than an idea, looks for ECONOMIC
-- SIGNALS rather than startup ideas, and keeps the two halves apart: the
-- observation is what somebody actually wrote, and the signal kind is
-- Foundry's reading of it. One is evidence. The other is inference, and it is
-- stored as inference.
--
-- A SEARCH BRIEF MUST NOT INVENT AN ASSET SHAPE. "Find another small digital
-- income stream" silently becoming "find another SaaS" is the failure the whole
-- river-of-nickels mandate exists to prevent, so the shape the owner named is
-- stored, NULL is a real value, and nothing downstream may fill it in.
-- =============================================================================

CREATE TABLE signal_kinds (
  kind            TEXT PRIMARY KEY,
  -- What it is, in the owner's words.
  what_it_is      TEXT NOT NULL,
  -- How somebody would recognise it in something a person actually wrote.
  reads_like      TEXT NOT NULL,
  -- And what it must not be mistaken for, because that is where the false
  -- positives live.
  is_not          TEXT NOT NULL,
  sort_order      INTEGER NOT NULL
);

INSERT INTO signal_kinds (kind, what_it_is, reads_like, is_not, sort_order) VALUES
  ('recurring_pain', 'the same difficulty described by different people over time',
   'somebody saying this keeps happening, or happens every time',
   'one person having a bad day with something', 1),
  ('manual_workaround', 'people doing something awkward by hand because nothing does it',
   'somebody describing a script they wrote, a spreadsheet they keep, a thing they do by hand',
   'people enjoying building their own tools, which is a hobby rather than a market', 2),
  ('coordination_burden', 'effort spent getting people or systems to agree',
   'somebody describing chasing, reconciling, or keeping two things in step',
   'a large organisation being large', 3),
  ('repeated_assembly', 'information people put together again and again from scattered places',
   'somebody describing gathering the same things from several sources',
   'a one-off research task', 4),
  ('repeated_monitoring', 'people repeatedly checking whether something changed',
   'somebody describing watching a page, a feed, or a number',
   'idle curiosity', 5),
  ('repeated_seeking', 'people repeatedly looking for information that is hard to find',
   'somebody asking where to find something, more than once, over time',
   'a question with an obvious answer nobody bothered to give', 6),
  ('repeated_outsourcing', 'work people keep paying somebody else to do',
   'somebody describing hiring out a task that recurs',
   'work that is outsourced because it needs judgement', 7),
  ('disliked_product', 'an existing thing people use and complain about',
   'somebody naming a product and saying what is wrong with it',
   'a product being unfashionable', 8),
  ('heavy_for_the_job', 'an expensive or complicated thing serving a need that looks lighter',
   'somebody describing paying for or running much more than they seem to need',
   'a thing being expensive, which may be what it costs to do properly', 9),
  ('marketplace_gap', 'people asking for something that is not listed anywhere',
   'somebody asking whether a thing exists and being told it does not',
   'a thing not existing because nobody wants it', 10),
  ('newly_cheap', 'something that has just become much cheaper to do',
   'somebody noticing that a task that used to be hard now is not',
   'enthusiasm about a new technology', 11),
  ('public_information', 'information that is public but scattered, stale or unusable',
   'somebody describing hunting through registers, filings or feeds',
   'information that is public and already well organised by somebody', 12),
  ('fragmented_workflow', 'a job that crosses several tools and loses something at each seam',
   'somebody describing copying between tools, or things falling between them',
   'somebody using more tools than they need to', 13),
  ('costly_human_work', 'expensive human effort spent on something mechanical',
   'somebody describing people doing repetitive work at professional rates',
   'work that only looks mechanical from outside', 14);

CREATE TRIGGER signal_kinds_constitutional_insert BEFORE INSERT ON signal_kinds
BEGIN SELECT RAISE(ABORT,'signal_kind:constitutional'); END;
CREATE TRIGGER signal_kinds_constitutional_update BEFORE UPDATE ON signal_kinds
BEGIN SELECT RAISE(ABORT,'signal_kind:constitutional'); END;
CREATE TRIGGER signal_kinds_constitutional_delete BEFORE DELETE ON signal_kinds
BEGIN SELECT RAISE(ABORT,'signal_kind:constitutional'); END;

-- WHAT THIS SEARCH IS ACTUALLY FOR, before anybody looks at anything.
CREATE TABLE search_briefs (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  mandate_id     TEXT NOT NULL REFERENCES venture_mandates(id),
  -- What the portfolio needs, in the owner's words, derived from what it is
  -- concentrated on rather than from anybody's opinion.
  looking_for    TEXT NOT NULL,
  -- The constraints he actually said, so the brief cannot quietly widen.
  held_to        TEXT,
  -- THE SHAPE HE NAMED, OR NOTHING. Null is a real answer and means the search
  -- may find any economic form; nothing downstream may fill it in, because
  -- "find an income stream" becoming "find a SaaS" is the failure the whole
  -- mandate exists to prevent.
  shape_named    TEXT,
  -- What was searched for, so a barren search can be told from a bad idea.
  terms_tried    TEXT,
  evidence_mode  TEXT NOT NULL CHECK (evidence_mode IN ('real','reference')),
  made_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER search_brief_guard
BEFORE INSERT ON search_briefs
BEGIN
  SELECT RAISE(ABORT,'search_brief:incomplete') WHERE trim(NEW.looking_for) = '';
END;

CREATE TRIGGER search_brief_shape_cannot_be_invented
BEFORE UPDATE ON search_briefs
BEGIN
  SELECT RAISE(ABORT,'search_brief:shape_cannot_be_invented')
    WHERE OLD.shape_named IS NULL AND NEW.shape_named IS NOT NULL;
  SELECT RAISE(ABORT,'search_brief:immutable')
    WHERE NEW.looking_for IS NOT OLD.looking_for
       OR NEW.mandate_id IS NOT OLD.mandate_id;
END;

CREATE INDEX idx_search_briefs_of ON search_briefs(mandate_id, made_at);

-- A seed now carries Foundry's READING of the signal, kept apart from the
-- observation itself, and the cheapest question that would settle whether it
-- is nonsense.
ALTER TABLE opportunity_seeds ADD COLUMN brief_id TEXT REFERENCES search_briefs(id);
ALTER TABLE opportunity_seeds ADD COLUMN signal_kind TEXT REFERENCES signal_kinds(kind);
ALTER TABLE opportunity_seeds ADD COLUMN inference TEXT;
ALTER TABLE opportunity_seeds ADD COLUMN next_question TEXT;
-- How cheaply the next question could be answered. Seed priority is about
-- information value, not about which idea sounds biggest.
ALTER TABLE opportunity_seeds ADD COLUMN answerable_by TEXT
  CHECK (answerable_by IN ('read','ask','test','unknown'));
