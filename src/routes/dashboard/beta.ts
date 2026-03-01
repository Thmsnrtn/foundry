import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { query, getProductByOwner, getBetaIntakes } from '../../db/client.js';
import { dashboardLayout } from '../../views/layout.js';
import { betaStatus } from '../../views/components.js';
import { getLayoutContext } from './_shared.js';
import { nanoid } from 'nanoid';

export const betaRoutes = new Hono<AuthEnv>();

betaRoutes.get('/beta', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'beta', 'Beta');
  const products = await query('SELECT id FROM products WHERE owner_id = ?', [founder.id]);
  const productId = products.rows.length > 0 ? (products.rows[0] as Record<string, string>).id : null;
  const intakes = productId ? await getBetaIntakes(productId) : { rows: [] };
  const count = productId
    ? await query('SELECT COUNT(*) as c FROM beta_intake WHERE product_id = ?', [productId])
    : { rows: [{ c: 0 }] };
  const totalCount = (count.rows[0] as Record<string, number>)?.c ?? 0;

  const content = html`
    <h1>Beta Infrastructure</h1>
    ${betaStatus(intakes.rows as Array<Record<string, unknown>>, totalCount)}
  `;
  return c.html(dashboardLayout(ctx, content));
});

betaRoutes.post('/beta/intake', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.json() as { product_id: string; participant_name: string; hypothesis_signals?: Record<string, unknown> };
  const prodResult = await getProductByOwner(body.product_id, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  await query(
    `INSERT INTO beta_intake (id, product_id, participant_name, hypothesis_signals) VALUES (?, ?, ?, ?)`,
    [nanoid(), body.product_id, body.participant_name, body.hypothesis_signals ? JSON.stringify(body.hypothesis_signals) : null]
  );
  return c.json({ status: 'submitted' });
});
