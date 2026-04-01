// =============================================================================
// FOUNDRY — API Key Authentication Middleware
// Validates Bearer API keys for the external REST API v1.
// =============================================================================

import { createMiddleware } from 'hono/factory';
import { validateApiKey } from '../../services/rbac/permissions.js';

export interface ApiAuthEnv {
  Variables: {
    productId: string;
    userId: string;
    scopes: string[];
  };
}

export const apiKeyAuth = createMiddleware<ApiAuthEnv>(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }
  const key = authHeader.slice(7);

  const result = await validateApiKey(key);
  if (!result) {
    return c.json({ error: 'Invalid API key' }, 401);
  }

  c.set('productId', result.productId);
  c.set('userId', result.userId);
  c.set('scopes', result.scopes);
  await next();
});

export const requireScope = (scope: string) =>
  createMiddleware<ApiAuthEnv>(async (c, next) => {
    const scopes = (c.get('scopes') as string[]) || [];
    if (!scopes.includes(scope) && !scopes.includes('*')) {
      return c.json({ error: `Insufficient permissions. Required scope: ${scope}` }, 403);
    }
    await next();
  });
