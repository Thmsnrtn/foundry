import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { getProductByOwner, getStoryArtifacts } from '../../db/client.js';
import { publishArtifact } from '../../services/story/engine.js';
import { dashboardLayout } from '../../views/layout.js';
import { journeyTimeline, milestoneTimeline } from '../../views/components.js';
import { getLayoutContext } from './_shared.js';
import { markMilestonesAsSeen, getUnseenMilestones } from '../../services/ux/milestones.js';
import { query } from '../../db/client.js';

export const journeyRoutes = new Hono<AuthEnv>();

journeyRoutes.get('/products/:id/journey', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const ctx = await getLayoutContext(founder, 'journey', 'Journey', productId);
  const artifacts = await getStoryArtifacts(productId);

  // UX: fetch all milestones for timeline + mark unseen as seen
  const allMilestonesResult = await query(
    'SELECT * FROM milestone_events WHERE founder_id = ? AND product_id = ? ORDER BY created_at DESC',
    [founder.id, productId],
  );
  const allMilestones = allMilestonesResult.rows as unknown as import('../../types/index.js').MilestoneEvent[];
  await markMilestonesAsSeen(founder.id);

  const content = html`
    <h1>Founding Story</h1>
    ${milestoneTimeline(allMilestones)}
    ${journeyTimeline(artifacts.rows as Array<Record<string, unknown>>, productId)}
  `;
  return c.html(dashboardLayout(ctx, content));
});

journeyRoutes.post('/products/:id/journey/:artifactId/publish', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const artifactId = c.req.param('artifactId');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const url = await publishArtifact(artifactId, productId);
  return c.json({ published_url: url });
});
