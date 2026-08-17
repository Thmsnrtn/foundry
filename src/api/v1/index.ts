// =============================================================================
// FOUNDRY REST API v1 — Main Router
// =============================================================================

import { Hono } from 'hono';
import { apiKeyAuth } from '../middleware/auth.js';
import { apiKeyRateLimit, apiModelRateLimit } from '../../middleware/rate-limit.js';
import { agentsApi } from './agents.js';
import { customersApi } from './customers.js';
import { experimentsApi } from './experiments.js';
import { briefingsApi } from './briefings.js';
import { metricsApi } from './metrics.js';
import { webhooksApi } from './webhooks.js';
import { mcpApi } from './mcp.js';
import type { ApiAuthEnv } from '../middleware/auth.js';

export const apiV1 = new Hono<ApiAuthEnv>();

// Health check — no auth required
apiV1.get('/health', (c) =>
  c.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() })
);

// Apply auth to all other routes
apiV1.use('*', apiKeyAuth);

// Then limit by the CREDENTIAL, not by the source address. `/api/*` carries an
// IP-keyed flood guard, which is right for an unauthenticated request and wrong
// once one carries a key: a single credential rotating addresses was unlimited,
// while many customers behind one NAT shared a budget. This runs after auth
// because that is where the tenant is known.
apiV1.use('*', apiKeyRateLimit);

// Mount sub-routers
apiV1.route('/agents', agentsApi);
apiV1.route('/customers', customersApi);
apiV1.route('/experiments', experimentsApi);
apiV1.route('/briefings', briefingsApi);
apiV1.route('/metrics', metricsApi);
apiV1.route('/webhooks', webhooksApi);
// The MCP transport reaches tools that call a model, so it carries a tighter
// budget on top of the ordinary one. The global AI spend ceiling is a blunt
// instrument: it stops everyone at once when one caller is expensive.
apiV1.use('/mcp/*', apiModelRateLimit);
apiV1.use('/mcp', apiModelRateLimit);
apiV1.route('/mcp', mcpApi);

export default apiV1;
