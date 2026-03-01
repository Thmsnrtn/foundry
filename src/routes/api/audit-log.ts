import { Hono } from 'hono';
import type { AuthEnv } from '../../middleware/auth.js';
import { query, getAuditLog } from '../../db/client.js';

export const apiAuditLogRoutes = new Hono<AuthEnv>();

apiAuditLogRoutes.get('/api/audit-log', async (c) => {
  const founder = c.get('founder');
  const products = await query('SELECT id FROM products WHERE owner_id = ?', [founder.id]);
  if (products.rows.length === 0) return c.json({ entries: [] });
  const productId = (products.rows[0] as Record<string, string>).id;
  const result = await getAuditLog(productId, 50);
  return c.json({ entries: result.rows });
});
