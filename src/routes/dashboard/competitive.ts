import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { getProductByOwner, getCompetitors, getCompetitiveSignals, query } from '../../db/client.js';
import { dashboardLayout } from '../../views/layout.js';
import { competitiveView } from '../../views/components.js';
import { getLayoutContext } from './_shared.js';
import { requireTier } from '../../middleware/tier-gate.js';
import { nanoid } from 'nanoid';

export const competitiveRoutes = new Hono<AuthEnv>();

competitiveRoutes.get('/products/:id/competitive', requireTier('competitive'), async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const ctx = await getLayoutContext(founder, 'competitive', 'Competitive', productId);
  const competitors = await getCompetitors(productId);
  const signals = await getCompetitiveSignals(productId, 20);

  const content = html`
    <h1>Competitive Intelligence</h1>
    ${competitiveView(
      competitors.rows as Array<Record<string, unknown>>,
      signals.rows as Array<Record<string, unknown>>,
      productId,
    )}
  `;
  return c.html(dashboardLayout(ctx, content));
});

competitiveRoutes.post('/products/:id/competitors', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const body = await c.req.json() as { name: string; website?: string; positioning?: string };
  await query('INSERT INTO competitors (id, product_id, name, website, positioning) VALUES (?, ?, ?, ?, ?)',
    [nanoid(), productId, body.name, body.website ?? null, body.positioning ?? null]);
  return c.json({ status: 'added' });
});
