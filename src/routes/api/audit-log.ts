import { Hono } from 'hono';
import type { AuthEnv } from '../../middleware/auth.js';
import { query, getAuditLog } from '../../db/client.js';

export const apiAuditLogRoutes = new Hono<AuthEnv>();

apiAuditLogRoutes.get('/api/audit-log', async (c) => {
  const founder = c.get('founder');
  // Support ?product_id query param for specific product, otherwise use active product from cookie
  const requestedProductId = c.req.query('product_id');

  if (requestedProductId) {
    // Verify ownership
    const prodCheck = await query('SELECT id FROM products WHERE id = ? AND owner_id = ?', [requestedProductId, founder.id]);
    if (prodCheck.rows.length === 0) return c.json({ error: 'Not found' }, 404);
    const result = await getAuditLog(requestedProductId, 50);
    return c.json({ entries: result.rows });
  }

  // Fall back to all products owned by this founder
  const products = await query('SELECT id FROM products WHERE owner_id = ?', [founder.id]);
  if (products.rows.length === 0) return c.json({ entries: [] });

  // Return audit log entries across all owned products
  const productIds = products.rows.map((p) => (p as Record<string, string>).id);
  const placeholders = productIds.map(() => '?').join(', ');
  const result = await query(
    `SELECT * FROM audit_log WHERE product_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 50`,
    productIds
  );
  return c.json({ entries: result.rows });
});
