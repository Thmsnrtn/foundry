import { Hono } from 'hono';
import type { AuthEnv } from '../../middleware/auth.js';
import { getProductsByOwner } from '../../db/client.js';

export const apiProductRoutes = new Hono<AuthEnv>();

apiProductRoutes.get('/api/products', async (c) => {
  const founder = c.get('founder');
  const result = await getProductsByOwner(founder.id);
  // Strip sensitive fields from API response
  const safeProducts = result.rows.map((row) => {
    const p = row as Record<string, unknown>;
    const { github_access_token, ...safe } = p;
    return safe;
  });
  return c.json({ products: safeProducts });
});
