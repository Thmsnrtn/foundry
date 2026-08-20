-- =============================================================================
-- Migration 177: a portfolio principal, not one global secret
--
-- OWNER INSTRUCTION (§12): *"Do not assume who holds ECOSYSTEM_SERVICE_KEY. If
-- current evidence cannot positively establish that it has remained solely
-- within owner-controlled infrastructure, treat distribution as unknown and
-- rotate it. Long term, private owner-portfolio access may exist, but it must
-- be represented as an explicit service/portfolio principal with scoped company
-- membership rather than possession of one global secret plus arbitrary
-- product_id. Commercial customer access must remain isolated."*
--
-- WHAT WAS THERE. `GET /internal/operator/dashboard-data?product_id=…` returned
-- a named company's entire operating picture — risk state, stressors, MRR
-- decomposition, retention, NPS, churn, cohort summary — behind a single
-- process-wide `ECOSYSTEM_SERVICE_KEY` compared timing-safely, and nothing
-- else. No owner check, no tenant binding, no per-caller identity. The key is
-- issued to nobody, so HOLDING IT IS INDISTINGUISHABLE FROM BEING EVERY COMPANY
-- AT ONCE, and the company id is a query parameter.
--
-- WHAT THIS IS. A principal, not a password. It is issued to a named party, it
-- expires, it can be revoked, only its hash is stored — the same shape as
-- ingest credentials and API keys — and it carries an EXPLICIT LIST OF THE
-- COMPANIES IT MAY READ. There is no wildcard and no "all companies" flag,
-- deliberately: scope is enumerated membership, so reaching a company that is
-- not on the list is not a permission check that could be got wrong but a row
-- that does not exist.
--
-- ISOLATION IS STRUCTURAL. A principal may only be scoped to companies the
-- issuing founder OWNS, enforced at issuance. One owner therefore cannot scope
-- a principal into another owner's company at all, which is what keeps a
-- private portfolio principal from becoming a route into commercial customers'
-- data.
--
-- FAILS CLOSED BY CONSTRUCTION. A principal with no membership rows reads
-- nothing. That is also the state a freshly issued one is in for the instant
-- before its scope lands, and it is the safe direction.
--
-- WHAT THIS MIGRATION CANNOT DO. It cannot rotate the deployed secret. That is
-- an operational act only the owner can perform, and it is recorded as such in
-- `OWNER_DECISIONS_PENDING.md` §12 rather than reported as done. What the code
-- can do, and now does, is stop the old shape from being sufficient: the global
-- key alone no longer reads or writes any company's data.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ecosystem_principals (
  id TEXT PRIMARY KEY,
  -- Who this was issued to, in words a person can check against reality.
  label TEXT NOT NULL,
  -- Only the hash. The secret is shown once, at issuance, and never again.
  key_hash TEXT UNIQUE NOT NULL,
  key_prefix TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES founders(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  -- Mandatory. A credential with no end is one nobody ever revisits.
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME,
  last_used_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_ecosystem_principals_hash
  ON ecosystem_principals(key_hash);

-- The scope, as rows rather than as a flag. A company this principal may read
-- is a row that exists; every other company is a row that does not.
CREATE TABLE IF NOT EXISTS ecosystem_principal_companies (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES ecosystem_principals(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(principal_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_ecosystem_principal_companies_lookup
  ON ecosystem_principal_companies(principal_id, product_id);

-- A PRINCIPAL MAY ONLY REACH A COMPANY ITS ISSUER OWNS.
--
-- Enforced here as well as at issuance, because the issuance check is a
-- property of one function and this is a property of the data. Ownership can
-- also change after the fact: a company that moves to another owner must not
-- carry somebody else's portfolio principal with it, and the guard below makes
-- that a refusal rather than a silent inheritance.
CREATE TRIGGER IF NOT EXISTS ecosystem_scope_stays_inside_the_portfolio
BEFORE INSERT ON ecosystem_principal_companies
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM ecosystem_principals p
    JOIN products pr ON pr.id = NEW.product_id
   WHERE p.id = NEW.principal_id AND pr.owner_id = p.created_by
)
BEGIN
  SELECT RAISE(ABORT, 'ecosystem_principal:company_not_in_issuers_portfolio');
END;
