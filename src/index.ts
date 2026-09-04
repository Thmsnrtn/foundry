// =============================================================================
// FOUNDRY — Main Application Entry Point
// Hono HTTP server with all routes, middleware, and cron scheduler.
// =============================================================================

import { validateEnvironment } from './env.js';

// Validate environment before anything else. ONE LIST — this file used to
// carry a second pair of its own (FATAL_ENV_VARS / DEGRADED_ENV_VARS) a few
// lines below this call, disagreeing with `env.ts` about whether an AI key was
// fatal. On a boot without one, `env.ts` printed "✓ Environment validated" and
// this block then printed "FATAL: required config missing".
if (process.env.NODE_ENV !== 'test') {
  validateEnvironment();
}

import { Hono } from 'hono';
import { staticAssetHandler } from './routes/public/static-assets.js';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { CronJob } from 'cron';
import { logger } from './services/logger.js';

// Middleware
import { authMiddleware, sessionAuthForApiRoutes } from './middleware/auth.js';
import { publicRateLimit, apiRateLimit, authRateLimit, webhookRateLimit, aiRateLimit, auditRateLimit } from './middleware/rate-limit.js';
import { internalMiddleware } from './middleware/internal.js';

// Public routes (no auth)
import { landingRoutes, pricingRoutes, caseStudyRoutes, legalRoutes, manifestoRoutes, helpRoutes } from './routes/public/landing.js';

// Auth routes
import { authRoutes } from './routes/auth/clerk.js';

// Dashboard routes (auth required)
import { dashboardRoutes } from './routes/dashboard/index.js';
import { onboardingRoutes } from './routes/dashboard/onboarding.js';
import { productRoutes } from './routes/dashboard/products.js';
import { auditRoutes } from './routes/dashboard/audit.js';
import { decisionRoutes } from './routes/dashboard/decisions.js';
import { fleetRoutes } from './routes/dashboard/fleet.js';
import { letterRoutes } from './routes/dashboard/letter.js';
import { noteAllStopped, noteScheduled } from './lib/scheduler-standing.js';
import { ownerFailurePage } from './routes/dashboard/foundry-shell.js';
import { isOwnerSurface } from './lib/owner-surface-script.js';
import { lifecycleRoutes } from './routes/dashboard/lifecycle.js';
import { digestRoutes } from './routes/dashboard/digest.js';
import { cohortRoutes } from './routes/dashboard/cohorts.js';
import { competitiveRoutes } from './routes/dashboard/competitive.js';
import { betaRoutes } from './routes/dashboard/beta.js';
import { journeyRoutes } from './routes/dashboard/journey.js';
import { koldlyRoutes } from './routes/dashboard/koldly.js';
import { settingsRoutes } from './routes/dashboard/settings.js';
import { revenueRoutes } from './routes/dashboard/revenue.js';
import { portfolioRoutes } from './routes/dashboard/portfolio.js';
import { founderOpsRoutes } from './routes/dashboard/founder-ops.js';
import { founderIntelRoutes } from './routes/api/founder-intelligence.js';

// Share routes (public, token-gated)
import { shareRoutes } from './routes/share/index.js';

// Metric Ingest (public, token-gated)
import { ingestRoutes } from './routes/ingest/index.js';

// Signal Timeline
import { timelineRoutes } from './routes/signal/timeline.js';

// Weekly Operating Plan
import { planRoutes } from './routes/dashboard/plan.js';

// New routes: Integrations, Team, Investors, Playbooks
import { integrationsRoutes } from './routes/dashboard/integrations.js';
import { teamRoutes } from './routes/dashboard/team.js';
import { investorRoutes } from './routes/dashboard/investors.js';
import { playbookRoutes } from './routes/dashboard/playbooks.js';

// SCP: Agent Roster + all SCP sub-routes
import { agentRoutes } from './routes/dashboard/agents.js';
import { agentWisdomRoutes } from './routes/dashboard/agents-wisdom.js';
import { agentBriefingRoutes } from './routes/dashboard/agents-briefings.js';
import { agentEvolveRoutes } from './routes/dashboard/agents-evolve.js';
import { agentConstitutionRoutes } from './routes/dashboard/agents-constitution.js';
import { agentRemediationRoutes } from './routes/dashboard/agents-remediations.js';
import { agentTemporalRoutes } from './routes/dashboard/agents-temporal.js';
// SCP v2/v3: New capability layers
import { agentIntegrationRoutes } from './routes/dashboard/agents-integrations.js';
import { agentCustomerRoutes } from './routes/dashboard/agents-customers.js';
import { agentMessageRoutes } from './routes/dashboard/agents-messages.js';
import { agentStrategyRoutes } from './routes/dashboard/agents-strategy.js';
import { agentExperimentRoutes } from './routes/dashboard/agents-experiments.js';
// SCP v4: New dashboard pages
import { agentsInbox } from './routes/dashboard/agents-inbox.js';
import { agentsOkr } from './routes/dashboard/agents-okr.js';
import { agentsDecisions } from './routes/dashboard/agents-decisions.js';
import { benchmarks } from './routes/dashboard/benchmarks.js';
import { auditLog } from './routes/dashboard/audit-log.js';
// SCP v5: Gap-closing — execution, forecasting, investor layer, accuracy, privacy
import { agentsActions } from './routes/dashboard/agents-actions.js';
import { agentsAccuracy } from './routes/dashboard/agents-accuracy.js';
import { agentsTransparency } from './routes/dashboard/agents-transparency.js';
import { scenarios } from './routes/dashboard/scenarios.js';
import { privacySettings } from './routes/dashboard/privacy.js';
import { boardPacket } from './routes/dashboard/board-packet.js';
import { weeklyBrief } from './routes/dashboard/weekly-brief.js';
// SCP v6: Full evolved platform
import { agentsDebate } from './routes/dashboard/agents-debate.js';
import { executionPlaybooks } from './routes/dashboard/execution-playbooks.js';
import { memoryGraph } from './routes/dashboard/memory.js';
import { agentIntelligence } from './routes/dashboard/agent-intelligence.js';
import { multimodalSignals } from './routes/dashboard/signals-multimodal.js';
import { ambientRoutes } from './routes/dashboard/ambient.js';
import { networkIntelligence } from './routes/dashboard/network-intelligence.js';
import { exitRoutes } from './routes/dashboard/exit.js';
import { transcriptWebhooks } from './routes/api/webhooks/transcripts.js';
import { voiceReplyWebhook } from './routes/api/webhooks/voice-reply.js';
// SCP v7: ROI dashboard, founder intelligence, integration health, priority API
import { roiDashboard } from './routes/dashboard/roi.js';
import { founderIntelligence } from './routes/dashboard/founder-intelligence.js';
import { integrationHealth } from './routes/dashboard/integration-health.js';
import { priorityApi } from './routes/api/priority.js';
// REST API v1 (API key auth)
import { apiV1 } from './api/v1/index.js';

// API routes (auth required)
import { apiProductRoutes } from './routes/api/products.js';
import { apiMetricRoutes } from './routes/api/metrics.js';
import { apiAuditLogRoutes } from './routes/api/audit-log.js';
import { apiUXRoutes } from './routes/api/ux.js';
import { apiAskRoutes } from './routes/api/ask.js';
import { feedbackRoutes } from './routes/api/feedback.js';
import { mobileRoutes } from './routes/api/mobile.js';
import { tier1ApiRoutes } from './routes/api/tier1.js';
import { tier2ApiRoutes } from './routes/api/tier2.js';
import { tier3ApiRoutes } from './routes/api/tier3.js';
import { tier4ApiRoutes } from './routes/api/tier4.js';
import { superchargeApiRoutes } from './routes/api/supercharge.js';
import { platformApiRoutes } from './routes/api/platform.js';

// Internal routes (ecosystem key required, except /health)
import { healthRoutes } from './routes/internal/health.js';
import { ecosystemRoutes } from './routes/internal/ecosystem.js';

// Stripe webhook (raw body needed)
import { handleWebhook } from './services/billing/stripe.js';

// Scheduled jobs
import { JOB_REGISTRY } from './jobs/index.js';
import { acquireJobLock, releaseJobLock } from './services/job-lock.js';

// Database migrations
import { runMigrations } from './db/migrate.js';

// ─── App Setup ───────────────────────────────────────────────────────────────

const app = new Hono();

// Wire the error reporter once at boot. SENTRY_DSN env activates Sentry
// (when @sentry/node is installed), ERROR_LOG_PATH activates the file
// reporter, otherwise structured stderr stays. Non-blocking — boot
// continues even if reporter init fails.
import { initReporter } from './lib/error-reporter.js';
initReporter().catch((err) => {
  process.stderr.write(
    JSON.stringify({ type: 'reporter_init_error', error: String(err) }) + '\n'
  );
});

// Global middleware
import { errorPage, wantsHtml } from './views/error-page.js';
import { getProcessRole, schedulerEnabledForRole } from './lib/process-role.js';
import { securityHeaders } from './middleware/security-headers.js';
import { requestIdMiddleware } from './middleware/security.js';
// Trace context first — every downstream log line / AI call / error
// report picks up the trace ID via AsyncLocalStorage.
app.use('*', requestIdMiddleware);
app.use('*', securityHeaders);
app.use('*', honoLogger());
app.use('*', cors({
  origin: process.env.APP_URL ?? 'http://localhost:8080',
  credentials: true,
}));

// ─── Static Files ─────────────────────────────────────────────────────────────

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

app.get('/static/:file', staticAssetHandler(__dirname));

// PWA: manifest and service worker must be served from root scope
app.get('/manifest.json', (c) => {
  try {
    const content = readFileSync(resolve(__dirname, 'public', 'manifest.json'), 'utf-8');
    return c.body(content, 200, { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' });
  } catch { return c.notFound(); }
});

app.get('/sw.js', (c) => {
  try {
    const content = readFileSync(resolve(__dirname, 'public', 'sw.js'), 'utf-8');
    return c.body(content, 200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' });
  } catch { return c.notFound(); }
});

// ─── Public Routes ───────────────────────────────────────────────────────────

app.use('/auth/*', authRateLimit);
app.route('/', landingRoutes);
app.route('/', pricingRoutes);
app.route('/', caseStudyRoutes);
app.route('/', legalRoutes);
app.route('/', manifestoRoutes);
app.route('/', helpRoutes);
app.route('/', authRoutes);
app.route('/', shareRoutes);
app.route('/', ingestRoutes);

// ─── Stripe Webhook (raw body, no auth) ──────────────────────────────────────
app.use('/webhooks/*', webhookRateLimit);

app.post('/webhooks/stripe', async (c) => {
  const signature = c.req.header('stripe-signature');
  if (!signature) return c.json({ error: 'Missing signature' }, 400);
  const body = await c.req.text();
  try {
    await handleWebhook(body, signature);
    return c.json({ received: true });
  } catch (err) {
    logger.error('Stripe webhook error', { error: String(err) });
    return c.json({ error: 'Webhook processing failed' }, 400);
  }
});

// Per-product Stripe webhook with full intelligence chain
import { verifyStripeWebhook, processStripeEventChain } from './services/integrations/stripe-webhook.js';

app.post('/webhooks/stripe/:productId', async (c) => {
  const productId = c.req.param('productId');
  const signature = c.req.header('stripe-signature');
  if (!signature) return c.json({ error: 'Missing signature' }, 400);

  const rawBody = await c.req.text();
  try {
    const event = verifyStripeWebhook(rawBody, signature);
    // THE URL NAMES THE COMPANY AND NOTHING CHECKED THAT THE COMPANY EXISTS.
    //
    // RT02-09 is about the signature proving the event came from Stripe and not
    // which product it belongs to. The replay half is closed one layer down: the
    // event id is globally unique in `stripe_events`, so the same captured event
    // delivered at a second product does nothing.
    //
    // What was missing here is smaller and entirely checkable: the `:productId`
    // was passed straight through, so an id belonging to no company — a typo, a
    // deleted company, a paused one, a company on its way out under a scheduled
    // erasure — ran the whole chain, wrote rows against it, and returned a
    // success body. A company that is not operating does not receive revenue
    // events; it certainly does not get metrics written and stressors raised.
    //
    // WHAT IS STILL NOT PROVEN, stated so nobody reads this guard as more than
    // it is: one webhook secret serves every tenant, so anyone holding it can
    // mint an event for any company. Binding an event to a company needs the
    // company's own Stripe account id on the product row and a per-account
    // secret — a connect-flow change that cannot be verified against real
    // Stripe from here.
    const { query: dbQuery, operatingProduct } = await import('./db/client.js');
    const known = await dbQuery(
      `SELECT id FROM products WHERE id = ? AND ${operatingProduct()}`, [productId]);
    if (known.rows.length === 0) {
      logger.warn('stripe webhook for a product that is not operating', { productId });
      return c.json({ error: 'Unknown product' }, 404);
    }
    const result = await processStripeEventChain(productId, event);
    return c.json({ received: true, ...result });
  } catch (err) {
    logger.error(`Stripe webhook error for ${productId}`, { productId, error: String(err) });
    return c.json({ error: 'Webhook processing failed' }, 400);
  }
});

// ─── Internal Routes ─────────────────────────────────────────────────────────

// Health check is public
app.route('/', healthRoutes);

// All other internal routes require ecosystem service key
app.use('/internal/*', async (c, next) => {
  if (c.req.path === '/internal/health') return next();
  return internalMiddleware(c, next);
});
app.route('/', ecosystemRoutes);

// ─── Authenticated Routes ────────────────────────────────────────────────────

// Apply auth middleware to all dashboard and API routes
app.use('/dashboard/*', authMiddleware);
app.use('/onboarding/*', authMiddleware);
app.use('/products/*', authMiddleware);
app.use('/decisions/*', authMiddleware);
app.use('/fleet', authMiddleware);
app.use('/api/decisions/*', authMiddleware);
app.use('/api/feedback/*', authMiddleware);
app.use('/digest/*', authMiddleware);
app.use('/beta/*', authMiddleware);
app.use('/koldly/*', authMiddleware);
app.use('/settings', authMiddleware);
app.use('/settings/*', authMiddleware);
app.use('/plan', authMiddleware);
app.use('/plan/*', authMiddleware);
app.use('/signal/*', authMiddleware);
app.use('/checkout', authMiddleware);
app.use('/switch-product', authMiddleware);
app.use('/portfolio', authMiddleware);
app.use('/checkout', authMiddleware);
app.use('/integrations', authMiddleware);
app.use('/integrations/*', authMiddleware);
app.use('/team', authMiddleware);
app.use('/team/*', authMiddleware);
app.use('/investors', authMiddleware);
app.use('/investors/*', authMiddleware);
app.use('/playbooks', authMiddleware);
app.use('/playbooks/*', authMiddleware);
app.use('/agents', authMiddleware);
app.use('/agents/*', authMiddleware);
app.use('/products/*/agents/*', authMiddleware);
// Cookie/session APIs use Clerk. Machine-facing REST API v1 owns its bearer
// API-key authentication in apiV1 and must not have that credential consumed
// as a Clerk token first.
app.use('/api/*', sessionAuthForApiRoutes);
app.use('/benchmarks', authMiddleware);
app.use('/benchmarks/*', authMiddleware);
app.use('/audit-log', authMiddleware);
app.use('/audit-log/*', authMiddleware);
app.use('/scenarios', authMiddleware);
app.use('/scenarios/*', authMiddleware);
app.use('/board', authMiddleware);
app.use('/board/*', authMiddleware);
app.use('/brief', authMiddleware);
app.use('/brief/*', authMiddleware);
app.use('/privacy', authMiddleware);
app.use('/privacy/*', authMiddleware);
// SCP v7 auth
app.use('/roi', authMiddleware);
app.use('/roi/*', authMiddleware);
app.use('/founder', authMiddleware);
app.use('/founder/*', authMiddleware);
app.use('/integrations/health', authMiddleware);
app.use('/integrations/health/*', authMiddleware);
// SCP v6 auth
app.use('/memory', authMiddleware);
app.use('/memory/*', authMiddleware);
app.use('/signals/multimodal', authMiddleware);
app.use('/signals/multimodal/*', authMiddleware);
app.use('/ambient', authMiddleware);
app.use('/ambient/*', authMiddleware);
app.use('/network', authMiddleware);
app.use('/network/*', authMiddleware);
app.use('/exit', authMiddleware);
app.use('/exit/*', authMiddleware);
// Ascent surfaces (the Letter, Controls, Talk) + Hands Law connections
app.use('/letter', authMiddleware);
app.use('/letter/*', authMiddleware);
// THE OWNER SURFACE IS A PRIVATE SURFACE, and a new top-level path inherits
// nothing here. `/foundry` is mounted inside the Letter's router, but auth is
// registered by PATH on the app, not by router — so without these two lines the
// only thing standing between an anonymous request and the owner's institution
// is a null check inside one handler, and the next handler added to that file
// would not have it. This deployment already paid for that lesson once, when
// POST /establish was registered as a new top-level path and inherited neither
// auth nor CSRF.
app.use('/foundry', authMiddleware);
app.use('/foundry/*', authMiddleware);
app.use('/autopilot', authMiddleware);
app.use('/autopilot/*', authMiddleware);
app.use('/talk', authMiddleware);
app.use('/talk/*', authMiddleware);
app.use('/connections', authMiddleware);
app.use('/connections/*', authMiddleware);
app.use('/api/*', apiRateLimit);

// ─── REST API v1, MOUNTED BEFORE ANY ROUTER THAT SITS AT THE ROOT ────────────
//
// This was mounted near the bottom, after five dashboard routers that are
// mounted at '/' and each register `use('*', requireCompanyCapability(...))`.
// In Hono a sub-app's catch-all middleware is merged under its MOUNT PATH, so
// at '/' it applies to every path in the application — including `/api/v1`.
//
// The whole REST API therefore answered `{"error":"Unauthorized"}` to every
// request, valid key or not, because a financial-capability check written for
// `/roi` and `/investors` ran in front of it. Mounted alone `apiV1` answers
// 200; with one of those routers registered above it, 401.
//
// Registering it here fixes that without touching a single capability check —
// the guarded pages stay guarded, which their own tests and the mount test
// below both assert. It IS order-dependent, which is why the ordering is not
// the whole fix: `a-key-that-works-through-the-real-door.test.ts` drives a real
// key through the real app, so a router mounted above this one that shadows the
// API again fails there rather than in a customer's integration.
app.route('/api/v1', apiV1);


// Per-user AI rate limit (30/hr) — front-stop to the AI client's
// per-product daily cost ceiling. Mounted AFTER auth so the founder
// id is available on the context for the keyFn. Routes covered: any
// path that issues an LLM call directly from a user-driven request.
app.use('/api/ask/*', aiRateLimit);
app.use('/api/chat/*', aiRateLimit);
app.use('/decisions/*', aiRateLimit);          // action-draft generation triggers Sonnet
app.use('/validate', aiRateLimit);
app.use('/validate/*', aiRateLimit);
app.use('/plan/*', aiRateLimit);                // weekly plan generation
app.use('/onboarding/run-audit', auditRateLimit); // the most expensive op — stricter cap (6/hr)
app.use('/founder-ops', authMiddleware);
app.use('/founder-ops/*', authMiddleware);

// CSRF protection on all authenticated routes (SEC-03)
import { csrfMiddleware } from './middleware/csrf.js';
app.use('/dashboard/*', csrfMiddleware);
app.use('/onboarding/*', csrfMiddleware);
app.use('/settings', csrfMiddleware);
app.use('/settings/*', csrfMiddleware);
app.use('/products/*', csrfMiddleware);
app.use('/decisions/*', csrfMiddleware);
app.use('/switch-product', csrfMiddleware);
app.use('/checkout', csrfMiddleware);
app.use('/investors/*', csrfMiddleware);
app.use('/team/*', csrfMiddleware);
app.use('/privacy/*', csrfMiddleware);
app.use('/agents/*', csrfMiddleware);
app.use('/playbooks/*', csrfMiddleware);
app.use('/scenarios/*', csrfMiddleware);
app.use('/board/*', csrfMiddleware);
app.use('/memory/*', csrfMiddleware);
app.use('/ambient/*', csrfMiddleware);
app.use('/network/*', csrfMiddleware);
app.use('/exit/*', csrfMiddleware);
app.use('/founder-ops/*', csrfMiddleware);
app.use('/autopilot/*', csrfMiddleware);
app.use('/letter/*', csrfMiddleware);
// Origin proof is a separate question from who may. Nothing on the owner
// surface mutates today — its forms post to the Letter's own routes, which
// carry CSRF above — and it is registered anyway, so the first POST added here
// is covered by construction rather than by whoever remembers.
app.use('/foundry', csrfMiddleware);
app.use('/foundry/*', csrfMiddleware);
app.use('/talk/*', csrfMiddleware);
app.use('/connections/*', csrfMiddleware);
// Origin-verified CSRF is cheap and token-free, so every remaining
// cookie-authenticated state-changing surface gets it too. Bearer-auth
// API calls and Origin-less webhook/CLI callers pass through untouched.
app.use('/api/*', csrfMiddleware);
app.use('/integrations/*', csrfMiddleware);
app.use('/plan/*', csrfMiddleware);
app.use('/roi/*', csrfMiddleware);
app.use('/brief/*', csrfMiddleware);
app.use('/beta/*', csrfMiddleware);
app.use('/koldly/*', csrfMiddleware);
app.use('/founder/*', csrfMiddleware);
app.use('/signals/multimodal/*', csrfMiddleware);
app.use('/digest/*', csrfMiddleware);
app.use('/benchmarks/*', csrfMiddleware);
app.use('/audit-log/*', csrfMiddleware);

// Dashboard routes
app.route('/', dashboardRoutes);
app.route('/', onboardingRoutes);
app.route('/', productRoutes);
app.route('/', auditRoutes);
app.route('/', decisionRoutes);
app.route('/', fleetRoutes);
app.route('/', letterRoutes);
app.route('/', lifecycleRoutes);
app.route('/', digestRoutes);
app.route('/', cohortRoutes);
app.route('/', competitiveRoutes);
app.route('/', betaRoutes);
app.route('/', journeyRoutes);
app.route('/', koldlyRoutes);
app.route('/', settingsRoutes);
app.route('/', revenueRoutes);
app.route('/', portfolioRoutes);
app.route('/', founderOpsRoutes);
app.route('/', planRoutes);
app.route('/', timelineRoutes);
app.route('/', integrationsRoutes);
app.route('/', teamRoutes);
app.route('/', investorRoutes);
// executionPlaybooks must register before playbookRoutes: /playbooks/:type
// would otherwise capture /playbooks/execution and 404 it.
app.route('/', executionPlaybooks);
app.route('/', playbookRoutes);
app.route('/', agentWisdomRoutes);
app.route('/', agentBriefingRoutes);
app.route('/', agentEvolveRoutes);
app.route('/', agentConstitutionRoutes);
app.route('/', agentRemediationRoutes);
app.route('/', agentTemporalRoutes);
// SCP v2/v3: New capability layers
app.route('/', agentIntegrationRoutes);
app.route('/', agentCustomerRoutes);
app.route('/', agentMessageRoutes);
app.route('/', agentStrategyRoutes);
app.route('/', agentExperimentRoutes);
// SCP v4-v7 dashboard pages. These modules define their FULL public paths
// internally (e.g. agents-accuracy registers GET /agents/accuracy), so they
// mount at '/' — a path prefix here would double the path and 404 every
// sidebar link to them. The three exceptions (inbox/okr/decisions) were
// normalized to the same full-path convention.
app.route('/', agentsInbox);
// wiki removed — replaced by company memory graph (/memory)
app.route('/', agentsOkr);
app.route('/', agentsDecisions);
app.route('/', benchmarks);
app.route('/', auditLog);
// SCP v5: Gap-closing features
app.route('/', agentsActions);
app.route('/', agentsAccuracy);
app.route('/', agentsTransparency);
app.route('/', scenarios);
app.route('/', privacySettings);
app.route('/board', boardPacket);
app.route('/', weeklyBrief);
// SCP v6: Full evolved platform
app.route('/', agentsDebate);
app.route('/', agentIntelligence);
app.route('/', memoryGraph);
app.route('/', multimodalSignals);
app.route('/', ambientRoutes);
app.route('/', networkIntelligence);
app.route('/', exitRoutes);
app.route('/', transcriptWebhooks);
app.route('/', voiceReplyWebhook);
// SCP v7: ROI, founder intelligence, integration health, priority API (HTMX)
app.route('/', roiDashboard);
app.route('/', founderIntelligence);
app.route('/', integrationHealth);
app.route('/', priorityApi);
// Agent roster + detail pages (/agents, /agents/:name, …). Mounted at
// /agents and LAST among the /agents/* modules so its /:name pattern can
// never shadow the specific pages (inbox, okr, actions, accuracy, …).
app.route('/agents', agentRoutes);
// API routes
app.route('/', apiProductRoutes);
app.route('/', apiMetricRoutes);
app.route('/', apiAuditLogRoutes);
app.route('/', apiUXRoutes);
app.route('/', apiAskRoutes);
app.route('/', feedbackRoutes);
app.route('/', mobileRoutes);
app.route('/', tier1ApiRoutes);
app.route('/', tier2ApiRoutes);
app.route('/', tier3ApiRoutes);
app.route('/', tier4ApiRoutes);
app.route('/', superchargeApiRoutes);
app.route('/', platformApiRoutes);
app.route('/', founderIntelRoutes);

// ─── 404 Handler ─────────────────────────────────────────────────────────────

app.notFound((c) => {
  if (wantsHtml(c.req.header('accept'), c.req.path)) {
    // HE NEVER LANDS IN THE PRODUCT THIS ONE REPLACED.
    //
    // A mistyped path under /foundry rendered the public marketing shell: a
    // logged-out header, a "Get Started" button pointing at sign-up, a command
    // palette offering Fleet Observatory and Agent Debate. Eight kilobytes of a
    // company he is not a customer of, shown to the only person who owns this.
    if (isOwnerSurface(c.req.path)) {
      return c.html(ownerFailurePage(
        'There is nothing here',
        'That address does not point at anything in your Foundry.'), 404);
    }
    return c.html(
      errorPage(404, 'Page not found', "This page doesn't exist or has moved."),
      404,
    );
  }
  return c.json({ error: 'Not found' }, 404);
});

// ─── Error Handler ───────────────────────────────────────────────────────────

app.onError((err, c) => {
  // THE STACK IS THE ONLY THING THAT MAKES THIS DIAGNOSABLE LATER.
  logger.error('Unhandled error', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    path: c.req.path,
    method: c.req.method,
  });
  if (wantsHtml(c.req.header('accept'), c.req.path)) {
    if (isOwnerSurface(c.req.path)) {
      return c.html(ownerFailurePage(
        'I cannot reach my own records',
        'Something went wrong on my side while I was putting this page together.'), 500);
    }
    return c.html(
      errorPage(500, 'Something went wrong', 'An unexpected error occurred. The team has been notified.'),
      500,
    );
  }
  return c.json({ error: 'Internal server error' }, 500);
});

// ─── Cron Scheduler ──────────────────────────────────────────────────────────

/**
 * EVERY ROUTINE THIS PROCESS STARTED, SO THE DRAIN CAN STOP THEM.
 *
 * The shutdown said the cron jobs would be garbage-collected, which is not what
 * stops a running timer. Nothing kept the handles, so a routine that began
 * during the four-second drain ran against a database the process was about to
 * leave — and on a single-machine deployment that is the only database there is.
 */
const scheduledJobs: CronJob[] = [];

function startScheduler(): void {
  logger.info('Starting job scheduler...');
  for (const [name, job] of Object.entries(JOB_REGISTRY)) {
    try {
      const handle = new CronJob(job.schedule, async () => {
        // Acquire distributed lock to prevent double-execution during rolling deploys
        if (!(await acquireJobLock(name))) {
          logger.info(`Job ${name} skipped (locked by another instance)`, { jobName: name });
          return;
        }
        logger.info(`Running: ${name}`, { jobName: name });
        // A LOG IS NOT A RECORD. Every failure here was logged and forgotten,
        // so a week in which the institution's loops threw on every run looked
        // exactly like a calm week on the page the founder reads. The class
        // name of the error is kept and never its message — see
        // `loop-health.ts` for why.
        const { recordJobFailure, recordJobSuccess } = await import(
          './services/institution/loop-health.js');
        try {
          await job.fn();
          await recordJobSuccess(name).catch(() => { /* health is a record, never a gate */ });
        } catch (err) {
          logger.error(`Error in ${name}`, { jobName: name, error: String(err) });
          await recordJobFailure(name, err).catch(() => { /* as above */ });
        } finally {
          await releaseJobLock(name);
        }
      }, null, true, 'UTC');
      // KEPT, SO IT CAN BE STOPPED. Nothing held these handles, so the drain
      // could not stop a routine even though it said it did.
      scheduledJobs.push(handle);
      noteScheduled();
      logger.info(`Scheduled ${name} — ${job.schedule}`, { jobName: name });
    } catch (err) {
      // THE ONE FAILURE THE HEALTH TABLE CANNOT INFER.
      //
      // A job whose schedule does not build never ticks, so it never reaches
      // the success or failure calls above and never writes a `job_health`
      // row. Absence is what a fresh install looks like too, so the loop
      // report cannot tell the two apart and correctly refuses to guess.
      // Recording it here is the only moment the difference is known: at this
      // point the scheduler has the name, the throw, and the certainty that
      // this job will not run in this process.
      logger.error(`Failed to schedule ${name}`, { jobName: name, error: String(err) });
      void import('./services/institution/loop-health.js')
        .then((m) => m.recordJobFailure(name, err))
        .catch(() => { /* health is a record, never a gate — as in the tick above */ });
    }
  }
}

// ─── Server Start ────────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT ?? '8080', 10);

logger.info(`FOUNDRY starting — port=${port}, env=${process.env.NODE_ENV ?? 'development'}`);

// ─── Serve ───────────────────────────────────────────────────────────────────

import { serve } from '@hono/node-server';

// ─── Starting the process, and why that is a function now ───────────────────
//
// This ran at module scope, so importing `src/index.ts` migrated the database,
// provisioned SCP instances, started the scheduler and BOUND A PORT. No test
// has ever imported it — which is why the static-asset route served corrupted
// bytes for its entire life without anything noticing, and why a large part of
// the route surface is untestable rather than merely untested.
//
// The discriminator is the test runner rather than an entry-point check,
// because the failure DIRECTION matters. `tsx watch` and `node dist/index.js`
// set no such variable, so both are untouched; and if the detection ever
// stopped working, the behaviour would revert to what it has always been —
// starting the server — rather than to a production process that serves
// nothing. A guard on startup has to fail towards starting.
let processStarted = false;

/** Whether this process took the startup branch. Observable because the branch
 *  itself is not: the listen happens inside a promise chain after migrations,
 *  so a test finishes long before a port would be bound and cannot tell the two
 *  cases apart by looking. A mutation removing the guard below passed until
 *  this existed. */
export function isProcessStarted(): boolean {
  return processStarted;
}

function startProcess(): void {
  processStarted = true;
  runMigrations()
    .then(async () => {
      // Provision SCP instances for any existing products that don't have one yet
      try {
        const { ensureProvisioned } = await import('./services/scp/provisioner.js');
        const { getAllActiveProducts } = await import('./db/client.js');
        const products = await getAllActiveProducts();
        for (const row of products.rows) {
          const p = row as Record<string, string>;
          await ensureProvisioned(p.id, p.owner_id).catch((err) => {
            logger.warn(`SCP provision skipped for ${p.id}`, { productId: p.id, error: String(err) });
          });
        }
        logger.info(`SCP: provisioned for ${products.rows.length} product(s)`);
      } catch (err) {
        // Non-fatal: SCP provisioning failure should not block server startup
        logger.warn('SCP provisioning error (non-fatal)', { error: String(err) });
      }

      // Phase 3.1: only the worker (or an all-in-one) process runs the scheduler.
      // The 'web' process group serves HTTP without the 73 in-process crons.
      const role = getProcessRole();
      if (process.env.NODE_ENV === 'production') {
        if (schedulerEnabledForRole(role)) {
          startScheduler();
        } else {
          logger.info(`Scheduler disabled for PROCESS_ROLE=${role}`);
        }
      }
      serve({
        fetch: app.fetch,
        port,
      }, (info) => {
        logger.info(`Listening on http://localhost:${info.port} (role=${role})`);
      });
    })
    .catch((err) => {
      logger.error('Migration error', { error: String(err?.message ?? err) });
      if (process.env.NODE_ENV === 'production') {
        // In production, migration failures are fatal — don't serve with inconsistent schema
        logger.error('FATAL: Migrations failed in production. Exiting.');
        process.exit(1);
      }
      // In development, start anyway with a warning
      const port = parseInt(process.env.PORT ?? '8080');
      serve({ fetch: app.fetch, port }, (info) => {
        logger.info(`Listening on http://localhost:${info.port} (with migration warnings — DEV ONLY)`);
      });
    });

}

// Importing the app must not start a server. `VITEST` is set in every vitest
// worker and nowhere else.
if (!process.env.VITEST) startProcess();

// ─── Graceful Shutdown ───────────────────────────────────────────────────────
// Allow in-flight requests to complete on SIGTERM (deployment) and SIGINT (dev)
let isShuttingDown = false;

function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info(`Received ${signal}, draining...`);

  // STOP THE JOBS, RATHER THAN SAYING SO.
  //
  // This comment claimed the cron jobs would be garbage-collected, which is not
  // what stops a running timer — the handles were never kept, so nothing could
  // stop them, and a job that began during the drain window ran against a
  // database the process was about to leave.
  for (const job of scheduledJobs) job.stop();
  noteAllStopped();
  logger.info(`Stopped ${String(scheduledJobs.length)} scheduled routines.`);

  // Give in-flight requests 4 seconds to complete (Fly.io kill_timeout is 5s)
  setTimeout(() => {
    logger.info('Drain complete, exiting.');
    process.exit(0);
  }, 4000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
