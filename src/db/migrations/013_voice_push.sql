-- =============================================================================
-- FOUNDRY — Migration 013: Voice Interface + Push Notifications + Webhooks
-- Morning briefings, voice-captured decisions, push subscriptions,
-- Slack webhooks, and outbound webhook delivery.
-- =============================================================================

-- Voice sessions: daily morning briefing + any voice-captured updates.
CREATE TABLE IF NOT EXISTS voice_sessions (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  founder_id TEXT NOT NULL REFERENCES founders(id),
  session_date TEXT NOT NULL,          -- YYYY-MM-DD
  -- Briefing generated for this session
  briefing_text TEXT,                  -- Full spoken briefing text
  briefing_headline TEXT,              -- ≤120 char hook sentence
  signal_at_briefing INTEGER,
  risk_state_at_briefing TEXT,
  -- Voice input processing
  transcript TEXT,                     -- Raw transcript from STT
  structured_updates TEXT,             -- JSON: [{type, data}] extracted from transcript
  decisions_created TEXT,              -- JSON: decision_id[] created from voice
  stressors_updated TEXT,              -- JSON: stressor_id[] updated from voice
  metrics_updated TEXT,                -- JSON: {field: value} from voice
  -- Meta
  duration_seconds INTEGER,
  model_used TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, session_date)
);

CREATE INDEX IF NOT EXISTS idx_voice_sessions_product ON voice_sessions(product_id, session_date DESC);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_founder ON voice_sessions(founder_id);

-- Push notification subscriptions (Web Push API + iOS APNs).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL REFERENCES founders(id),
  -- Web Push
  endpoint TEXT UNIQUE,
  p256dh TEXT,                         -- client public key
  auth TEXT,                           -- auth secret
  -- APNs (iOS)
  apns_device_token TEXT,
  apns_bundle_id TEXT,
  -- Shared
  platform TEXT CHECK(platform IN ('web', 'ios', 'android')),
  user_agent TEXT,
  -- Preferences
  notify_risk_state_change BOOLEAN DEFAULT TRUE,
  notify_critical_stressor BOOLEAN DEFAULT TRUE,
  notify_decision_deadline BOOLEAN DEFAULT TRUE,
  notify_daily_briefing BOOLEAN DEFAULT TRUE,
  notify_milestone BOOLEAN DEFAULT TRUE,
  notify_integration_error BOOLEAN DEFAULT TRUE,
  notify_weekly_digest BOOLEAN DEFAULT FALSE,
  -- State
  last_delivered_at DATETIME,
  failure_count INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT TRUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_founder ON push_subscriptions(founder_id, active);

-- Push notification log: every notification sent and its delivery status.
CREATE TABLE IF NOT EXISTS push_log (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL REFERENCES founders(id),
  product_id TEXT REFERENCES products(id),
  subscription_id TEXT REFERENCES push_subscriptions(id),
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data TEXT,                           -- JSON: deep-link payload
  status TEXT CHECK(status IN ('sent', 'delivered', 'failed', 'clicked')),
  error TEXT,
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  delivered_at DATETIME,
  clicked_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_push_log_founder ON push_log(founder_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_push_log_type ON push_log(notification_type, sent_at DESC);

-- Slack integrations at the founder level (not product level).
-- One Slack workspace can receive notifications from all products.
CREATE TABLE IF NOT EXISTS slack_integrations (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL REFERENCES founders(id),
  workspace_name TEXT,
  team_id TEXT,
  channel_id TEXT,
  channel_name TEXT,
  bot_token TEXT,                      -- encrypted
  notify_risk_state_change BOOLEAN DEFAULT TRUE,
  notify_critical_stressor BOOLEAN DEFAULT TRUE,
  notify_decision_deadline BOOLEAN DEFAULT TRUE,
  notify_weekly_digest BOOLEAN DEFAULT TRUE,
  notify_milestone BOOLEAN DEFAULT TRUE,
  active BOOLEAN DEFAULT TRUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(founder_id)
);

CREATE INDEX IF NOT EXISTS idx_slack_integrations_founder ON slack_integrations(founder_id);

-- Outbound webhooks: generic HTTP webhooks for Zapier, Make, etc.
CREATE TABLE IF NOT EXISTS outbound_webhooks (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret TEXT,                         -- HMAC signing secret
  events TEXT NOT NULL,                -- JSON: string[] of event types
  active BOOLEAN DEFAULT TRUE,
  failure_count INTEGER DEFAULT 0,
  last_delivered_at DATETIME,
  last_error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_outbound_webhooks_product ON outbound_webhooks(product_id, active);
