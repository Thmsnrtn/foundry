// =============================================================================
// FOUNDRY — Supercharge API Routes
// Conversational COO, data ingestion, action execution, predictive intelligence,
// founder network, AI calibration, financial simulator.
// =============================================================================

import { Hono } from 'hono';
import type { AuthEnv } from '../../middleware/auth.js';
import { query, getProductByOwner } from '../../db/client.js';

// Chat COO
import { startSession, sendMessage, getSessionHistory, listSessions } from '../../services/chat/coo.js';

// Data Ingestion
import { registerIntegration, removeIntegration, getIntegrations, runSync, processStripeWebhookEvent } from '../../services/integrations/framework.js';

// Action Execution
import { generateActionDraft, approveDraft, rejectDraft, getPendingDrafts, generateDraftsForPendingDecisions } from '../../services/decisions/actions.js';

// Predictive Intelligence
import { generatePredictions, getActivePredictions, recordPredictionOutcome } from '../../services/intelligence/predictive.js';

// Founder Network
import { upsertNetworkProfile, findMatches, proposeIntroduction, respondToIntroduction, submitPeerReview, joinCohortGroup } from '../../services/network/matchmaking.js';

// AI Calibration
import { getFounderAIProfile, updateAIProfile, recordOutputFeedback } from '../../services/ai/calibration.js';

// Financial Simulator
import { computeRunwayModel, runWhatIfScenario, analyzeRunwayGap, getSavedScenarios } from '../../services/financial/simulator.js';

export const superchargeApiRoutes = new Hono<AuthEnv>();

// ═══════════════════════════════════════════════════════════════════════════════
// CONVERSATIONAL COO
// ═══════════════════════════════════════════════════════════════════════════════

superchargeApiRoutes.post('/api/chat/sessions', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.json() as Record<string, unknown>;
  const productId = body.product_id as string;
  if (!productId) return c.json({ error: 'product_id required' }, 400);
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const sessionId = await startSession(founder.id, productId, body.title as string);
  return c.json({ session_id: sessionId });
});

superchargeApiRoutes.get('/api/chat/sessions', async (c) => {
  const founder = c.get('founder');
  const sessions = await listSessions(founder.id);
  return c.json({ sessions });
});

superchargeApiRoutes.post('/api/chat/sessions/:id/messages', async (c) => {
  const founder = c.get('founder');
  const sessionId = c.req.param('id');
  const body = await c.req.json() as Record<string, unknown>;
  const message = body.message as string;
  if (!message) return c.json({ error: 'message required' }, 400);

  const response = await sendMessage(sessionId, founder.id, message);
  return c.json({ response });
});

superchargeApiRoutes.get('/api/chat/sessions/:id/messages', async (c) => {
  const founder = c.get('founder');
  const sessionId = c.req.param('id');
  const messages = await getSessionHistory(sessionId, founder.id);
  return c.json({ messages });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DATA INGESTION
// ═══════════════════════════════════════════════════════════════════════════════

superchargeApiRoutes.post('/api/products/:id/integrations', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json() as Record<string, unknown>;
  const id = await registerIntegration(productId, founder.id, {
    provider: body.provider as any,
    credentials: body.credentials as Record<string, string>,
    config: body.config as Record<string, unknown>,
    sync_frequency_minutes: body.sync_frequency_minutes as number,
  });
  return c.json({ integration_id: id, status: 'active' });
});

superchargeApiRoutes.get('/api/products/:id/integrations', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const integrations = await getIntegrations(productId);
  return c.json({ integrations });
});

superchargeApiRoutes.delete('/api/products/:id/integrations/:provider', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const provider = c.req.param('provider');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  await removeIntegration(productId, provider, founder.id);
  return c.json({ status: 'disconnected' });
});

superchargeApiRoutes.post('/api/products/:id/integrations/:integrationId/sync', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const integrationId = c.req.param('integrationId');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const result = await runSync(integrationId);
  return c.json({ sync_result: result });
});

// Stripe webhook (unauthenticated — verified by Stripe signature)
superchargeApiRoutes.post('/api/webhooks/stripe/:productId', async (c) => {
  const productId = c.req.param('productId');
  const body = await c.req.json() as Record<string, unknown>;
  const eventId = body.id as string;
  const eventType = body.type as string;

  if (eventId && eventType) {
    await processStripeWebhookEvent(productId, eventId, eventType, body);
  }
  return c.json({ received: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION EXECUTION
// ═══════════════════════════════════════════════════════════════════════════════

superchargeApiRoutes.post('/api/products/:id/actions/generate', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json() as Record<string, unknown>;
  const decisionId = body.decision_id as string;
  if (!decisionId) return c.json({ error: 'decision_id required' }, 400);

  const draft = await generateActionDraft(decisionId, productId, founder.id);
  return c.json({ draft });
});

superchargeApiRoutes.post('/api/products/:id/actions/generate-all', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const count = await generateDraftsForPendingDecisions(productId, founder.id);
  return c.json({ drafts_generated: count });
});

superchargeApiRoutes.get('/api/actions/pending', async (c) => {
  const founder = c.get('founder');
  const drafts = await getPendingDrafts(founder.id);
  return c.json({ drafts });
});

superchargeApiRoutes.post('/api/actions/:id/approve', async (c) => {
  const founder = c.get('founder');
  const draftId = c.req.param('id');
  const result = await approveDraft(draftId, founder.id);
  return c.json(result);
});

superchargeApiRoutes.post('/api/actions/:id/reject', async (c) => {
  const founder = c.get('founder');
  const draftId = c.req.param('id');
  const body = await c.req.json() as Record<string, unknown>;
  await rejectDraft(draftId, founder.id, body.reason as string);
  return c.json({ status: 'rejected' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PREDICTIVE INTELLIGENCE
// ═══════════════════════════════════════════════════════════════════════════════

superchargeApiRoutes.get('/api/products/:id/predictions', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const predictions = await getActivePredictions(productId);
  return c.json({ predictions });
});

superchargeApiRoutes.post('/api/products/:id/predictions/generate', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const predictions = await generatePredictions(productId, founder.id);
  return c.json({ predictions });
});

superchargeApiRoutes.post('/api/predictions/:id/outcome', async (c) => {
  const predictionId = c.req.param('id');
  const body = await c.req.json() as Record<string, unknown>;
  await recordPredictionOutcome(predictionId, body.outcome as any);
  return c.json({ status: 'recorded' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FOUNDER NETWORK
// ═══════════════════════════════════════════════════════════════════════════════

superchargeApiRoutes.put('/api/network/profile', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.json() as Record<string, unknown>;
  await upsertNetworkProfile(founder.id, {
    display_name: body.display_name as string,
    bio: body.bio as string,
    expertise_areas: body.expertise_areas as string[],
    seeking_help_with: body.seeking_help_with as string[],
    willing_to_help_with: body.willing_to_help_with as string[],
    timezone: body.timezone as string,
  });
  return c.json({ status: 'updated' });
});

superchargeApiRoutes.get('/api/network/matches', async (c) => {
  const founder = c.get('founder');
  const matches = await findMatches(founder.id);
  return c.json({ matches });
});

superchargeApiRoutes.post('/api/network/introductions', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.json() as Record<string, unknown>;
  const targetId = body.founder_id as string;
  if (!targetId) return c.json({ error: 'founder_id required' }, 400);

  const id = await proposeIntroduction(founder.id, targetId, body.reason as string ?? 'Founder-initiated', 50);
  return c.json({ introduction_id: id });
});

superchargeApiRoutes.post('/api/network/introductions/:id/respond', async (c) => {
  const founder = c.get('founder');
  const introId = c.req.param('id');
  const body = await c.req.json() as Record<string, unknown>;
  await respondToIntroduction(introId, founder.id, body.accept === true);
  return c.json({ status: body.accept ? 'accepted' : 'declined' });
});

superchargeApiRoutes.post('/api/network/peer-review', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.json() as Record<string, unknown>;
  const id = await submitPeerReview(
    founder.id,
    body.product_id as string,
    body.review_type as string,
    body.content as string,
    body.rating as number
  );
  return c.json({ review_id: id });
});

superchargeApiRoutes.post('/api/network/cohort/join', async (c) => {
  const founder = c.get('founder');
  const groupId = await joinCohortGroup(founder.id);
  return c.json({ cohort_group_id: groupId });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AI CALIBRATION
// ═══════════════════════════════════════════════════════════════════════════════

superchargeApiRoutes.get('/api/settings/ai-profile', async (c) => {
  const founder = c.get('founder');
  const profile = await getFounderAIProfile(founder.id);
  return c.json({ profile });
});

superchargeApiRoutes.put('/api/settings/ai-profile', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.json() as Record<string, unknown>;
  await updateAIProfile(founder.id, body as any);
  return c.json({ status: 'updated' });
});

superchargeApiRoutes.post('/api/ai-feedback', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.json() as Record<string, unknown>;
  await recordOutputFeedback(founder.id, body.output_type as string, body.output_id as string | null, {
    rating: body.rating as number,
    feedback: body.feedback as string,
    too_long: body.too_long as boolean,
    too_short: body.too_short as boolean,
    too_technical: body.too_technical as boolean,
    too_simple: body.too_simple as boolean,
  });
  return c.json({ status: 'recorded' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FINANCIAL SIMULATOR
// ═══════════════════════════════════════════════════════════════════════════════

superchargeApiRoutes.get('/api/products/:id/runway', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const model = await computeRunwayModel(founder.id, productId);
  const gap = await analyzeRunwayGap(founder.id, productId);
  return c.json({ runway: model, gap_analysis: gap });
});

superchargeApiRoutes.post('/api/products/:id/financial-scenario', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json() as Record<string, unknown>;
  const scenario = await runWhatIfScenario(productId, founder.id, {
    name: body.name as string ?? 'What-if scenario',
    type: body.type as any ?? 'custom',
    inputs: body.inputs as Record<string, unknown> ?? {},
  });
  return c.json({ scenario });
});

superchargeApiRoutes.get('/api/products/:id/financial-scenarios', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const scenarios = await getSavedScenarios(productId);
  return c.json({ scenarios });
});
