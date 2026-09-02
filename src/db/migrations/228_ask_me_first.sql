-- =============================================================================
-- ASK ME FIRST
--
-- Migration 225 built boundaries with ONE mode and said why: the owner's
-- sentence was "without asking", the obvious schema has `never` and
-- `ask_first`, and `ask_first` could not be honestly enforced. Nothing reaching
-- the outbound door carried proof that the OWNER decided THIS PARTICULAR ACT,
-- so the mode would either refuse everything — a synonym for `never` with a
-- friendlier name — or trust a caller's word for an approval, which is how a
-- governance control becomes decoration.
--
-- The owner's answer was correct: that finding exposed a missing primitive, not
-- a reason to accept hard refusal as the mature model. This is the primitive.
--
-- A PROPOSED ACT is Foundry saying, in advance and in full, exactly what it
-- intends to do — and being unable to do it until the owner says yes to THAT.
-- Its properties are the ones he specified, and each is enforced here rather
-- than promised:
--
--   server-established     the row exists before anything can be approved;
--                          there is no approval without a proposal.
--   bound to the owner     `decided_by` must be `founder:<the product's owner>`.
--                          Not "a founder". The one who owns this company.
--   bound to the company   `product_id`, and the owner check joins through it.
--   bound to the ACT       `params_fingerprint` is a hash of exactly what will
--                          be done. Approval for one act cannot execute
--                          another, which is the attack this is really about:
--                          propose something reasonable, execute something else.
--   bounded in consequence a closed class, stated when proposing.
--   non-forgeable          the calling agent cannot approve: `proposed_by` and
--                          `decided_by` may not be the same principal, and the
--                          decision must be a person.
--   revocable              until it is consumed.
--   consumed at the door   once, ever, by the outbound gateway.
--   auditable              nothing is deleted and no decision can be rewritten.
--
-- WHY CONSUMPTION HAPPENS AT THE CHECK AND NOT AFTER SUCCESS. An approval spent
-- on an effect that then failed means Foundry has to ask again. An approval
-- still standing after an effect that may have reached the world means it can
-- be spent twice. Between over-spending and under-spending an owner's consent,
-- a governance control fails toward asking again.
-- =============================================================================

ALTER TABLE owner_boundaries ADD COLUMN mode TEXT NOT NULL DEFAULT 'never'
  CHECK (mode IN ('never', 'ask_first'));

CREATE TABLE proposed_acts (
  id                  TEXT PRIMARY KEY,
  product_id          TEXT NOT NULL REFERENCES products(id),
  -- The boundary this exists because of. A proposal is only meaningful against
  -- a standing "ask me first"; without one Foundry would simply act.
  subject             TEXT NOT NULL REFERENCES owner_boundary_subjects(subject),
  -- The tool at the door, when the act has hands. NULL is honest for a subject
  -- Foundry cannot yet act on: the proposal is real, the owner can approve it,
  -- and nothing will consume it until a door exists.
  action_type         TEXT,
  -- Exactly what will be done, hashed. Server-computed at both ends.
  params_fingerprint  TEXT NOT NULL,

  -- What the owner reads. All four required: a proposal that cannot say what it
  -- expects or what could go wrong is not ready to be approved.
  summary             TEXT NOT NULL,
  why                 TEXT NOT NULL,
  expected_effect     TEXT NOT NULL,
  risk                TEXT NOT NULL,
  consequence         TEXT NOT NULL CHECK (consequence IN ('low','medium','high')),

  proposed_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  proposed_by         TEXT NOT NULL,
  expires_at          TEXT NOT NULL,

  decided_at          TEXT,
  decided_by          TEXT,
  decision            TEXT CHECK (decision IN ('approved','refused')),

  revoked_at          TEXT,
  revoke_reason       TEXT,

  consumed_at         TEXT,
  consumed_by         TEXT
);

CREATE TRIGGER proposed_act_guard
BEFORE INSERT ON proposed_acts
BEGIN
  SELECT RAISE(ABORT,'proposed_act:incomplete') WHERE
    trim(NEW.summary) = '' OR trim(NEW.why) = ''
    OR trim(NEW.expected_effect) = '' OR trim(NEW.risk) = ''
    OR trim(NEW.params_fingerprint) = '';

  -- FOUNDRY PROPOSES. A proposal already carrying a decision is an agent
  -- approving itself in one statement, and it is refused in the one place that
  -- cannot be bypassed by writing the columns in a different order.
  SELECT RAISE(ABORT,'proposed_act:cannot_arrive_decided')
    WHERE NEW.decided_at IS NOT NULL OR NEW.decision IS NOT NULL
       OR NEW.consumed_at IS NOT NULL OR NEW.revoked_at IS NOT NULL;

  -- A PROPOSAL WITHOUT A STANDING ASK-FIRST IS NOISE. If the owner never asked
  -- to be consulted about this, Foundry does not need permission and should not
  -- be manufacturing decisions for him to make — his attention is the scarcest
  -- thing here.
  SELECT RAISE(ABORT,'proposed_act:nothing_asked_for_this') WHERE NOT EXISTS (
    SELECT 1 FROM owner_boundaries b
     WHERE b.subject = NEW.subject AND b.mode = 'ask_first' AND b.lifted_at IS NULL
       AND (b.product_id IS NULL OR b.product_id = NEW.product_id));

  SELECT RAISE(ABORT,'proposed_act:expiry_required')
    WHERE NEW.expires_at IS NULL OR datetime(NEW.expires_at) <= datetime(NEW.proposed_at);
END;

CREATE TRIGGER proposed_act_decision_guard
BEFORE UPDATE ON proposed_acts
BEGIN
  -- THE OWNER OF THIS COMPANY, NOT "A FOUNDER". The principal is resolved
  -- through the product, so an approval by anyone else — including another
  -- authenticated founder — is refused by the database rather than by a route
  -- remembering to check.
  SELECT RAISE(ABORT,'proposed_act:not_the_owner')
    WHERE NEW.decision IS NOT NULL AND OLD.decision IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM products p
         WHERE p.id = NEW.product_id AND NEW.decided_by = 'founder:' || p.owner_id);

  -- AND NOT THE THING THAT PROPOSED IT. Belt and braces with the above: an
  -- agent that somehow obtained the owner's principal still cannot use it to
  -- approve its own proposal.
  SELECT RAISE(ABORT,'proposed_act:proposer_cannot_approve')
    WHERE NEW.decision IS NOT NULL AND NEW.decided_by IS NEW.proposed_by;

  SELECT RAISE(ABORT,'proposed_act:already_decided')
    WHERE OLD.decision IS NOT NULL AND NEW.decision IS NOT OLD.decision;

  -- CONSUMED ONCE, EVER, AND ONLY WHAT WAS APPROVED.
  SELECT RAISE(ABORT,'proposed_act:not_consumable') WHERE NEW.consumed_at IS NOT NULL
    AND (OLD.consumed_at IS NOT NULL
      OR OLD.decision IS NOT 'approved'
      OR OLD.revoked_at IS NOT NULL
      OR datetime(OLD.expires_at) <= datetime('now'));

  SELECT RAISE(ABORT,'proposed_act:revoked_after_use')
    WHERE NEW.revoked_at IS NOT NULL AND OLD.consumed_at IS NOT NULL;

  -- What was proposed is what was approved. None of it may drift afterwards.
  SELECT RAISE(ABORT,'proposed_act:immutable')
    WHERE NEW.product_id IS NOT OLD.product_id
       OR NEW.subject IS NOT OLD.subject
       OR NEW.action_type IS NOT OLD.action_type
       OR NEW.params_fingerprint IS NOT OLD.params_fingerprint
       OR NEW.summary IS NOT OLD.summary
       OR NEW.why IS NOT OLD.why
       OR NEW.expected_effect IS NOT OLD.expected_effect
       OR NEW.risk IS NOT OLD.risk
       OR NEW.consequence IS NOT OLD.consequence
       OR NEW.proposed_by IS NOT OLD.proposed_by
       OR NEW.proposed_at IS NOT OLD.proposed_at
       OR NEW.expires_at IS NOT OLD.expires_at;
END;

-- Nothing is deleted: a decision the owner made is a fact about him, and a
-- record of consent that can vanish is not a record of consent.
CREATE TRIGGER proposed_act_no_delete
BEFORE DELETE ON proposed_acts
BEGIN
  SELECT RAISE(ABORT,'proposed_act:immutable') WHERE EXISTS (
    SELECT 1 FROM products p
     WHERE p.id = OLD.product_id AND p.erasure_scheduled_at IS NULL);
END;

CREATE INDEX idx_proposed_acts_open
  ON proposed_acts(product_id, subject) WHERE decision IS NULL;
CREATE INDEX idx_proposed_acts_spendable
  ON proposed_acts(product_id, action_type, params_fingerprint)
  WHERE decision = 'approved' AND consumed_at IS NULL AND revoked_at IS NULL;
