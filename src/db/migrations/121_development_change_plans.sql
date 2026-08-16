-- Migration 121: bounded development change plans.
--
-- Abstraction audit: `outbound_actions` was considered and rejected. It models
-- provider-directed effects — integration name, provider acknowledgement,
-- ambiguity, reconciliation windows. A repository change has no provider, no
-- acknowledgement ambiguity, and nothing to reconcile; it has content
-- identity, a rollback path, and state that can simply be re-read. Reusing it
-- would have required inventing an integration name and would have made both
-- the assisted-email plan guard and the consequential-effect inventory less
-- true rather than more.
--
-- The ladder this ledger must never collapse:
--   plan         != execution
--   execution    != verification
--   verification != outcome
--   outcome      != authority
CREATE TABLE development_change_plans (
  id                    TEXT PRIMARY KEY,
  product_id            TEXT NOT NULL,
  responsibility_id     TEXT NOT NULL REFERENCES institutional_responsibilities(id),
  authority_consent_id  TEXT NOT NULL REFERENCES autonomy_consents(id),
  change_id             TEXT NOT NULL,
  repository_ref        TEXT NOT NULL,
  target_path           TEXT NOT NULL,
  change_class          TEXT NOT NULL,
  content_digest        TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'planned'
                          CHECK (status IN ('planned','claimed','applied','already_applied','refused','rolled_back')),
  refused_reason        TEXT,
  applied_at            TEXT,
  prior_existed         INTEGER,
  prior_content_digest  TEXT,
  -- Did the bytes actually on disk match what was intended? Never inferred
  -- from the fact that a write returned without throwing.
  diff_verified         INTEGER,
  verification_status   TEXT CHECK (verification_status IN ('passed','failed','unresolved')),
  verification_evidence_json TEXT,
  outcome_status        TEXT CHECK (outcome_status IN ('verified_success','verified_failure','unresolved')),
  learned_claim_id      TEXT REFERENCES reconstruction_claims(id),
  created_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Replay protection: one change identity is one plan, per product.
CREATE UNIQUE INDEX idx_development_change_identity ON development_change_plans(product_id,change_id);
CREATE INDEX idx_development_change_responsibility ON development_change_plans(product_id,responsibility_id,created_at);

CREATE TRIGGER development_change_plan_guard
BEFORE INSERT ON development_change_plans
BEGIN
  -- Planning requires an Assisting development responsibility whose authority
  -- reference is exactly this consent, and a consent that is currently valid,
  -- responsibility-bound, and low consequence.
  SELECT RAISE(ABORT,'development_change:binding_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM institutional_responsibilities r
    JOIN autonomy_consents a ON a.id=NEW.authority_consent_id
    WHERE r.id=NEW.responsibility_id AND r.product_id=NEW.product_id
      AND r.state='assisting' AND r.capability='development'
      AND r.authority_ref='autonomy_consent:' || a.id
      AND a.product_id=NEW.product_id AND a.responsibility_id=r.id
      AND a.capability='development' AND a.to_mode='act'
      AND a.revoked_at IS NULL AND datetime(a.expires_at)>datetime('now')
      AND a.consequence_boundary='low'
      AND a.repository_ref=NEW.repository_ref
      AND a.allowed_change_class=NEW.change_class
  );

  -- The target must fall inside a granted prefix.
  SELECT RAISE(ABORT,'development_change:scope_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM autonomy_consents a, json_each(a.allowed_path_prefixes_json) p
    WHERE a.id=NEW.authority_consent_id
      AND substr(NEW.target_path,1,length(p.value))=p.value
  );

  -- And deny dominates: the constitutional ring is refused here too, so a
  -- grant that somehow held a ring path could still never be planned against.
  SELECT RAISE(ABORT,'development_change:constitutional_path') WHERE
    instr(NEW.target_path,'..')>0 OR substr(NEW.target_path,1,1)='/' OR EXISTS (
      SELECT 1 FROM json_each('["src/db/migrations/","docs/foundry-institution/","scripts/",'
                            ||'"src/services/institution/","src/services/outbound/","AGENTS.md"]') r
      WHERE substr(NEW.target_path,1,length(r.value))=r.value
    );
END;

CREATE TRIGGER development_change_plan_immutable_binding
BEFORE UPDATE ON development_change_plans
BEGIN
  -- Progress may be recorded; what was authorized may not be rewritten.
  SELECT RAISE(ABORT,'development_change:binding_immutable') WHERE
    NEW.product_id<>OLD.product_id OR NEW.responsibility_id<>OLD.responsibility_id
    OR NEW.authority_consent_id<>OLD.authority_consent_id OR NEW.change_id<>OLD.change_id
    OR NEW.repository_ref<>OLD.repository_ref OR NEW.target_path<>OLD.target_path
    OR NEW.change_class<>OLD.change_class OR NEW.content_digest<>OLD.content_digest;

  -- A verified outcome requires BOTH independent verification and proof that
  -- the bytes on disk are the bytes that were authorized. Passing checks alone
  -- are not a verified outcome, and neither is a successful write.
  SELECT RAISE(ABORT,'development_change:outcome_unsupported') WHERE
    NEW.outcome_status='verified_success'
    AND (NEW.verification_status IS NOT 'passed' OR NEW.diff_verified IS NOT 1
         OR NEW.status NOT IN ('applied','already_applied'));
END;
