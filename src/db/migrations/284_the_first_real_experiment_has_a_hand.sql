-- =============================================================================
-- THE FIRST REAL EXPERIMENT HAS A HAND
--
-- The campaign left one seam open on purpose: "the first candidate chooses the
-- provider and the first Hand (offer placement, event ingestion into
-- recordBusinessOutcome)". The owner named the candidate: a $29 one-time bid
-- brief offered to up to twenty-five Massachusetts millwork businesses, a
-- Stripe Payment Link as the offer, email as the hand. This migration gives
-- that experiment what the schema did not yet hold, and nothing the schema
-- already holds:
--
--   * a test that builds nothing opens no workshop;
--   * an outcome kind for an offer that reached the business Foundry wrote to,
--     so a rule can say "at most twenty-five reached without a payment";
--   * a capability row for publishing a payment link, so the door knows the
--     consequence of the tool that makes one;
--   * whom Foundry may write to, reviewed by the owner and never born approved;
--   * what it sends and delivers, as text with a quality gate, not as claims
--     on a company that does not exist until approval;
--   * what is owed after a payment, keyed to the provider's references so no
--     payer identity is copied into the outcome ledger;
--   * the binding of an outbound action to the experiment, the owner-approved
--     act that authorises it, the recipient or the fulfilment it serves, born
--     unapproved (migration 173) and admitted only by the guard below.
-- =============================================================================

-- ─── A test that builds nothing opens no workshop ────────────────────────────
ALTER TABLE venture_experiments ADD COLUMN needs_workshop INTEGER NOT NULL DEFAULT 1;

-- ─── The offer reached somebody Foundry wrote to ─────────────────────────────
-- Placed offers arrive at the person; an emailed offer is sent to them. Both
-- are the moment the offer and a person met, before anything was viewed or
-- paid. Sort order 0 keeps it before 'arrival' in the ladder.
DROP TRIGGER business_outcome_event_kinds_constitutional_insert;
INSERT INTO business_outcome_event_kinds (kind, what_it_is, is_payment, is_delivery, sort_order) VALUES
  ('offer_delivered', 'the offer reached somebody Foundry wrote to', 0, 0, 0);
CREATE TRIGGER business_outcome_event_kinds_constitutional_insert
BEFORE INSERT ON business_outcome_event_kinds
BEGIN SELECT RAISE(ABORT,'business_outcome_event_kind:constitutional'); END;

-- ─── Publishing a payment link is a public act that moves no money ───────────
DROP TRIGGER capabilities_constitutional_insert;
INSERT INTO capabilities (capability_key, family, what_it_does, rung, sort_order) VALUES
  ('publish_payment_link', 'commerce', 'put a price and a way to pay it where a stranger can reach them', 'public', 94),
  ('withdraw_payment_link', 'commerce', 'take a price and a way to pay it out of reach again; what was paid stays on record', 'reversible', 95);
CREATE TRIGGER capabilities_constitutional_insert BEFORE INSERT ON capabilities
BEGIN SELECT RAISE(ABORT,'capability:constitutional'); END;
INSERT INTO capability_providers (id, capability_key, provider, how, tool, cost_note, maturity, sort_order) VALUES
  ('cp_payment_link_stripe', 'publish_payment_link', 'stripe', 'api', 'stripe_create_payment_link',
   'provider fees on what is paid through it', 'available', 1),
  -- Taking the offer down: the link is deactivated, never deleted, so what
  -- was paid through it stays on record. One provider per capability, so the
  -- reverse act is its own capability.
  ('cp_payment_link_stripe_off', 'withdraw_payment_link', 'stripe', 'api', 'stripe_deactivate_payment_link',
   'none', 'available', 1);

-- ─── Whom Foundry may write to ───────────────────────────────────────────────
CREATE TABLE experiment_recipients (
  id               TEXT PRIMARY KEY,
  founder_id       TEXT NOT NULL REFERENCES founders(id),
  experiment_id    TEXT NOT NULL REFERENCES venture_experiments(id),
  counterparty_ref TEXT NOT NULL,
  email            TEXT,
  channel          TEXT NOT NULL CHECK (channel IN ('email','web_form')),
  source_url       TEXT,
  review_status    TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved','struck')),
  review_reason    TEXT,
  reviewed_by      TEXT,
  reviewed_at      TEXT,
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(experiment_id, counterparty_ref)
);
CREATE INDEX idx_experiment_recipients ON experiment_recipients(experiment_id, review_status);

CREATE TRIGGER experiment_recipient_guard
BEFORE INSERT ON experiment_recipients
BEGIN
  SELECT RAISE(ABORT,'experiment_recipient:experiment_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM venture_experiments e WHERE e.id = NEW.experiment_id AND e.founder_id = NEW.founder_id
      AND e.ran_at IS NULL AND e.validity = 'valid');
  SELECT RAISE(ABORT,'experiment_recipient:counterparty_required') WHERE trim(NEW.counterparty_ref) = '';
  SELECT RAISE(ABORT,'experiment_recipient:email_invalid') WHERE NEW.channel = 'email'
    AND (NEW.email IS NULL OR instr(NEW.email, '@') < 2 OR instr(NEW.email, ' ') > 0);
  -- A recipient is never born approved: approval is the owner's act.
  SELECT RAISE(ABORT,'experiment_recipient:review_not_owner_act') WHERE NEW.review_status <> 'pending'
    OR NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL;
END;

CREATE TRIGGER experiment_recipient_review_guard
BEFORE UPDATE ON experiment_recipients
BEGIN
  SELECT RAISE(ABORT,'experiment_recipient:immutable') WHERE
    NEW.experiment_id <> OLD.experiment_id OR NEW.founder_id <> OLD.founder_id
    OR NEW.counterparty_ref <> OLD.counterparty_ref OR NEW.created_at <> OLD.created_at
    OR (NEW.channel <> OLD.channel AND NOT (OLD.channel = 'web_form' AND NEW.channel = 'email'))
    OR coalesce(NEW.source_url, '') <> coalesce(OLD.source_url, '');
  -- Only the founder who owns the experiment reviews, and every review names him.
  SELECT RAISE(ABORT,'experiment_recipient:reviewer_invalid') WHERE
    (NEW.review_status <> OLD.review_status OR coalesce(NEW.email, '') <> coalesce(OLD.email, ''))
    AND NEW.reviewed_by IS NOT 'founder:' || OLD.founder_id;
  SELECT RAISE(ABORT,'experiment_recipient:review_stamp_required') WHERE
    NEW.review_status <> OLD.review_status AND NEW.reviewed_at IS NULL;
  SELECT RAISE(ABORT,'experiment_recipient:strike_reason_required') WHERE
    NEW.review_status = 'struck' AND OLD.review_status <> 'struck' AND trim(coalesce(NEW.review_reason, '')) = '';
  SELECT RAISE(ABORT,'experiment_recipient:email_invalid') WHERE NEW.channel = 'email'
    AND (NEW.email IS NULL OR instr(NEW.email, '@') < 2 OR instr(NEW.email, ' ') > 0);
  SELECT RAISE(ABORT,'experiment_recipient:experiment_settled') WHERE EXISTS (
    SELECT 1 FROM venture_experiments e WHERE e.id = NEW.experiment_id AND (e.ran_at IS NOT NULL OR e.validity <> 'valid'));
END;

-- ─── What it sends and what it delivers ──────────────────────────────────────
-- Text, with a pull date and a digest, so the quality gate at send time can say
-- "stale" or "changed" rather than trusting the file it came from. The
-- 'offer_shape' kind holds, as JSON, what the offer shape and structural facts
-- will be stated as once the asset exists: the shape is stated of an asset, and
-- the asset exists only after approval.
CREATE TABLE experiment_materials (
  id               TEXT PRIMARY KEY,
  founder_id       TEXT NOT NULL REFERENCES founders(id),
  experiment_id    TEXT NOT NULL REFERENCES venture_experiments(id),
  kind             TEXT NOT NULL CHECK (kind IN ('deliverable','offer_template','offer','offer_shape')),
  title            TEXT NOT NULL,
  body             TEXT NOT NULL,
  pulled_at        TEXT,
  digest           TEXT NOT NULL,
  payment_link_url TEXT,
  recorded_by      TEXT NOT NULL,
  recorded_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at    TEXT
);
CREATE UNIQUE INDEX idx_experiment_materials_live
  ON experiment_materials(experiment_id, kind) WHERE superseded_at IS NULL;

CREATE TRIGGER experiment_material_guard
BEFORE INSERT ON experiment_materials
BEGIN
  SELECT RAISE(ABORT,'experiment_material:experiment_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM venture_experiments e WHERE e.id = NEW.experiment_id AND e.founder_id = NEW.founder_id);
  SELECT RAISE(ABORT,'experiment_material:incomplete') WHERE trim(NEW.title) = '' OR trim(NEW.body) = ''
    OR trim(NEW.digest) = '' OR trim(NEW.recorded_by) = '';
  SELECT RAISE(ABORT,'experiment_material:offer_needs_a_link') WHERE NEW.kind = 'offer'
    AND (NEW.payment_link_url IS NULL OR NEW.payment_link_url NOT LIKE 'https://%');
  SELECT RAISE(ABORT,'experiment_material:cannot_arrive_superseded') WHERE NEW.superseded_at IS NOT NULL;
END;

CREATE TRIGGER experiment_material_immutable
BEFORE UPDATE ON experiment_materials
BEGIN
  SELECT RAISE(ABORT,'experiment_material:immutable') WHERE
    NEW.id <> OLD.id OR NEW.founder_id <> OLD.founder_id OR NEW.experiment_id <> OLD.experiment_id
    OR NEW.kind <> OLD.kind OR NEW.title <> OLD.title OR NEW.body <> OLD.body
    OR coalesce(NEW.pulled_at, '') <> coalesce(OLD.pulled_at, '') OR NEW.digest <> OLD.digest
    OR coalesce(NEW.payment_link_url, '') <> coalesce(OLD.payment_link_url, '')
    OR NEW.recorded_by <> OLD.recorded_by OR NEW.recorded_at <> OLD.recorded_at
    OR (OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS NOT OLD.superseded_at);
END;

-- ─── What is owed after a payment ────────────────────────────────────────────
-- The payment event carries no payer identity (migration 278). Delivery needs
-- an address, so the obligation is keyed to the provider's own references and
-- the address is read from the provider at delivery time; it lives only in
-- the outbound action that delivers, as a support reply's does.
CREATE TABLE experiment_fulfilments (
  id                  TEXT PRIMARY KEY,
  founder_id          TEXT NOT NULL REFERENCES founders(id),
  experiment_id       TEXT NOT NULL REFERENCES venture_experiments(id),
  exposure_id         TEXT NOT NULL REFERENCES experiment_exposures(id),
  payment_event_id    TEXT NOT NULL REFERENCES business_outcome_events(id),
  provider            TEXT NOT NULL,
  payment_ref         TEXT NOT NULL,
  charge_ref          TEXT,
  amount_cents        INTEGER NOT NULL CHECK (amount_cents > 0),
  currency            TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'owed' CHECK (status IN ('owed','sent','delivered','failed','refunded')),
  refund_requested_at TEXT,
  refund_ref          TEXT,
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(payment_event_id)
);
CREATE INDEX idx_experiment_fulfilments ON experiment_fulfilments(experiment_id, status);

CREATE TRIGGER experiment_fulfilment_guard
BEFORE INSERT ON experiment_fulfilments
BEGIN
  SELECT RAISE(ABORT,'experiment_fulfilment:cannot_arrive_settled') WHERE NEW.status <> 'owed'
    OR NEW.refund_requested_at IS NOT NULL OR NEW.refund_ref IS NOT NULL;
  SELECT RAISE(ABORT,'experiment_fulfilment:payment_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM business_outcome_events b
      JOIN business_outcome_event_kinds k ON k.kind = b.kind
      JOIN experiment_exposures x ON x.id = b.exposure_id
     WHERE b.id = NEW.payment_event_id AND k.is_payment = 1 AND b.exposure_id = NEW.exposure_id
       AND x.experiment_id = NEW.experiment_id AND x.founder_id = NEW.founder_id
       AND b.provider = NEW.provider AND b.provider_event_ref = NEW.payment_ref);
END;

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
END;

-- ─── The binding of an outbound action to the experiment it serves ───────────
ALTER TABLE outbound_actions ADD COLUMN experiment_id TEXT REFERENCES venture_experiments(id);
ALTER TABLE outbound_actions ADD COLUMN experiment_act TEXT CHECK (experiment_act IS NULL OR experiment_act IN ('offer','delivery'));
ALTER TABLE outbound_actions ADD COLUMN recipient_id TEXT REFERENCES experiment_recipients(id);
ALTER TABLE outbound_actions ADD COLUMN fulfilment_id TEXT REFERENCES experiment_fulfilments(id);
ALTER TABLE outbound_actions ADD COLUMN proposed_act_id TEXT REFERENCES proposed_acts(id);
CREATE INDEX idx_experiment_actions ON outbound_actions(experiment_id, experiment_act, status);

-- An action bound to an experiment is born unapproved and admitted only under
-- an act the owner approved for exactly this experiment, on the experiment's
-- own asset, to whom the owner approved (offer) or to whom is owed (delivery).
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
  -- An offer belongs to a test still running. What a buyer is owed outlives
  -- the test's settlement: a delivery needs only an approved, valid test.
  SELECT RAISE(ABORT,'experiment_action:experiment_not_live') WHERE NOT EXISTS (
    SELECT 1 FROM venture_experiments e WHERE e.id = NEW.experiment_id AND e.decision = 'approved'
      AND (e.ran_at IS NULL OR NEW.experiment_act = 'delivery') AND e.validity = 'valid');
  SELECT RAISE(ABORT,'experiment_action:not_authorised') WHERE NOT EXISTS (
    SELECT 1 FROM proposed_acts a WHERE a.id = NEW.proposed_act_id AND a.product_id = NEW.product_id
      AND a.experiment_id = NEW.experiment_id AND coalesce(a.measurement_critical, 0) = 1
      AND a.subject = 'contact_people' AND a.action_type = 'send_email'
      AND a.decision = 'approved' AND a.revoked_at IS NULL AND datetime(a.expires_at) > datetime('now'));
  SELECT RAISE(ABORT,'experiment_action:recipient_not_approved') WHERE NEW.experiment_act = 'offer' AND NOT EXISTS (
    SELECT 1 FROM experiment_recipients r WHERE r.id = NEW.recipient_id AND r.experiment_id = NEW.experiment_id
      AND r.review_status = 'approved' AND r.channel = 'email'
      AND r.email = coalesce(json_extract(NEW.parameters_json, '$.to[0]'), ''));
  SELECT RAISE(ABORT,'experiment_action:nothing_owed') WHERE NEW.experiment_act = 'delivery' AND NOT EXISTS (
    SELECT 1 FROM experiment_fulfilments f WHERE f.id = NEW.fulfilment_id AND f.experiment_id = NEW.experiment_id
      AND f.status = 'owed');
END;

-- Bindings never change once written; what may change is the door's own
-- record of what happened (status, receipt, outcome).
CREATE TRIGGER experiment_action_binding_immutable
BEFORE UPDATE ON outbound_actions WHEN OLD.experiment_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT,'experiment_action:binding_immutable') WHERE
    coalesce(NEW.experiment_id, '') <> coalesce(OLD.experiment_id, '')
    OR coalesce(NEW.experiment_act, '') <> coalesce(OLD.experiment_act, '')
    OR coalesce(NEW.recipient_id, '') <> coalesce(OLD.recipient_id, '')
    OR coalesce(NEW.fulfilment_id, '') <> coalesce(OLD.fulfilment_id, '')
    OR coalesce(NEW.proposed_act_id, '') <> coalesce(OLD.proposed_act_id, '')
    OR coalesce(NEW.effect_id, '') <> coalesce(OLD.effect_id, '')
    OR NEW.parameters_json <> OLD.parameters_json;
END;
