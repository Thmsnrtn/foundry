-- =============================================================================
-- Migration 095: api_keys.expires_at (security close-out 2026-07-13)
--
-- Root cause of the dead API-key surface: 006 created api_keys, 024's richer
-- redefinition was a no-op (IF NOT EXISTS), and 085 back-filled product_id/
-- role/scopes/created_by but MISSED expires_at. validateApiKey selects
-- expires_at, so every call threw SQLITE_ERROR → every consumer's catch
-- returned null → every legitimate API key 401'd (voice-reply, transcripts,
-- mobile, platform). One column, four dead endpoints. NULL = never expires.
-- =============================================================================

ALTER TABLE api_keys ADD COLUMN expires_at TEXT;
