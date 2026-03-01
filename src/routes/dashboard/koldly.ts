import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { query, getProductByOwner } from '../../db/client.js';
import { dashboardLayout } from '../../views/layout.js';
import { koldlySetup } from '../../views/components.js';
import { getLayoutContext } from './_shared.js';

export const koldlyRoutes = new Hono<AuthEnv>();

const KOLDLY_ENDPOINTS = [
  { path: 'GET /internal/health', description: 'Health check (public)' },
  { path: 'GET /internal/icp', description: 'ICP config (ecosystem key)' },
  { path: 'POST /internal/conversion-signal', description: 'Conversion signal (ecosystem key)' },
  { path: 'POST /internal/campaign/receive', description: 'Campaign handoff (ecosystem key)' },
];

koldlyRoutes.get('/koldly', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'koldly', 'Koldly Integration');
  const content = html`
    <h1>Koldly Integration</h1>
    ${koldlySetup(KOLDLY_ENDPOINTS)}
  `;
  return c.html(dashboardLayout(ctx, content));
});

koldlyRoutes.post('/koldly/icp', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.json() as { product_id: string; icp: Record<string, unknown> };
  const prodResult = await getProductByOwner(body.product_id, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  await query('UPDATE products SET stack_description = ? WHERE id = ?',
    [JSON.stringify({ icp: body.icp }), body.product_id]);
  return c.json({ status: 'saved' });
});
