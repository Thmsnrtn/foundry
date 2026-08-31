import { Hono } from 'hono';
import type { AuthEnv } from '../../middleware/auth.js';
import { getVisibleProducts } from '../../db/client.js';

export const apiProductRoutes = new Hono<AuthEnv>();

apiProductRoutes.get('/api/products', async (c) => {
  const founder = c.get('founder');
  // Owned or accepted into — the same set the dashboard shows.
  const result = await getVisibleProducts(founder.id);
  // Strip sensitive fields from API response
  const safeProducts = result.rows.map((row) => {
    const p = row as Record<string, unknown>;
    const { github_access_token, ...safe } = p;
    return safe;
  });
  return c.json({ products: safeProducts });
});
