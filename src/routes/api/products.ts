import { Hono } from 'hono';
import type { AuthEnv } from '../../middleware/auth.js';
import { getProductsByOwner } from '../../db/client.js';

export const apiProductRoutes = new Hono<AuthEnv>();

apiProductRoutes.get('/api/products', async (c) => {
  const founder = c.get('founder');
  const result = await getProductsByOwner(founder.id);
  return c.json({ products: result.rows });
});
