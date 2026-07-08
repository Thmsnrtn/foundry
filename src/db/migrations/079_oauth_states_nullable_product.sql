-- =============================================================================
-- Migration 079: oauth_states.product_id nullable, no FK (walkthrough finding)
--
-- oauth_states.product_id was `NOT NULL REFERENCES products(id)`, but the GitHub
-- onboarding flow creates a state row BEFORE any product exists (it inserts
-- product_id='pending'). Wherever foreign keys are enforced this violates the
-- FK and 500s `GET /onboarding` — the flagship first screen. oauth_states is a
-- transient table (10-minute expiry), so rebuild it with a nullable,
-- unconstrained product_id. Rebuild (not ALTER) because SQLite can't drop a
-- column FK in place.
-- =============================================================================

PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS oauth_states_new (
  state TEXT PRIMARY KEY,
  product_id TEXT,                     -- nullable, no FK: created pre-product during onboarding
  founder_id TEXT NOT NULL,
  integration_type TEXT NOT NULL,
  redirect_uri TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL
);

INSERT INTO oauth_states_new (state, product_id, founder_id, integration_type, redirect_uri, created_at, expires_at)
  SELECT state, product_id, founder_id, integration_type, redirect_uri, created_at, expires_at FROM oauth_states;

DROP TABLE oauth_states;
ALTER TABLE oauth_states_new RENAME TO oauth_states;

PRAGMA foreign_keys=ON;
