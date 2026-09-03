-- =============================================================================
-- COMPUTERS ARE WORKSHOPS, NOT AUTHORITIES
--
-- Private Foundry needs somewhere to physically do autonomous work: build a
-- prototype, run its tests, render its screens, transform a dataset, attack a
-- copy of itself. None of that may run inside the trusted institutional core,
-- and none of it may become a quieter door to the world.
--
-- THE RULE, MADE STRUCTURAL: no execution environment may possess more
-- consequential authority than the institutional task that created it. A
-- workspace is created with a CEILING rung and a purpose; every capability
-- granted into it is checked against that ceiling by the database, and a
-- grant above it is refused - not logged, refused. A workshop authorised to
-- build and test a prototype cannot be handed production, customer data,
-- money, or a customer's inbox by anybody, including the code running inside
-- it. If the work discovers it needs one of those, the request comes back
-- through the same proposed-act door as everything else.
--
-- THE WORKSPACE NEVER HOLDS THE SECRET. A grant names a capability, not a
-- credential; the credential stays with the institution and every consequential
-- call is mediated through the outbound door, which is where the rung is
-- checked. So generated code cannot widen its own access, and revoking a grant
-- is one row, not a key rotation.
--
-- SUBSTRATES ARE PROVIDERS. The reference substrate runs in-process so the
-- whole lifecycle - create, grant, work, checkpoint, sleep, wake, destroy,
-- account - is controlled-proven today. A real computer arrives as another
-- substrate behind the same contract, declared until reality proves it.
-- =============================================================================

CREATE TABLE workspaces (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  -- Why it exists, from the list of things a workshop is for.
  purpose        TEXT NOT NULL CHECK (purpose IN (
                   'venture_development','research','adversarial_test','self_development',
                   'data_work','visual_qa','reference_scenario','dependency_upgrade')),
  -- What it is for: a candidate, a company, or nothing in particular.
  subject_kind   TEXT CHECK (subject_kind IN ('opportunity','company')),
  subject_id     TEXT,
  substrate      TEXT NOT NULL,
  -- THE CEILING. The most consequential rung anything in this workspace may
  -- ever be granted. Set at creation from the task, and immutable: a workshop
  -- does not get promoted, a new one is made.
  ceiling        TEXT NOT NULL REFERENCES consequence_rungs(rung),
  network        TEXT NOT NULL CHECK (network IN ('none','allowlist','open')),
  budget_cents   INTEGER NOT NULL DEFAULT 0,
  spent_cents    INTEGER NOT NULL DEFAULT 0,
  -- The substrate's own handle, once it has one.
  external_ref   TEXT,
  evidence_mode  TEXT NOT NULL CHECK (evidence_mode IN ('real','reference')),
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by     TEXT NOT NULL,
  slept_at       TEXT,
  destroyed_at   TEXT,
  -- What was kept when it went: the evidence, the artefacts, the outcome.
  preserved      TEXT
);

CREATE TRIGGER workspace_guard
BEFORE INSERT ON workspaces
BEGIN
  SELECT RAISE(ABORT,'workspace:incomplete')
    WHERE trim(NEW.substrate) = '' OR trim(NEW.created_by) = '';
  SELECT RAISE(ABORT,'workspace:cannot_arrive_gone')
    WHERE NEW.destroyed_at IS NOT NULL OR NEW.slept_at IS NOT NULL;
  -- A WORKSHOP'S CEILING CANNOT BE THE OWNER'S RUNGS. Legal and destructive
  -- acts are never done from inside a workspace; they are proposed out of it.
  SELECT RAISE(ABORT,'workspace:ceiling_is_the_owners')
    WHERE NEW.ceiling IN ('legal','destructive');
  SELECT RAISE(ABORT,'workspace:budget_cannot_be_negative') WHERE NEW.budget_cents < 0;
END;

CREATE TRIGGER workspace_ceiling_is_immutable
BEFORE UPDATE ON workspaces
BEGIN
  SELECT RAISE(ABORT,'workspace:ceiling_is_immutable') WHERE NEW.ceiling IS NOT OLD.ceiling;
  SELECT RAISE(ABORT,'workspace:immutable')
    WHERE NEW.founder_id IS NOT OLD.founder_id OR NEW.purpose IS NOT OLD.purpose
       OR NEW.substrate IS NOT OLD.substrate OR NEW.evidence_mode IS NOT OLD.evidence_mode;
  SELECT RAISE(ABORT,'workspace:already_destroyed') WHERE OLD.destroyed_at IS NOT NULL;
  SELECT RAISE(ABORT,'workspace:over_budget')
    WHERE NEW.spent_cents > NEW.budget_cents;
  -- Destruction keeps what mattered, or says nothing did.
  SELECT RAISE(ABORT,'workspace:destroy_without_preserving')
    WHERE NEW.destroyed_at IS NOT NULL AND NEW.preserved IS NULL;
END;

-- WHAT A WORKSPACE MAY DO. A capability, not a credential.
CREATE TABLE workspace_grants (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id),
  -- Carried directly so erasure finds it without walking through the workshop.
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  capability_key TEXT NOT NULL REFERENCES capabilities(capability_key),
  granted_by     TEXT NOT NULL,
  granted_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at     TEXT,
  revoked_at     TEXT,
  revoke_reason  TEXT
);

CREATE UNIQUE INDEX idx_workspace_grant_live
  ON workspace_grants(workspace_id, capability_key) WHERE revoked_at IS NULL;

CREATE TRIGGER workspace_grant_guard
BEFORE INSERT ON workspace_grants
BEGIN
  SELECT RAISE(ABORT,'workspace_grant:incomplete') WHERE trim(NEW.granted_by) = '';
  SELECT RAISE(ABORT,'workspace_grant:cannot_arrive_revoked') WHERE NEW.revoked_at IS NOT NULL;
  SELECT RAISE(ABORT,'workspace_grant:workspace_is_gone')
    WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = NEW.workspace_id AND destroyed_at IS NOT NULL);
  -- THE RULE. The capability's rung may not exceed the workspace's ceiling.
  SELECT RAISE(ABORT,'workspace_grant:above_the_ceiling')
    WHERE (SELECT r.sort_order FROM capabilities c JOIN consequence_rungs r ON r.rung = c.rung
            WHERE c.capability_key = NEW.capability_key)
        > (SELECT r.sort_order FROM workspaces w JOIN consequence_rungs r ON r.rung = w.ceiling
            WHERE w.id = NEW.workspace_id);
END;

CREATE TRIGGER workspace_grant_revoke_is_one_way
BEFORE UPDATE ON workspace_grants
BEGIN
  SELECT RAISE(ABORT,'workspace_grant:already_revoked') WHERE OLD.revoked_at IS NOT NULL;
  SELECT RAISE(ABORT,'workspace_grant:immutable')
    WHERE NEW.workspace_id IS NOT OLD.workspace_id OR NEW.capability_key IS NOT OLD.capability_key;
  SELECT RAISE(ABORT,'workspace_grant:revoke_needs_a_reason')
    WHERE NEW.revoked_at IS NOT NULL AND trim(coalesce(NEW.revoke_reason,'')) = '';
END;

-- WHAT HAPPENED IN THERE. Append-only, so a workshop's history is evidence.
CREATE TABLE workspace_events (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id),
  founder_id    TEXT NOT NULL REFERENCES founders(id),
  kind          TEXT NOT NULL CHECK (kind IN (
                  'created','granted','revoked','ran','checkpointed','restored',
                  'refused','slept','woke','destroyed')),
  detail        TEXT NOT NULL,
  cost_cents    INTEGER NOT NULL DEFAULT 0,
  at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER workspace_event_guard
BEFORE INSERT ON workspace_events
BEGIN
  SELECT RAISE(ABORT,'workspace_event:incomplete') WHERE trim(NEW.detail) = '';
  SELECT RAISE(ABORT,'workspace_event:cost_cannot_be_negative') WHERE NEW.cost_cents < 0;
END;
CREATE TRIGGER workspace_event_immutable
BEFORE UPDATE ON workspace_events
BEGIN SELECT RAISE(ABORT,'workspace_event:immutable'); END;

CREATE INDEX idx_workspaces_live ON workspaces(founder_id) WHERE destroyed_at IS NULL;
CREATE INDEX idx_workspace_events_ws ON workspace_events(workspace_id, at);
