-- Migration 124: institutional judgment pays rent — stable conflict identity
-- and independently grounded later-reality observation.
--
-- Baseline reality this closes: deterministic institutional judgment, its
-- later-reality evaluation, and the owner disposition loop the previous slice
-- built all existed with **no production writer**. Nothing outside the test
-- suite ever created a judgment, so the founder-facing "judgments that need
-- your direction" section could only ever be empty. A subsystem that is only
-- ever exercised by its own tests is an orphan abstraction; it pays no rent.
--
-- Wiring a producer to a scheduled pass introduces two problems that must be
-- solved in the database, not in the caller:
--
--   1. A standing conflict would raise a fresh judgment on every tick. Founder
--      attention is a real cost, and repeating the same unanswered question in
--      new rows is the cheapest way to spend it dishonestly.
--   2. A later-reality observer that re-reads the judgment's own inputs, or
--      cites evidence recorded before the judgment existed, is self-confirming.
--      Migration 119 established the rule for development verification; the
--      same rule applies here.

-- ─── 1. Conflict identity ────────────────────────────────────────────────────
-- A judgment is about a specific institutional conflict — a resource and the
-- exact set of responsibilities contending for it. That conflict has one
-- judgment, ever. When later reality bears on it, an evaluation is appended
-- beside the judgment; the founder sees one thing with a history, never a pile
-- of identical rows.
ALTER TABLE strategic_decisions_log ADD COLUMN conflict_identity TEXT;

CREATE UNIQUE INDEX idx_judgment_conflict_identity
  ON strategic_decisions_log(product_id, conflict_identity)
  WHERE conflict_identity IS NOT NULL;

-- The identity slot may only be occupied by a real institutional judgment.
-- Without this, an ordinary strategic decision row could squat a conflict
-- identity and permanently suppress the judgment that belongs there.
CREATE TRIGGER judgment_conflict_identity_guard
BEFORE INSERT ON strategic_decisions_log WHEN NEW.conflict_identity IS NOT NULL
BEGIN
  SELECT RAISE(ABORT,'judgment_identity:not_institutional') WHERE
    NEW.responsibility_refs_json IS NULL OR NEW.evidence_refs_json IS NULL;

  SELECT RAISE(ABORT,'judgment_identity:empty') WHERE trim(NEW.conflict_identity)='';
END;

-- Identity is what makes a judgment findable across ticks. Moving it would let
-- one conflict's history be re-pointed at another.
CREATE TRIGGER judgment_conflict_identity_immutable
BEFORE UPDATE OF conflict_identity ON strategic_decisions_log
BEGIN
  SELECT RAISE(ABORT,'judgment_identity:immutable')
  WHERE OLD.conflict_identity IS NOT NULL
    AND (NEW.conflict_identity IS NULL OR NEW.conflict_identity<>OLD.conflict_identity);
END;

-- ─── 2. Independently grounded later-reality observation ─────────────────────
-- An observation of whether a judgment's expected outcome happened is a
-- canonical signal event citing the specific claims that show it. Two
-- independence properties are enforced here rather than trusted to the caller.
CREATE TRIGGER institutional_judgment_observation_guard
BEFORE INSERT ON signal_events WHEN NEW.source='institutional_judgment_observation'
BEGIN
  SELECT RAISE(ABORT,'judgment_observation:payload_invalid') WHERE
    json_valid(NEW.payload_json)=0
    OR trim(coalesce(json_extract(NEW.payload_json,'$.judgment_id'),''))=''
    OR json_type(NEW.payload_json,'$.evidence_claim_ids')<>'array'
    OR json_array_length(NEW.payload_json,'$.evidence_claim_ids')=0;

  -- The observer may not echo what it is being compared against. Restating the
  -- judgment's expectation or alternatives inside the observation makes a
  -- fabricated confirmation indistinguishable from a real one.
  SELECT RAISE(ABORT,'judgment_observation:circular_grounding') WHERE
    json_extract(NEW.payload_json,'$.expected_outcome') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.alternatives_considered') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.conflict_identity') IS NOT NULL;

  -- The judgment must be this product's. An observation cannot reach across a
  -- tenant boundary to speak about another company's judgment.
  SELECT RAISE(ABORT,'judgment_observation:judgment_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM strategic_decisions_log d
    WHERE d.id=json_extract(NEW.payload_json,'$.judgment_id')
      AND d.product_id=NEW.product_id AND d.responsibility_refs_json IS NOT NULL);

  -- Every cited claim must exist, belong to this product, and have been
  -- recorded STRICTLY AFTER the judgment it is offered as evidence about.
  -- Evidence must follow the prediction it tests; a claim that predates the
  -- judgment cannot be news about it, and same-second evidence is ambiguous,
  -- so it is refused rather than believed.
  SELECT RAISE(ABORT,'judgment_observation:evidence_not_later') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.payload_json,'$.evidence_claim_ids') c
    WHERE NOT EXISTS (
      SELECT 1 FROM reconstruction_claims rc, strategic_decisions_log d
      WHERE rc.id=c.value AND rc.product_id=NEW.product_id
        AND d.id=json_extract(NEW.payload_json,'$.judgment_id')
        AND datetime(rc.created_at)>datetime(d.made_at)));
END;
