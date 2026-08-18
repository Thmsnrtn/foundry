// =============================================================================
// FOUNDRY — Platform API Routes
// Customer intelligence, experiments, event bus, investor automation,
// voice COO, knowledge graph, portfolio mode.
// =============================================================================

import { Hono } from 'hono';
import type { AuthEnv } from '../../middleware/auth.js';
import { query, getProductByOwner } from '../../db/client.js';

import { upsertCustomer, recordCustomerEvent, refreshAllCustomerHealth, getAtRiskCustomers, getExpansionCandidates, generateCustomerInsights, detectRevenueConcentration } from '../../services/customers/intelligence.js';
import { designExperiment, createExperiment, recordExperimentEvent, analyzeExperiment, getActiveExperiments, stopExperiment } from '../../services/experiments/engine.js';
import { ingestEvent, createEventRule, getRecentEvents, getActiveAnomalies } from '../../services/events/bus.js';
import { generateBoardDeck } from '../../services/investor/automation.js';
import { assessFundraisingReadiness } from '../../services/scp/investor/fundraising-readiness.js';
// One writer per table — see migration 164. This route had its own, which
// left `month` unset and made its updates invisible to the dashboard.
import { generateInvestorUpdate } from '../../services/scp/investor/investor-update.js';
import { processVoiceMemo, generateSpokenDigest, startVoiceSession, endVoiceSession } from '../../services/voice/processor.js';
import { buildProductGraph, discoverCausalChains, queryNeighborhood } from '../../services/graph/engine.js';
import { createPortfolio, addToPortfolio, getPortfolioOverview, benchmarkProduct, generatePortfolioSnapshot, authenticatePortfolioKey } from '../../services/portfolio/manager.js';

export const platformApiRoutes = new Hono<AuthEnv>();

// ═════════════════════════════════════════════════════════════════════════════
// CUSTOMER INTELLIGENCE
// ═════════════════════════════════════════════════════════════════════════════

platformApiRoutes.post('/api/products/:id/customers', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json() as Record<string, unknown>;
  const customerId = await upsertCustomer(productId, founder.id, body as any);
  return c.json({ customer_id: customerId });
});

platformApiRoutes.post('/api/products/:id/customers/:customerId/events', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const customerId = c.req.param('customerId');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json() as Record<string, unknown>;
  await recordCustomerEvent(customerId, productId, body.event_type as string, body.data as Record<string, unknown>);
  return c.json({ status: 'recorded' });
});

platformApiRoutes.get('/api/products/:id/customers/insights', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const insights = await generateCustomerInsights(productId);
  const concentration = await detectRevenueConcentration(productId);
  return c.json({ insights, revenue_concentration: concentration });
});

platformApiRoutes.get('/api/products/:id/customers/at-risk', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const atRisk = await getAtRiskCustomers(productId);
  return c.json({ customers: atRisk });
});

platformApiRoutes.get('/api/products/:id/customers/expansion', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const candidates = await getExpansionCandidates(productId);
  return c.json({ customers: candidates });
});

platformApiRoutes.post('/api/products/:id/customers/refresh-health', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const count = await refreshAllCustomerHealth(productId);
  return c.json({ refreshed: count });
});

// ═════════════════════════════════════════════════════════════════════════════
// EXPERIMENTS
// ═════════════════════════════════════════════════════════════════════════════

platformApiRoutes.post('/api/products/:id/experiments/design', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json() as Record<string, unknown>;
  const design = await designExperiment(productId, founder.id, body.goal as string);
  return c.json({ design });
});

platformApiRoutes.post('/api/products/:id/experiments', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json() as Record<string, unknown>;
  const experimentId = await createExperiment(productId, founder.id, body as any);
  return c.json({ experiment_id: experimentId });
});

platformApiRoutes.get('/api/products/:id/experiments', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const experiments = await getActiveExperiments(productId);
  return c.json({ experiments });
});

// Helper: verify experiment belongs to a product owned by this founder
async function verifyExperimentOwnership(experimentId: string, founderId: string): Promise<boolean> {
  const result = await query(
    `SELECT e.id FROM experiments e
     JOIN products p ON e.product_id = p.id
     WHERE e.id = ? AND p.owner_id = ?`,
    [experimentId, founderId]
  );
  return result.rows.length > 0;
}

platformApiRoutes.post('/api/experiments/:id/event', async (c) => {
  const founder = c.get('founder');
  const expId = c.req.param('id');
  if (!(await verifyExperimentOwnership(expId, founder.id))) return c.json({ error: 'Not found' }, 404);
  const body = await c.req.json() as Record<string, unknown>;
  await recordExperimentEvent(expId, body.variant as string, body.event_type as string, body.value as number);
  return c.json({ status: 'recorded' });
});

platformApiRoutes.get('/api/experiments/:id/results', async (c) => {
  const founder = c.get('founder');
  const expId = c.req.param('id');
  if (!(await verifyExperimentOwnership(expId, founder.id))) return c.json({ error: 'Not found' }, 404);
  const result = await analyzeExperiment(expId);
  return c.json(result);
});

platformApiRoutes.post('/api/experiments/:id/stop', async (c) => {
  const founder = c.get('founder');
  const expId = c.req.param('id');
  if (!(await verifyExperimentOwnership(expId, founder.id))) return c.json({ error: 'Not found' }, 404);
  const result = await stopExperiment(expId);
  return c.json(result);
});

// ═════════════════════════════════════════════════════════════════════════════
// EVENT BUS
// ═════════════════════════════════════════════════════════════════════════════

platformApiRoutes.post('/api/products/:id/events', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json() as Record<string, unknown>;
  const result = await ingestEvent(productId, {
    source: body.source as string ?? 'api',
    event_type: body.event_type as string,
    severity: (body.severity as any) ?? 'info',
    payload: body.payload as Record<string, unknown> ?? {},
  });
  return c.json(result);
});

platformApiRoutes.get('/api/products/:id/events', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const events = await getRecentEvents(productId);
  return c.json({ events });
});

platformApiRoutes.get('/api/products/:id/anomalies', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const anomalies = await getActiveAnomalies(productId);
  return c.json({ anomalies });
});

platformApiRoutes.post('/api/products/:id/event-rules', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json() as Record<string, unknown>;
  const ruleId = await createEventRule(productId, founder.id, body as any);
  return c.json({ rule_id: ruleId });
});

// ═════════════════════════════════════════════════════════════════════════════
// INVESTOR AUTOMATION
// ═════════════════════════════════════════════════════════════════════════════

platformApiRoutes.post('/api/products/:id/investor-update', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json() as Record<string, unknown>;
  // The canonical writer keys on the month, which is the column every reader
  // of this table uses. This route used to write through a second generator
  // that left it null, so its updates were invisible to the dashboard that
  // shows them and to the check that stops a duplicate being written.
  const month = new Date().toISOString().slice(0, 7);
  const update = await generateInvestorUpdate(productId, month, body.highlight as string | undefined);
  return c.json({ investor_update_id: update });
});

platformApiRoutes.post('/api/products/:id/board-deck', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const deck = await generateBoardDeck(productId, founder.id);
  return c.json(deck);
});

platformApiRoutes.post('/api/products/:id/fundraise-readiness', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json() as Record<string, unknown>;
  // THE ROUND IS A CLOSED VOCABULARY AND THE CALLER IS OUTSIDE. The canonical
  // assessment indexes a multiplier table by this value, so an unrecognised
  // round produces `undefined` and every score downstream becomes NaN — a
  // readiness report made of nothing, returned with a 200. Reject it here
  // rather than compute it.
  const ROUNDS = ['pre_seed', 'seed', 'series_a', 'series_b'] as const;
  const round = String(body.target_round ?? 'seed');
  if (!(ROUNDS as readonly string[]).includes(round)) {
    return c.json({ error: `target_round must be one of ${ROUNDS.join(', ')}` }, 400);
  }
  const readiness = await assessFundraisingReadiness(
    productId, round as (typeof ROUNDS)[number]);
  return c.json(readiness);
});

// ═════════════════════════════════════════════════════════════════════════════
// VOICE COO
// ═════════════════════════════════════════════════════════════════════════════

platformApiRoutes.post('/api/voice/memo', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.json() as Record<string, unknown>;
  // RT02-03: Verify founder owns the product before accepting voice memo
  const productId = body.product_id as string;
  const prodCheck = await getProductByOwner(productId, founder.id);
  if (prodCheck.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const result = await processVoiceMemo(
    founder.id, productId,
    body.audio_url as string, body.transcript as string,
    body.duration_seconds as number
  );
  return c.json(result);
});

platformApiRoutes.get('/api/voice/digest/:productId', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('productId');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  try {
    const spoken = await generateSpokenDigest(founder.id, productId);
    return c.json({ spoken_digest: spoken });
  } catch (err) {
    // The digest is an AI call — a provider outage must degrade to a clean
    // 503, not an unhandled 500.
    return c.json({ error: 'Digest generation unavailable right now — try again shortly.', detail: String((err as Error)?.message ?? err).slice(0, 200) }, 503);
  }
});

platformApiRoutes.post('/api/voice/session/start', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.json() as Record<string, unknown>;
  const session = await startVoiceSession(founder.id, body.product_id as string);
  return c.json(session);
});

platformApiRoutes.post('/api/voice/session/:id/end', async (c) => {
  const founder = c.get('founder');
  const sessionId = c.req.param('id')!;
  // RT02-02: Verify founder owns this voice session before ending it
  const sessionCheck = await query(
    `SELECT vs.id FROM voice_sessions vs
     JOIN products p ON vs.product_id = p.id
     WHERE vs.id = ? AND p.owner_id = ?`,
    [sessionId, founder.id]
  );
  if (sessionCheck.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const body = await c.req.json() as Record<string, unknown>;
  await endVoiceSession(sessionId, body.transcript as string, body.duration_seconds as number);
  return c.json({ status: 'completed' });
});

// ═════════════════════════════════════════════════════════════════════════════
// KNOWLEDGE GRAPH
// ═════════════════════════════════════════════════════════════════════════════

platformApiRoutes.post('/api/products/:id/graph/build', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const result = await buildProductGraph(productId);
  return c.json(result);
});

platformApiRoutes.get('/api/products/:id/graph/causal-chains', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const chains = await discoverCausalChains(productId);
  return c.json({ causal_chains: chains });
});

platformApiRoutes.get('/api/products/:id/graph/neighborhood/:entityId', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const entityId = c.req.param('entityId');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const neighborhood = await queryNeighborhood(productId, entityId);
  return c.json(neighborhood);
});

// ═════════════════════════════════════════════════════════════════════════════
// PORTFOLIO MODE
// ═════════════════════════════════════════════════════════════════════════════

platformApiRoutes.post('/api/portfolios', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.json() as Record<string, unknown>;
  const result = await createPortfolio(
    body.name as string, body.organization_type as any,
    founder.email, body.branding as any
  );
  return c.json(result);
});

// Helper: verify portfolio ownership before any operation
async function verifyPortfolioOwnership(portfolioId: string, founderEmail: string): Promise<boolean> {
  const result = await query('SELECT id FROM portfolios WHERE id = ? AND owner_email = ?', [portfolioId, founderEmail]);
  return result.rows.length > 0;
}

platformApiRoutes.post('/api/portfolios/:id/companies', async (c) => {
  const founder = c.get('founder');
  const portfolioId = c.req.param('id');
  if (!(await verifyPortfolioOwnership(portfolioId, founder.email))) return c.json({ error: 'Not found' }, 404);
  const body = await c.req.json() as Record<string, unknown>;
  await addToPortfolio(
    portfolioId, body.product_id as string,
    body.founder_id as string, body.investment as any
  );
  return c.json({ status: 'added' });
});

platformApiRoutes.get('/api/portfolios/:id/overview', async (c) => {
  const founder = c.get('founder');
  const portfolioId = c.req.param('id');
  if (!(await verifyPortfolioOwnership(portfolioId, founder.email))) return c.json({ error: 'Not found' }, 404);
  const overview = await getPortfolioOverview(portfolioId);
  return c.json(overview);
});

platformApiRoutes.get('/api/portfolios/:id/benchmark/:productId', async (c) => {
  const founder = c.get('founder');
  const portfolioId = c.req.param('id');
  if (!(await verifyPortfolioOwnership(portfolioId, founder.email))) return c.json({ error: 'Not found' }, 404);
  const result = await benchmarkProduct(portfolioId, c.req.param('productId'));
  return c.json(result);
});

platformApiRoutes.post('/api/portfolios/:id/snapshot', async (c) => {
  const founder = c.get('founder');
  const portfolioId = c.req.param('id');
  if (!(await verifyPortfolioOwnership(portfolioId, founder.email))) return c.json({ error: 'Not found' }, 404);
  await generatePortfolioSnapshot(portfolioId);
  return c.json({ status: 'generated' });
});
