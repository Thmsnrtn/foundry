-- =============================================================================
-- GITHUB CANNOT BE READ-ONLY, AND THE DISCLOSURE SAID IT COULD
--
-- Found while writing the GitHub adapter, which is the right time to find it.
--
-- Migration 226 declared, for the `software` sense: "a token with write scope
-- could push; Foundry asks for read scope, and changing code is a separate
-- permission it has to earn." That sentence is what the owner would have been
-- shown at the moment he decided. It is not true.
--
-- GitHub's OAuth APP scopes have no read-only option for repository contents.
-- `repo` is full control of private repositories and includes push. There is no
-- `repo:read`. So an OAuth connection made to let Foundry UNDERSTAND software
-- would necessarily hand over the ability to change it — which is the exact
-- thing "a sense is not a hand" exists to prevent, and it would have been
-- handed over under a disclosure saying the opposite.
--
-- WHAT THIS MIGRATION DOES. It tells the truth in the constitutional tables:
-- the `software` sense keeps its declared scope requirement, GitHub's entry
-- says plainly what an OAuth app would really hand over, and the scope row that
-- claimed `repo:read` — a scope that does not exist — is removed. With no scope
-- it can honestly request, `beginAuthorization` refuses, and the owner is told
-- Foundry cannot ask GitHub for permission yet rather than being asked to grant
-- push access in order to have his code read.
--
-- WHAT WOULD FIX IT, recorded so the next person does not rediscover it: a
-- GitHub APP installation, whose fine-grained permissions do include
-- `contents: read`. That is a different flow — installation ids, a signed JWT,
-- short-lived installation tokens — and it is the honest way to read a
-- repository without being able to write to it. Until it exists, this sense
-- stays unconnectable, which is the correct state rather than a gap.
--
-- THE VOCABULARIES ARE IMMUTABLE AT RUNTIME, which is the point of them, so
-- correcting one is a migration and a conversation. That is exactly the cost it
-- should have.
-- =============================================================================

DROP TRIGGER sense_providers_constitutional_update;
DROP TRIGGER sense_providers_constitutional_delete;
DROP TRIGGER sense_providers_constitutional_insert;

UPDATE sense_providers
   SET hands_over =
     'an OAuth app cannot read a repository without also being able to push to '
     || 'it — GitHub has no read-only repository scope — so I will not ask you '
     || 'for one. Reading code needs a GitHub App installation, which can be '
     || 'granted read-only, and I cannot do that yet'
 WHERE provider = 'github' AND sense_key = 'software';

CREATE TRIGGER sense_providers_constitutional_insert BEFORE INSERT ON sense_providers
BEGIN SELECT RAISE(ABORT,'sense_provider:constitutional'); END;
CREATE TRIGGER sense_providers_constitutional_update BEFORE UPDATE ON sense_providers
BEGIN SELECT RAISE(ABORT,'sense_provider:constitutional'); END;
CREATE TRIGGER sense_providers_constitutional_delete BEFORE DELETE ON sense_providers
BEGIN SELECT RAISE(ABORT,'sense_provider:constitutional'); END;

-- The scope that does not exist, removed. Nothing may request it because
-- nothing can honestly be granted it.
DROP TRIGGER sense_provider_scopes_constitutional_update;
DROP TRIGGER sense_provider_scopes_constitutional_delete;
DROP TRIGGER sense_provider_scopes_constitutional_insert;

DELETE FROM sense_provider_scopes
 WHERE provider = 'github' AND sense_key = 'software' AND scope = 'repo:read';

CREATE TRIGGER sense_provider_scopes_constitutional_insert
BEFORE INSERT ON sense_provider_scopes
BEGIN SELECT RAISE(ABORT,'sense_scope:constitutional'); END;
CREATE TRIGGER sense_provider_scopes_constitutional_update
BEFORE UPDATE ON sense_provider_scopes
BEGIN SELECT RAISE(ABORT,'sense_scope:constitutional'); END;
CREATE TRIGGER sense_provider_scopes_constitutional_delete
BEFORE DELETE ON sense_provider_scopes
BEGIN SELECT RAISE(ABORT,'sense_scope:constitutional'); END;
