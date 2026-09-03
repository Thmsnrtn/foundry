-- =============================================================================
-- NEVER SILENTLY ABSORBED, WHICH IS NOT THE SAME AS NEVER DELEGABLE
--
-- Migration 243 wrote that a legal commitment and an irreversible act are the
-- owner's, one at a time, FOREVER. The behaviour was right and the word was
-- wrong: it froze a 2026 implementation into permanent doctrine, and the thing
-- it would have frozen is an owner-attention burden - a recurring, tiny,
-- well-understood legal act arriving in his hands one at a time for years
-- because a column once said it must.
--
-- THE INVARIANT THAT ACTUALLY MATTERS: material legal commitments and genuinely
-- irreversible high-consequence acts may never be SILENTLY ABSORBED INTO
-- ORDINARY AUTONOMOUS AUTHORITY. An allowance, a lifted boundary, a recognised
-- responsibility - the ordinary machinery by which Foundry earns room - must
-- never reach them. That is what `absorbable` means, and it does not change.
--
-- WHAT CHANGES IS THE REASON WHY NOTHING ELSE REACHES THEM EITHER. Today it is
-- because no mechanism exists that could make a narrow delegation appropriate,
-- and `delegable_when` now says what such a mechanism would have to carry:
-- qualified review of the class, an explicit owner policy naming it, narrow
-- scope, bounded economics, evidence it is what it is claimed to be, and
-- revocation. Nothing is weakened here - the code path is unchanged and every
-- legal and destructive act still takes his exact approval - but a later
-- institution can build that mechanism without first having to overturn a
-- constitution that said it was impossible.
-- =============================================================================

DROP TRIGGER consequence_rungs_constitutional_insert;
DROP TRIGGER consequence_rungs_constitutional_update;
DROP TRIGGER consequence_rungs_constitutional_delete;

ALTER TABLE consequence_rungs ADD COLUMN delegable_when TEXT NOT NULL DEFAULT '';

UPDATE consequence_rungs SET delegable_when =
  'ordinary standing policy covers this: an allowance, a lifted boundary, or a '
  || 'responsibility Foundry has been recognised for'
 WHERE absorbable = 1;

UPDATE consequence_rungs SET delegable_when =
  'never by ordinary standing policy. A narrow delegation of a specific class '
  || 'could only ever be appropriate if all of these held at once: a qualified '
  || 'person reviewed the class, the owner set an explicit policy naming it, the '
  || 'scope was narrow, the economics were bounded, there was evidence each act '
  || 'is what it claims to be, and he could revoke it. No such mechanism exists, '
  || 'so today every one of these is his, one at a time.'
 WHERE absorbable = 0;

CREATE TRIGGER consequence_rungs_constitutional_insert BEFORE INSERT ON consequence_rungs
BEGIN SELECT RAISE(ABORT,'consequence_rung:constitutional'); END;
CREATE TRIGGER consequence_rungs_constitutional_update BEFORE UPDATE ON consequence_rungs
BEGIN SELECT RAISE(ABORT,'consequence_rung:constitutional'); END;
CREATE TRIGGER consequence_rungs_constitutional_delete BEFORE DELETE ON consequence_rungs
BEGIN SELECT RAISE(ABORT,'consequence_rung:constitutional'); END;

-- =============================================================================
-- A SUBSTRATE THAT RUNS CODE ON THE INSTITUTION'S OWN HOST IS NOT A SANDBOX
--
-- The workshop tables governed WHAT a workspace may be granted. They said
-- nothing about WHERE it runs, and the owner's rule is about exactly that:
-- generated venture work must not execute inside the trusted institutional
-- core. Until now that was a sentence in a comment, which is the weakest
-- possible enforcement of a security boundary.
--
-- The honest axis is not "real versus rehearsal". It is: does this substrate
-- EXECUTE anything, and if so, does it execute somewhere the institution is
-- not? Three answers, and each is a different kind of safe:
--
--   executes_nothing  a rehearsal substrate that only remembers files. Proves
--                     the lifecycle; proves nothing about running code.
--   same_host         a real computer, real commands, real cost - and the same
--                     machine the institution runs on. Trustworthy ONLY for
--                     work the institution itself authored.
--   isolated          a computer the institution is not on.
--
-- And the rule, enforced rather than described: a workspace whose purpose is to
-- run code Foundry did not write may not use a substrate that executes on
-- Foundry's own host.
-- =============================================================================

CREATE TABLE workspace_substrates (
  substrate   TEXT PRIMARY KEY,
  isolation   TEXT NOT NULL CHECK (isolation IN ('executes_nothing','same_host','isolated')),
  what_it_is  TEXT NOT NULL,
  sort_order  INTEGER NOT NULL
);

INSERT INTO workspace_substrates (substrate, isolation, what_it_is, sort_order) VALUES
  ('reference_world', 'executes_nothing',
   'an in-process rehearsal that remembers files and runs nothing', 1),
  ('local_process', 'same_host',
   'a real directory and real commands, on the machine Foundry itself runs on', 2),
  ('fly_machines', 'isolated', 'a machine Foundry is not on', 3),
  ('fly_sprites', 'isolated', 'a machine Foundry is not on', 4);

CREATE TRIGGER workspace_substrates_constitutional_insert
BEFORE INSERT ON workspace_substrates
BEGIN SELECT RAISE(ABORT,'workspace_substrate:constitutional'); END;
CREATE TRIGGER workspace_substrates_constitutional_update
BEFORE UPDATE ON workspace_substrates
BEGIN SELECT RAISE(ABORT,'workspace_substrate:constitutional'); END;
CREATE TRIGGER workspace_substrates_constitutional_delete
BEFORE DELETE ON workspace_substrates
BEGIN SELECT RAISE(ABORT,'workspace_substrate:constitutional'); END;

-- The purposes whose whole point is running code the institution did not write.
CREATE TRIGGER workspace_untrusted_code_needs_isolation
BEFORE INSERT ON workspaces
BEGIN
  SELECT RAISE(ABORT,'workspace:unknown_substrate')
    WHERE NOT EXISTS (SELECT 1 FROM workspace_substrates WHERE substrate = NEW.substrate);
  SELECT RAISE(ABORT,'workspace:untrusted_code_needs_isolation')
    WHERE NEW.purpose IN ('venture_development','dependency_upgrade','adversarial_test')
      AND (SELECT isolation FROM workspace_substrates WHERE substrate = NEW.substrate)
          = 'same_host';
END;
