import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { getProductByOwner, getCohorts } from '../../db/client.js';
import { getHistoricalAverage, getCohortsByChannel } from '../../services/intelligence/cohort.js';
import { dashboardLayout } from '../../views/layout.js';
import { cohortTable, type CohortData } from '../../views/components.js';
import { getLayoutContext } from './_shared.js';
import { requireTier } from '../../middleware/tier-gate.js';

export const cohortRoutes = new Hono<AuthEnv>();

cohortRoutes.get('/products/:id/cohorts', requireTier('cohorts'), async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const ctx = await getLayoutContext(founder, 'cohorts', 'Cohorts', productId);
  const cohorts = await getCohorts(productId);
  const avg = await getHistoricalAverage(productId);
  const byChannel = await getCohortsByChannel(productId);

  const historicalAvg = avg ? {
    retention_day_7: avg.day_7,
    retention_day_14: avg.day_14,
    retention_day_30: avg.day_30,
  } : null;

  const content = html`
    <h1>Cohorts</h1>
    ${cohortTable(cohorts.rows as unknown as CohortData[], historicalAvg, byChannel)}
  `;
  return c.html(dashboardLayout(ctx, content));
});
