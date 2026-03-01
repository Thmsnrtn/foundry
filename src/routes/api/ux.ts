// =============================================================================
// FOUNDRY — UX Intelligence API Routes
// Tour navigation and notification management endpoints.
// =============================================================================

import { Hono } from 'hono';
import type { AuthEnv } from '../../middleware/auth.js';
import { advanceTour, skipTour, getTourState, TOUR_STEPS } from '../../services/ux/tour.js';
import { markRead, markAllRead } from '../../services/ux/notifications.js';

export const apiUXRoutes = new Hono<AuthEnv>();

// ─── Tour ────────────────────────────────────────────────────────────────────

apiUXRoutes.post('/api/tour/advance', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.parseBody() as Record<string, string>;
  const step = parseInt(body.step ?? '1', 10);
  await advanceTour(founder.id, step);

  // If this was the last step, redirect without tour param
  if (step >= TOUR_STEPS.length) {
    return c.redirect('/dashboard');
  }
  return c.redirect('/dashboard?tour=1');
});

apiUXRoutes.post('/api/tour/back', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.parseBody() as Record<string, string>;
  const step = parseInt(body.step ?? '2', 10);

  // Go back to previous step — update current_step directly
  const tour = await getTourState(founder.id);
  if (tour && !tour.completed_at && !tour.skipped_at && step > 1) {
    const { query } = await import('../../db/client.js');
    await query('UPDATE onboarding_tour SET current_step = ? WHERE founder_id = ?', [step - 1, founder.id]);
  }
  return c.redirect('/dashboard?tour=1');
});

apiUXRoutes.post('/api/tour/skip', async (c) => {
  const founder = c.get('founder');
  await skipTour(founder.id);
  return c.redirect('/dashboard');
});

// ─── Notifications ───────────────────────────────────────────────────────────

apiUXRoutes.post('/api/notifications/:id/read', async (c) => {
  const founder = c.get('founder');
  const notificationId = c.req.param('id');
  await markRead(notificationId, founder.id);
  return c.json({ status: 'read' });
});

apiUXRoutes.post('/api/notifications/read-all', async (c) => {
  const founder = c.get('founder');
  await markAllRead(founder.id);

  // Redirect back if browser request, JSON if API
  const accept = c.req.header('Accept') ?? '';
  if (accept.includes('text/html')) {
    const referer = c.req.header('Referer') ?? '/dashboard';
    return c.redirect(referer);
  }
  return c.json({ status: 'all_read' });
});
