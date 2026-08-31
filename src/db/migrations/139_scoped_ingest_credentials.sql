-- Migration 139: ingest credentials that carry their own purpose.
--
-- THE DEFECT THIS CLOSES. Three public intake routes authenticated against the
-- SAME product-wide secret, `products.ingest_token`:
--
--   POST /ingest/:token                  post readings
--   POST /ingest/company-report/:token   raise a responsibility at Visible
--   POST /ingest/effect-outcome/:token   say whether an effect achieved its intent
--
-- That token is shown on the settings page as the thing you give to Stripe, to
-- Zapier, to a cron job — a credential for POSTING NUMBERS. Handing it to an
-- analytics tool also handed that tool the ability to raise work and, worse, to
-- declare that any executed effect succeeded.
--
-- WHY THE THIRD ONE IS THE SERIOUS ONE. An outcome report is the only evidence
-- that can move an effect off `unresolved`, and it flows into a learned claim
-- and out of the founder's "did this work?" list. Migration 137 refuses reports
-- attributed to the institution, precisely because a system that can declare
-- its own success has no outcome layer. A metrics integration is not the
-- institution, so it passed that check — while being no better placed than
-- Foundry to know whether anybody actually turned up.
--
-- This is the recurring defect of this codebase in a new dress: a general
-- mechanism (one shared credential) bound to a widening consequence. It is also
-- the exact inverse of the rule the constitution applies everywhere else —
-- authority must be NARROWER than the credential you already hold, never a
-- side effect of it.
--
-- WHAT THIS ADDS. A credential names, at mint time, which intakes it may use.
-- The set is closed and held here, so it cannot be widened at runtime by a
-- service, a company, an integration, or a model. Purposes are immutable: a
-- credential is not upgraded, it is revoked and a new one is minted, so the
-- record of what a given secret was ever allowed to do stays true.
--
-- WHAT THIS DELIBERATELY DOES NOT ADD. No permission model, no roles, no
-- hierarchy. Three named intakes and a subset. Every one of them still records
-- evidence and still grants nothing: a scoped credential narrows who may SAY
-- something, and says nothing about what follows from having said it.
--
-- `support_channels` already had the right shape — a per-channel key bound to
-- one responsibility — and is untouched. This gives the other three the same
-- treatment rather than inventing a second scheme beside it.
CREATE TABLE ingest_credentials (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  -- The founder's own words for which system holds this.
  label         TEXT NOT NULL,
  secret        TEXT NOT NULL UNIQUE,
  -- JSON array from the closed set below. Immutable after minting.
  purposes_json TEXT NOT NULL,
  -- The canonical evidence that the founder issued this, and to whom.
  evidence_signal_id TEXT NOT NULL,
  revoked_at    TEXT,
  last_used_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ingest_credentials_product ON ingest_credentials(product_id, revoked_at);

CREATE TRIGGER ingest_credential_guard
BEFORE INSERT ON ingest_credentials
BEGIN
  -- Every predicate coalesces its absence. A guard whose condition evaluates to
  -- NULL never fires, which is how missing values have repeatedly walked past
  -- guards in this schema.

  SELECT RAISE(ABORT,'ingest_credential:label_invalid')
  WHERE trim(COALESCE(NEW.label,''))=''
     OR length(COALESCE(NEW.label,'')) > 80;

  -- The secret is the whole of the authentication, so its floor is set here and
  -- not left to whichever service happens to mint it.
  SELECT RAISE(ABORT,'ingest_credential:secret_weak')
  WHERE length(COALESCE(NEW.secret,'')) < 32
     OR COALESCE(NEW.secret,'') NOT GLOB '[A-Za-z0-9_-]*';

  SELECT RAISE(ABORT,'ingest_credential:purposes_invalid')
  WHERE COALESCE(json_valid(NEW.purposes_json),0)=0
     OR COALESCE(json_type(NEW.purposes_json,'$'),'absent') <> 'array'
     OR COALESCE(json_array_length(NEW.purposes_json),0)=0
     OR COALESCE(json_array_length(NEW.purposes_json),0) > 3;

  -- The closed vocabulary. A purpose exists here only when a route actually
  -- honours it; this is a list of intakes that exist, not of intakes anyone
  -- would like. Widening it is a migration and a review, exactly as adding a
  -- governed effect kind is.
  SELECT RAISE(ABORT,'ingest_credential:purpose_unknown') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.purposes_json)
     WHERE COALESCE(json_each.value,'') NOT IN ('metrics','company_report','effect_outcome'));

  -- Issuing a credential is a founder assertion and must carry provenance, and
  -- the evidence must be this company's own — a credential justified by another
  -- tenant's signal would be an attribution leak in both directions.
  SELECT RAISE(ABORT,'ingest_credential:evidence_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM signal_events e
     WHERE e.id=NEW.evidence_signal_id AND e.product_id=NEW.product_id);
END;

-- A credential is never upgraded in place. If purposes could be edited, the
-- answer to "what was this secret ever allowed to do?" would be whatever the
-- row says today, and every past request would be re-described by the present.
-- Revoking and minting again is the supported path, and it leaves both records
-- intact. `revoked_at` and `last_used_at` are the only mutable fields.
CREATE TRIGGER ingest_credential_immutable
BEFORE UPDATE ON ingest_credentials
WHEN COALESCE(OLD.product_id,'')    <> COALESCE(NEW.product_id,'')
  OR COALESCE(OLD.secret,'')        <> COALESCE(NEW.secret,'')
  OR COALESCE(OLD.purposes_json,'') <> COALESCE(NEW.purposes_json,'')
  OR COALESCE(OLD.evidence_signal_id,'') <> COALESCE(NEW.evidence_signal_id,'')
BEGIN
  SELECT RAISE(ABORT,'ingest_credential:immutable');
END;
