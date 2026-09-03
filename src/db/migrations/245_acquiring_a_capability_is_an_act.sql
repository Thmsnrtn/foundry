-- =============================================================================
-- ACQUIRING A CAPABILITY IS AN ACT, AND IT HAS A DOOR
--
-- The fabric can say "I cannot do this yet, and here is the route". Until now
-- that was where it stopped, which made every missing capability a thing the
-- owner had to notice and go and arrange. One of the institution's most
-- important capabilities is acquiring capabilities: when it knows what should
-- happen and cannot do it, it should propose the acquisition - the route, the
-- provider, what it costs, what rung using it would sit on - and let him decide
-- once.
--
-- ACQUISITION IS NEVER AN AUTHORITY SIDE DOOR. Approving an acquisition makes a
-- provider AVAILABLE. It does not grant a single act: the acquired capability
-- goes through the same outbound door, on the same rung, under the same
-- boundaries and allowances as everything else. Acquiring a way to send mail
-- is not permission to send one.
--
-- Founder-scoped, not company-scoped, because most acquisitions serve the
-- frontier - a candidate that is not a company yet - and become portfolio
-- infrastructure that every later asset reuses.
-- =============================================================================

CREATE TABLE capability_acquisitions (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  capability_key TEXT NOT NULL REFERENCES capabilities(capability_key),
  -- The route, from the owner's own list: reuse, existing API, new provider,
  -- governed browser work, an adapter, build, procure, license, a person.
  route          TEXT NOT NULL CHECK (route IN (
                   'reuse','existing_api','new_provider','browser','adapter',
                   'build','procure','license','human')),
  -- The implementation this would bring in, named.
  provider       TEXT NOT NULL,
  how            TEXT NOT NULL CHECK (how IN ('api','browser','shell','workspace','human','internal')),
  cost_note      TEXT NOT NULL,
  -- What would need it, so the owner sees the reason and not a catalogue.
  because        TEXT NOT NULL,
  subject_kind   TEXT CHECK (subject_kind IN ('opportunity','company')),
  subject_id     TEXT,
  proposed_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  proposed_by    TEXT NOT NULL,
  decision       TEXT CHECK (decision IN ('approved','declined')),
  decided_at     TEXT,
  decided_by     TEXT,
  -- Set when the provider actually exists in the fabric - the acquisition's
  -- outcome, not its approval.
  acquired_at    TEXT,
  provider_id    TEXT REFERENCES capability_providers(id)
);

CREATE INDEX idx_capability_acquisitions_open
  ON capability_acquisitions(founder_id) WHERE decision IS NULL;

CREATE TRIGGER capability_acquisition_guard
BEFORE INSERT ON capability_acquisitions
BEGIN
  SELECT RAISE(ABORT,'capability_acquisition:incomplete')
    WHERE trim(NEW.provider) = '' OR trim(NEW.cost_note) = '' OR trim(NEW.because) = ''
       OR trim(NEW.proposed_by) = '';
  SELECT RAISE(ABORT,'capability_acquisition:cannot_arrive_decided')
    WHERE NEW.decision IS NOT NULL OR NEW.acquired_at IS NOT NULL;
END;

CREATE TRIGGER capability_acquisition_decided_once
BEFORE UPDATE ON capability_acquisitions
BEGIN
  SELECT RAISE(ABORT,'capability_acquisition:immutable')
    WHERE NEW.founder_id IS NOT OLD.founder_id OR NEW.capability_key IS NOT OLD.capability_key
       OR NEW.route IS NOT OLD.route OR NEW.provider IS NOT OLD.provider;
  SELECT RAISE(ABORT,'capability_acquisition:already_decided')
    WHERE OLD.decision IS NOT NULL AND NEW.decision IS NOT OLD.decision;
  -- ONLY THE OWNER DECIDES. Foundry proposes what it would take; it does not
  -- grant itself a new way to reach the world.
  SELECT RAISE(ABORT,'capability_acquisition:owner_only')
    WHERE NEW.decision IS NOT NULL AND OLD.decision IS NULL
      AND (NEW.decided_by IS NULL OR NEW.decided_by NOT LIKE 'founder:%');
  -- Nothing is acquired that was not approved.
  SELECT RAISE(ABORT,'capability_acquisition:not_approved')
    WHERE NEW.acquired_at IS NOT NULL AND coalesce(NEW.decision,'') <> 'approved';
END;
