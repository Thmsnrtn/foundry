-- =============================================================================
-- A REFUND SAYS WHICH PAYMENT IT RETURNS.
--
-- The world reports out of order. A provider can deliver `charge.refunded`
-- before the `payment_intent.succeeded` it reverses, deliver the same event
-- twice, or report a dispute on a charge months after the test that sold it
-- settled. Until now the intake matched a refund to what was owed by updating
-- whichever fulfilment already carried the payment reference — so a refund
-- that arrived first updated nothing, and the payment that followed opened an
-- `owed` row for money that had already gone back. The goods would then have
-- been delivered for a purchase the buyer no longer had.
--
-- Three things change, all at the row:
--
--   1. An outcome event that reverses or contests a payment names it
--      (`settles_ref`). Nothing is inferred from arrival order.
--   2. A fulfilment born with a prior refund standing against its payment is
--      closed on arrival; one with a prior dispute is marked disputed. "Owed,
--      with a refund already recorded" cannot exist.
--   3. A dispute is a state of the obligation, not a note: nothing is sent to
--      a buyer whose charge is contested, and its outcome (won: the row
--      resumes; lost: the money is gone and the row is refunded) is written
--      where the obligation is read.
--
-- And the delivery guard learns what the acts have always meant. An act's
-- expiry bounds what may be TAKEN ON under it — a purchase reported after it
-- expires is refunded, not fulfilled — but not the DISCHARGE of what was taken
-- on while it stood: a buyer who paid on the last day the offer stood is still
-- owed the goods on the day after. The act says so in its own summary when the
-- owner approves it (hand.ts), so this is his reading, not the hand's.
-- =============================================================================

ALTER TABLE business_outcome_events ADD COLUMN settles_ref TEXT;
CREATE INDEX idx_business_outcome_events_settles ON business_outcome_events(exposure_id, kind, settles_ref);

ALTER TABLE experiment_fulfilments ADD COLUMN disputed_at TEXT;
ALTER TABLE experiment_fulfilments ADD COLUMN dispute_outcome TEXT CHECK (dispute_outcome IN ('won','lost'));

-- A FULFILMENT CANNOT BE BORN OWED AGAINST MONEY ALREADY RETURNED. The refund
-- that arrived first closes it at once, with its own reference on the row; a
-- dispute that arrived first marks it. Both read the events by the payment
-- they name, never by when they arrived.
CREATE TRIGGER experiment_fulfilment_closed_on_arrival
AFTER INSERT ON experiment_fulfilments
BEGIN
  UPDATE experiment_fulfilments
     SET status = 'refunded',
         refund_ref = (SELECT b.provider_event_ref FROM business_outcome_events b
                        WHERE b.exposure_id = NEW.exposure_id AND b.kind = 'refund' AND b.settles_ref = NEW.payment_ref
                        ORDER BY b.observed_at, b.rowid LIMIT 1),
         updated_at = datetime('now')
   WHERE id = NEW.id
     AND EXISTS (SELECT 1 FROM business_outcome_events b
                  WHERE b.exposure_id = NEW.exposure_id AND b.kind = 'refund' AND b.settles_ref = NEW.payment_ref);
  UPDATE experiment_fulfilments
     SET disputed_at = (SELECT MIN(b.observed_at) FROM business_outcome_events b
                         WHERE b.exposure_id = NEW.exposure_id AND b.kind = 'dispute'
                           AND b.settles_ref IN (NEW.payment_ref, coalesce(NEW.charge_ref, ''))),
         updated_at = datetime('now')
   WHERE id = NEW.id AND disputed_at IS NULL
     AND EXISTS (SELECT 1 FROM business_outcome_events b
                  WHERE b.exposure_id = NEW.exposure_id AND b.kind = 'dispute'
                    AND b.settles_ref IN (NEW.payment_ref, coalesce(NEW.charge_ref, '')));
END;

-- The progress guard as it stood (migration 284), plus: nothing is SENT to a
-- buyer whose charge is contested and undecided. A delivery already on its
-- way may still be reported delivered or failed — that is the truth of what
-- happened — and a lost dispute closes the row as refunded in the same write
-- that records the outcome.
DROP TRIGGER experiment_fulfilment_progress;
CREATE TRIGGER experiment_fulfilment_progress
BEFORE UPDATE ON experiment_fulfilments
BEGIN
  SELECT RAISE(ABORT,'experiment_fulfilment:immutable') WHERE
    NEW.id <> OLD.id OR NEW.founder_id <> OLD.founder_id OR NEW.experiment_id <> OLD.experiment_id
    OR NEW.exposure_id <> OLD.exposure_id OR NEW.payment_event_id <> OLD.payment_event_id
    OR NEW.provider <> OLD.provider OR NEW.payment_ref <> OLD.payment_ref
    OR NEW.amount_cents <> OLD.amount_cents OR NEW.currency <> OLD.currency OR NEW.created_at <> OLD.created_at;
  SELECT RAISE(ABORT,'experiment_fulfilment:refund_is_final') WHERE OLD.status = 'refunded' AND NEW.status <> 'refunded';
  SELECT RAISE(ABORT,'experiment_fulfilment:delivered_is_final') WHERE OLD.status = 'delivered' AND NEW.status NOT IN ('delivered','refunded');
  SELECT RAISE(ABORT,'experiment_fulfilment:request_in_the_future') WHERE NEW.refund_requested_at IS NOT NULL
    AND datetime(NEW.refund_requested_at) > datetime('now', '+5 minutes');
  SELECT RAISE(ABORT,'experiment_fulfilment:disputed') WHERE NEW.status = 'sent' AND OLD.status <> 'sent'
    AND NEW.disputed_at IS NOT NULL AND NEW.dispute_outcome IS NULL;
  SELECT RAISE(ABORT,'experiment_fulfilment:dispute_outcome_needs_a_dispute') WHERE NEW.dispute_outcome IS NOT NULL AND NEW.disputed_at IS NULL;
  SELECT RAISE(ABORT,'experiment_fulfilment:dispute_outcome_is_final') WHERE OLD.dispute_outcome IS NOT NULL AND NEW.dispute_outcome IS NOT OLD.dispute_outcome;
END;

-- THE PLAN GUARD, as migration 296 left it, with two clauses that read the
-- obligation rather than the clock: a delivery is authorised by an act that
-- stood when the purchase was reported, expired since or not; and nothing is
-- owed on a purchase the buyer is contesting.
DROP TRIGGER experiment_action_plan_guard;
CREATE TRIGGER experiment_action_plan_guard
BEFORE INSERT ON outbound_actions WHEN NEW.experiment_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT,'experiment_action:born_approved') WHERE NEW.status <> 'pending_approval'
    OR NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL OR NEW.executed_at IS NOT NULL;
  SELECT RAISE(ABORT,'experiment_action:binding_invalid') WHERE NEW.experiment_act IS NULL
    OR NEW.proposed_act_id IS NULL OR NEW.effect_id IS NULL
    OR NEW.action_type <> 'send_email' OR NEW.integration_name <> 'resend'
    OR NEW.responsibility_id IS NOT NULL OR NEW.authority_consent_id IS NOT NULL;
  SELECT RAISE(ABORT,'experiment_action:asset_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM products p WHERE p.id = NEW.product_id AND p.from_experiment_id = NEW.experiment_id
      AND p.standing = 'experimental' AND p.deleted_at IS NULL);
  SELECT RAISE(ABORT,'experiment_action:experiment_not_live') WHERE NOT EXISTS (
    SELECT 1 FROM venture_experiments e WHERE e.id = NEW.experiment_id AND e.decision = 'approved'
      AND (e.ran_at IS NULL OR NEW.experiment_act = 'delivery') AND e.validity = 'valid');
  -- WHAT WAS TAKEN ON WHILE THE ACT STOOD IS DISCHARGED UNDER IT. An offer
  -- needs the act standing now; a delivery needs it to have stood when the
  -- purchase was reported (the fulfilment's own clock), and never revoked.
  SELECT RAISE(ABORT,'experiment_action:not_authorised') WHERE NOT EXISTS (
    SELECT 1 FROM proposed_acts a WHERE a.id = NEW.proposed_act_id AND a.product_id = NEW.product_id
      AND a.experiment_id = NEW.experiment_id AND coalesce(a.measurement_critical, 0) = 1
      AND a.subject = 'contact_people' AND a.action_type = 'send_email'
      AND a.decision = 'approved' AND a.revoked_at IS NULL
      AND (datetime(a.expires_at) > datetime('now')
        OR (NEW.experiment_act = 'delivery' AND EXISTS (
              SELECT 1 FROM experiment_fulfilments f WHERE f.id = NEW.fulfilment_id
                AND datetime(f.created_at) <= datetime(a.expires_at)))));
  SELECT RAISE(ABORT,'experiment_action:recipient_not_approved') WHERE NEW.experiment_act = 'offer' AND NOT EXISTS (
    SELECT 1 FROM experiment_recipients r WHERE r.id = NEW.recipient_id AND r.experiment_id = NEW.experiment_id
      AND r.review_status = 'approved' AND r.channel = 'email'
      AND r.email = coalesce(json_extract(NEW.parameters_json, '$.to[0]'), ''));
  SELECT RAISE(ABORT,'experiment_action:recipient_not_in_this_authorisation') WHERE NEW.experiment_act = 'offer'
    AND NOT EXISTS (
      SELECT 1 FROM experiment_recipients r WHERE r.id = NEW.recipient_id
        AND r.authorised_act_id IS NOT NULL AND r.authorised_act_id = NEW.proposed_act_id);
  SELECT RAISE(ABORT,'experiment_action:nothing_owed') WHERE NEW.experiment_act = 'delivery' AND NOT EXISTS (
    SELECT 1 FROM experiment_fulfilments f WHERE f.id = NEW.fulfilment_id AND f.experiment_id = NEW.experiment_id
      AND f.status = 'owed');
  SELECT RAISE(ABORT,'experiment_action:purchase_disputed') WHERE NEW.experiment_act = 'delivery' AND EXISTS (
    SELECT 1 FROM experiment_fulfilments f WHERE f.id = NEW.fulfilment_id
      AND f.disputed_at IS NOT NULL AND f.dispute_outcome IS NULL);
  SELECT RAISE(ABORT,'experiment_action:workshop_paused') WHERE NEW.experiment_act = 'offer' AND EXISTS (
    SELECT 1 FROM public_workshop w JOIN venture_experiments e ON e.founder_id = w.founder_id
     WHERE e.id = NEW.experiment_id AND w.economic_pause_at IS NOT NULL);
  SELECT RAISE(ABORT,'experiment_action:recipient_suppressed') WHERE NEW.experiment_act = 'offer' AND EXISTS (
    SELECT 1 FROM public_suppressions s JOIN venture_experiments e ON e.founder_id = s.founder_id
     WHERE e.id = NEW.experiment_id AND s.email = lower(coalesce(json_extract(NEW.parameters_json, '$.to[0]'), '')));
  SELECT RAISE(ABORT,'experiment_action:no_public_page') WHERE NEW.experiment_act = 'offer'
    AND EXISTS (SELECT 1 FROM public_workshop w JOIN venture_experiments e ON e.founder_id = w.founder_id
                 WHERE e.id = NEW.experiment_id)
    AND NOT EXISTS (
      SELECT 1 FROM public_publications p WHERE p.experiment_id = NEW.experiment_id AND p.kind = 'experiment'
        AND p.superseded_at IS NULL AND p.verified_status = 'verified');
END;
