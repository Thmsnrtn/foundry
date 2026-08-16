-- Migration 120: responsibility-bound development authority.
--
-- This extends the same consent ledger that already carries responsibility,
-- scope, consequence, expiry, and revocation. There is deliberately no
-- `can_write_code` flag and no separate developer permission system: a broad
-- capability boolean is exactly the shape of authority the constitution
-- forbids.
--
-- Development authority additionally binds the repository, the exact path
-- prefixes, the class of change permitted, and the verification that must be
-- produced. Consent still requires a Shadowing responsibility whose capability
-- matches, the real product owner, a consequence boundary, and a future expiry
-- (migration 112) — none of that is relaxed here.
ALTER TABLE autonomy_consents ADD COLUMN repository_ref TEXT;
ALTER TABLE autonomy_consents ADD COLUMN allowed_path_prefixes_json TEXT;
ALTER TABLE autonomy_consents ADD COLUMN allowed_change_class TEXT;
ALTER TABLE autonomy_consents ADD COLUMN required_verification_json TEXT;

CREATE TRIGGER development_authority_guard
BEFORE INSERT ON autonomy_consents
WHEN NEW.responsibility_id IS NOT NULL AND NEW.capability='development'
BEGIN
  SELECT RAISE(ABORT,'development_authority:repository_required') WHERE
    NEW.repository_ref IS NULL OR trim(NEW.repository_ref)='';

  SELECT RAISE(ABORT,'development_authority:paths_required') WHERE
    NEW.allowed_path_prefixes_json IS NULL OR json_valid(NEW.allowed_path_prefixes_json)=0
    OR json_array_length(NEW.allowed_path_prefixes_json)=0;

  -- Relative, non-escaping prefixes only. A prefix that can climb out of the
  -- repository is not a bound scope.
  SELECT RAISE(ABORT,'development_authority:path_invalid') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.allowed_path_prefixes_json) g
    WHERE trim(g.value)='' OR instr(g.value,'..')>0 OR substr(g.value,1,1)='/'
  );

  -- The constitutional ring. Ordinary development authority may not reach the
  -- code, migrations, documents, or enforcement scripts that define what
  -- Foundry is allowed to do — institutional guards live in migrations, the
  -- governing contract lives in the institution documents and services, and
  -- the ratchets/audits are what make any of it binding.
  --
  -- The check is deny-dominant and bidirectional: a prefix inside the ring is
  -- refused, and so is a broad prefix that would contain part of the ring.
  -- Widening the ring requires a new migration, which is itself inside the
  -- ring, so the boundary cannot be moved by ordinary development authority.
  SELECT RAISE(ABORT,'development_authority:constitutional_scope') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.allowed_path_prefixes_json) g,
                  json_each('["src/db/migrations/","docs/foundry-institution/","scripts/",'
                          ||'"src/services/institution/","src/services/outbound/","AGENTS.md"]') r
    WHERE substr(g.value,1,length(r.value))=r.value OR substr(r.value,1,length(g.value))=g.value
  );

  -- A closed, deliberately small change vocabulary. Broadening it is a
  -- separate owner-governed decision with its own evidence, not something a
  -- grant can invent.
  SELECT RAISE(ABORT,'development_authority:change_class_invalid') WHERE
    NEW.allowed_change_class IS NULL
    OR NEW.allowed_change_class NOT IN ('generated_artifact','test','documentation');

  -- Authority without required verification would let "I changed it" stand in
  -- for "it was independently checked".
  SELECT RAISE(ABORT,'development_authority:verification_required') WHERE
    NEW.required_verification_json IS NULL OR json_valid(NEW.required_verification_json)=0
    OR json_array_length(NEW.required_verification_json)=0;

  -- No high-consequence development authority exists at this evidence level.
  SELECT RAISE(ABORT,'development_authority:consequence_too_broad') WHERE
    NEW.consequence_boundary<>'low';
END;
