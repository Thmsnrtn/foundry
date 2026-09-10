-- AN APPROVAL NAMES WHO IT APPROVED, AND CANNOT GROW AFTERWARDS.
--
-- Two rules stood between an approved recipient and a message: the row guard
-- required `review_status = 'approved'`, and `planOffer` refused anybody with no
-- recorded qualification. The first is the owner's consent. The second is
-- evidence — and evidence is something the institution may record on its own,
-- with grounds and a source and no owner stamp, which is right.
--
-- Put together they made the owner's consent open-ended. "The rest are fine"
-- over eleven businesses meant eleven were consented to, of whom two could be
-- written to today because two carried evidence; and the moment the institution
-- recorded evidence for a third, the third became contactable under the same
-- approval, with no new decision by anybody. Consent given once over a group had
-- quietly become standing authority over whoever later qualified.
--
-- The act the owner approves already carries the list of who it covers, but only
-- as a fingerprint — a hash cannot be checked by a row guard. So the membership
-- is written where it can be enforced: on the recipients themselves, at the
-- moment the act is approved, naming the act that authorised them.
--
-- After this, an approval is a closed set. Qualifying somebody new changes
-- nothing about who may be written to; it makes them eligible for a FUTURE
-- decision, which is what evidence should do.
ALTER TABLE experiment_recipients ADD COLUMN authorised_act_id TEXT REFERENCES proposed_acts(id);

DROP TRIGGER experiment_recipient_guard;
CREATE TRIGGER experiment_recipient_guard
BEFORE INSERT ON experiment_recipients
BEGIN
  SELECT RAISE(ABORT,'experiment_recipient:experiment_not_open') WHERE NOT EXISTS (
    SELECT 1 FROM venture_experiments e WHERE e.id = NEW.experiment_id AND e.founder_id = NEW.founder_id
      AND e.ran_at IS NULL AND e.validity = 'valid');
  SELECT RAISE(ABORT,'experiment_recipient:counterparty_required') WHERE trim(NEW.counterparty_ref) = '';
  SELECT RAISE(ABORT,'experiment_recipient:email_invalid') WHERE NEW.channel = 'email'
    AND (NEW.email IS NULL OR instr(NEW.email, '@') < 2 OR instr(NEW.email, ' ') > 0);
  -- A recipient is never born approved: approval is the owner's act.
  SELECT RAISE(ABORT,'experiment_recipient:review_not_owner_act') WHERE NEW.review_status <> 'pending'
    OR NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL;
  -- Nor born qualified. Belonging to the population is something observed and
  -- recorded afterwards, never a property a row can assert about itself at the
  -- moment it is written.
  SELECT RAISE(ABORT,'experiment_recipient:qualification_not_a_default') WHERE
    NEW.qualified_at IS NOT NULL OR NEW.qualified_because IS NOT NULL OR NEW.qualified_source IS NOT NULL;
  -- Nor born authorised. Being covered by an approval is something an approval
  -- does, at the moment it is given, to the people it names.
  SELECT RAISE(ABORT,'experiment_recipient:authority_not_a_default') WHERE NEW.authorised_act_id IS NOT NULL;
END;

DROP TRIGGER experiment_recipient_review_guard;
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
  -- A qualification is a record of what was observed, so it needs grounds and
  -- the record they were read from, in the same statement that stamps it.
  SELECT RAISE(ABORT,'experiment_recipient:qualification_needs_grounds') WHERE
    NEW.qualified_at IS NOT NULL AND OLD.qualified_at IS NULL
    AND (trim(coalesce(NEW.qualified_because, '')) = '' OR trim(coalesce(NEW.qualified_source, '')) = '');
  -- And once written it stands. A screening that could be quietly withdrawn or
  -- rewritten after the owner read it is not a screening he can rely on.
  SELECT RAISE(ABORT,'experiment_recipient:qualification_stands') WHERE OLD.qualified_at IS NOT NULL
    AND (NEW.qualified_at IS NOT OLD.qualified_at
      OR NEW.qualified_because IS NOT OLD.qualified_because
      OR NEW.qualified_source IS NOT OLD.qualified_source);
  -- WHO AN APPROVAL COVERS IS SETTLED WHEN IT IS GIVEN. It may be written once,
  -- by the act that names them, and never moved to another act afterwards —
  -- otherwise an old consent could be pointed at a new campaign.
  SELECT RAISE(ABORT,'experiment_recipient:authority_stands') WHERE
    OLD.authorised_act_id IS NOT NULL AND NEW.authorised_act_id IS NOT OLD.authorised_act_id;
  -- And only somebody the owner approved can be covered at all.
  SELECT RAISE(ABORT,'experiment_recipient:authority_needs_approval') WHERE
    NEW.authorised_act_id IS NOT NULL AND OLD.authorised_act_id IS NULL AND NEW.review_status <> 'approved';
END;

-- THE OFFER GOES TO SOMEBODY THIS ACT NAMED. Approval, evidence and authority
-- are three different things, and only the third decides who receives a message.
DROP TRIGGER experiment_action_plan_guard;
CREATE TRIGGER experiment_action_plan_guard
BEFORE INSERT ON outbound_actions WHEN NEW.experiment_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT,'experiment_action:born_approved') WHERE NEW.status <> 'pending_approval';
  SELECT RAISE(ABORT,'experiment_action:experiment_not_open') WHERE NOT EXISTS (
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
  -- THE NEW ONE. Approved is not the same as covered by THIS approval.
  SELECT RAISE(ABORT,'experiment_action:recipient_not_in_this_authorisation') WHERE NEW.experiment_act = 'offer'
    AND NOT EXISTS (
      SELECT 1 FROM experiment_recipients r WHERE r.id = NEW.recipient_id
        AND r.authorised_act_id IS NOT NULL AND r.authorised_act_id = NEW.proposed_act_id);
  SELECT RAISE(ABORT,'experiment_action:nothing_owed') WHERE NEW.experiment_act = 'delivery' AND NOT EXISTS (
    SELECT 1 FROM experiment_fulfilments f WHERE f.id = NEW.fulfilment_id AND f.experiment_id = NEW.experiment_id
      AND f.status = 'owed');
  -- THE WORKSHOP'S RULES. Offers only: what a buyer is owed survives a pause.
  SELECT RAISE(ABORT,'experiment_action:workshop_paused') WHERE NEW.experiment_act = 'offer' AND EXISTS (
    SELECT 1 FROM public_workshop w JOIN venture_experiments e ON e.founder_id = w.founder_id
     WHERE e.id = NEW.experiment_id AND w.economic_pause_at IS NOT NULL);
  SELECT RAISE(ABORT,'experiment_action:recipient_suppressed') WHERE NEW.experiment_act = 'offer' AND EXISTS (
    SELECT 1 FROM public_suppressions s JOIN venture_experiments e ON e.founder_id = s.founder_id
     WHERE e.id = NEW.experiment_id AND s.email = lower(coalesce(json_extract(NEW.parameters_json, '$.to[0]'), '')));
  -- The page is required of an owner who HAS a public Workshop: under one, no
  -- stranger is written to without a record they can read; without one, the
  -- pre-Workshop path stands unchanged.
  SELECT RAISE(ABORT,'experiment_action:no_public_page') WHERE NEW.experiment_act = 'offer'
    AND EXISTS (SELECT 1 FROM public_workshop w JOIN venture_experiments e ON e.founder_id = w.founder_id
                 WHERE e.id = NEW.experiment_id)
    AND NOT EXISTS (
      SELECT 1 FROM public_publications p WHERE p.experiment_id = NEW.experiment_id AND p.kind = 'experiment'
        AND p.superseded_at IS NULL AND p.verified_status = 'verified');
END;
