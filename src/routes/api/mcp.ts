// =============================================================================
// FOUNDRY — MCP HTTP Bridge
// Exposes MCP tools over HTTP for remote access from coding tools.
// Authenticated via API key (same as v1 API).
// =============================================================================

import { Hono } from 'hono';
import type { ApiKeyEnv } from '../../middleware/api-key.js';
import { apiKeyAuth } from '../../middleware/api-key.js';
import { FOUNDRY_TOOLS, executeTool } from '../../mcp/server.js';
import { query, getProductsByOwner } from '../../db/client.js';

export const mcpRoutes = new Hono<ApiKeyEnv>();

// Auth required for all MCP endpoints
mcpRoutes.use('*', apiKeyAuth);

/**
 * List available MCP tools.
 * GET /mcp/tools
 */
mcpRoutes.get('/mcp/tools', async (c) => {
  return c.json({
    tools: FOUNDRY_TOOLS,
    description: 'Foundry MCP Server — connect your coding tool to your business intelligence.',
    setup_instructions: {
      claude_code: 'Add to .claude/settings.json: { "mcpServers": { "foundry": { "type": "url", "url": "https://foundry.dev/mcp", "headers": { "Authorization": "Bearer fnd_YOUR_API_KEY" } } } }',
      cursor: 'Add to MCP settings with the same URL and Authorization header.',
    },
  });
});

/**
 * Execute an MCP tool.
 * POST /mcp/call
 * Body: { "tool": "foundry_health_score", "arguments": { "product_id": "..." } }
 */
mcpRoutes.post('/mcp/call', async (c) => {
  const body = await c.req.json() as { tool: string; arguments: Record<string, string> };

  if (!body.tool) return c.json({ error: 'tool is required' }, 400);
  if (!body.arguments) return c.json({ error: 'arguments is required' }, 400);

  // Verify the product belongs to this API key's founder
  const founder = c.get('founder');
  if (body.arguments.product_id) {
    const products = await getProductsByOwner(founder.id);
    const owned = products.rows.some((p) => (p as Record<string, string>).id === body.arguments.product_id);
    if (!owned) return c.json({ error: 'Product not found' }, 404);
  }

  const result = await executeTool(body.tool, body.arguments);
  return c.json(result);
});

/**
 * Get product list (helper for tool configuration).
 * GET /mcp/products
 */
mcpRoutes.get('/mcp/products', async (c) => {
  const founder = c.get('founder');
  const products = await getProductsByOwner(founder.id);
  return c.json({
    products: products.rows.map((p) => {
      const r = p as Record<string, string>;
      return { id: r.id, name: r.name };
    }),
  });
});
