-- =============================================================================
-- FOUNDRY — Migration 008: External Integrations
-- Native connections to Stripe, PostHog, Intercom, Linear, Slack, Mixpanel,
-- Amplitude, App Store Connect. Enables real-time metric ingestion and
-- Signal updates within 60 seconds of an external event.
-- =============================================================================

-- Integration configurations per product.
-- credentials_json is encrypted at rest in production.
CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN (
    'stripe', 'posthog', 'intercom', 'linear',
    'slack', 'mixpanel', 'amplitude', 'app_store_connect', 'github_app'
  )),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
    'pending', 'active', 'error', 'paused', 'revoked'
  )),
  credentials_json TEXT,  -- JSON: {access_token?, refresh_token?, api_key?, webhook_secret?}
  config_json TEXT,       -- JSON: {sync_fields?, event_names?, project_id?, account_id?}
  last_synced_at DATETIME,
  last_error TEXT,
  sync_cursor TEXT,       -- pagination cursor / last event ID for incremental sync
  records_synced_total INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, type)
);

CREATE INDEX IF NOT EXISTS idx_integrations_product ON integrations(product_id);
CREATE INDEX IF NOT EXISTS idx_integrations_status ON integrations(product_id, status);
CREATE INDEX IF NOT EXISTS idx_integrations_type_active ON integrations(type, status);

-- One entry per sync run. Enables debugging and monitoring.
CREATE TABLE IF NOT EXISTS integration_sync_log (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  started_at DATETIME NOT NULL,
  completed_at DATETIME,
  status TEXT CHECK(status IN ('running', 'success', 'partial', 'failed')),
  records_processed INTEGER DEFAULT 0,
  metrics_updated TEXT,  -- JSON: array of column names updated in metric_snapshots
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_log_integration ON integration_sync_log(integration_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_log_product ON integration_sync_log(product_id, started_at DESC);

-- OAuth state for PKCE/state-param verification during OAuth flows.
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  founder_id TEXT NOT NULL REFERENCES founders(id),
  integration_type TEXT NOT NULL,
  redirect_uri TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at);
