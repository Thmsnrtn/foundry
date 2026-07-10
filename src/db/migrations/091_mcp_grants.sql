-- =============================================================================
-- Migration 091: MCP tool grants (Trust Plane phase 2 / Trust Law)
--
-- Foundry's agents reach ANY MCP server the founder connects (server configs
-- live on the canonical integrations table: provider='mcp', name=<server>,
-- config={url}, credentials=<encrypted bearer>). But reach is not license:
-- every outbound MCP tool call must be covered by a GRANT — the AcreOS
-- witness-grant generalized: founder-issued, tool-scoped, call-capped,
-- expiring, instantly revocable. No grant, no call.
-- =============================================================================

CREATE TABLE IF NOT EXISTS mcp_grants (
  id           TEXT PRIMARY KEY,
  product_id   TEXT NOT NULL,
  server_name  TEXT NOT NULL,               -- integrations.name of the MCP server
  tool_pattern TEXT NOT NULL,               -- exact tool name, or '*' for any on this server
  max_calls    INTEGER NOT NULL DEFAULT 25, -- hard cap for the grant's lifetime
  calls_used   INTEGER NOT NULL DEFAULT 0,
  expires_at   DATETIME NOT NULL,
  created_by   TEXT NOT NULL,               -- founder id
  revoked_at   DATETIME,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mcp_grants_lookup ON mcp_grants(product_id, server_name, revoked_at);
