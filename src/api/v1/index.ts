// =============================================================================
// FOUNDRY REST API v1 — Main Router
// =============================================================================

import { Hono } from 'hono';
import { apiKeyAuth } from '../middleware/auth.js';
import { agentsApi } from './agents.js';
import { customersApi } from './customers.js';
import { experimentsApi } from './experiments.js';
import { briefingsApi } from './briefings.js';
import { metricsApi } from './metrics.js';
import { webhooksApi } from './webhooks.js';
import type { ApiAuthEnv } from '../middleware/auth.js';

export const apiV1 = new Hono<ApiAuthEnv>();

// Health check — no auth required
apiV1.get('/health', (c) =>
  c.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() })
);

// Apply auth to all other routes
apiV1.use('*', apiKeyAuth);

// Mount sub-routers
apiV1.route('/agents', agentsApi);
apiV1.route('/customers', customersApi);
apiV1.route('/experiments', experimentsApi);
apiV1.route('/briefings', briefingsApi);
apiV1.route('/metrics', metricsApi);
apiV1.route('/webhooks', webhooksApi);

export default apiV1;
