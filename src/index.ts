// =============================================================================
// FOUNDRY — Main Application Entry Point
// Hono HTTP server with all routes, middleware, and cron scheduler.
// =============================================================================

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { CronJob } from 'cron';

// Middleware
import { authMiddleware } from './middleware/auth.js';
import { internalMiddleware } from './middleware/internal.js';

// Public routes (no auth)
import { landingRoutes, pricingRoutes, caseStudyRoutes } from './routes/public/landing.js';

// Auth routes
import { authRoutes } from './routes/auth/clerk.js';

// Dashboard routes (auth required)
import { dashboardRoutes } from './routes/dashboard/index.js';
import { onboardingRoutes } from './routes/dashboard/onboarding.js';
import { onboardingChat } from './routes/dashboard/onboarding-chat.js';
import { productRoutes } from './routes/dashboard/products.js';
import { auditRoutes } from './routes/dashboard/audit.js';
import { decisionRoutes } from './routes/dashboard/decisions.js';
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
import { agentsWiki } from './routes/dashboard/agents-wiki.js';
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
// REST API v1 (API key auth)
import { apiV1 } from './api/v1/index.js';

// API routes (auth required)
import { apiProductRoutes } from './routes/api/products.js';
import { apiMetricRoutes } from './routes/api/metrics.js';
import { apiAuditLogRoutes } from './routes/api/audit-log.js';
import { apiUXRoutes } from './routes/api/ux.js';
import { apiAskRoutes } from './routes/api/ask.js';
import { mobileRoutes } from './routes/api/mobile.js';

// Internal routes (ecosystem key required, except /health)
import { healthRoutes } from './routes/internal/health.js';
import { ecosystemRoutes } from './routes/internal/ecosystem.js';

// Stripe webhook (raw body needed)
import { handleWebhook } from './services/billing/stripe.js';

// Scheduled jobs
import { JOB_REGISTRY } from './jobs/index.js';

// Database migrations
import { runMigrations } from './db/migrate.js';

// ─── Startup Validation ───────────────────────────────────────────────────────

const REQUIRED_ENV_VARS = [
  'TURSO_DATABASE_URL',
  'CLERK_SECRET_KEY',
  'CLERK_PUBLISHABLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_SOLO_PRICE_ID',
  'STRIPE_GROWTH_PRICE_ID',
  'STRIPE_INVESTOR_READY_PRICE_ID',
  'ANTHROPIC_API_KEY',
];

const missing = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);
if (missing.length > 0) {
  console.warn(`[STARTUP] Missing env vars: ${missing.join(', ')}`);
  if (process.env.NODE_ENV === 'production') {
    console.error('[STARTUP] Required env vars missing in production — exiting.');
    process.exit(1);
  }
}

// ─── App Setup ───────────────────────────────────────────────────────────────

const app = new Hono();

// Global middleware
app.use('*', logger());
app.use('*', cors({
  origin: process.env.APP_URL ?? 'http://localhost:8080',
  credentials: true,
}));

// ─── Static Files ─────────────────────────────────────────────────────────────

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

app.get('/static/:file', (c) => {
  const fileName = c.req.param('file');
  if (!/^[\w.-]+$/.test(fileName)) return c.notFound();
  try {
    const filePath = resolve(__dirname, 'public', fileName);
    const content = readFileSync(filePath, 'utf-8');
    const ext = fileName.split('.').pop();
    const mimeTypes: Record<string, string> = { css: 'text/css', js: 'application/javascript', svg: 'image/svg+xml', json: 'application/json', png: 'image/png' };
    return c.body(content, 200, { 'Content-Type': mimeTypes[ext ?? ''] ?? 'text/plain', 'Cache-Control': 'public, max-age=3600' });
  } catch {
    return c.notFound();
  }
});

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

app.route('/', landingRoutes);
app.route('/', pricingRoutes);
app.route('/', caseStudyRoutes);
app.route('/', authRoutes);
app.route('/', shareRoutes);
app.route('/', ingestRoutes);

// ─── Stripe Webhook (raw body, no auth) ──────────────────────────────────────

app.post('/webhooks/stripe', async (c) => {
  const signature = c.req.header('stripe-signature');
  if (!signature) return c.json({ error: 'Missing signature' }, 400);
  const body = await c.req.text();
  try {
    await handleWebhook(body, signature);
    return c.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook error:', err);
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
app.use('/setup', authMiddleware);
app.use('/setup/*', authMiddleware);
app.use('/products/*', authMiddleware);
app.use('/decisions/*', authMiddleware);
app.use('/api/decisions/*', authMiddleware);
app.use('/digest/*', authMiddleware);
app.use('/beta/*', authMiddleware);
app.use('/koldly/*', authMiddleware);
app.use('/settings', authMiddleware);
app.use('/settings/*', authMiddleware);
app.use('/plan', authMiddleware);
app.use('/plan/*', authMiddleware);
app.use('/signal/*', authMiddleware);
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
app.use('/api/*', authMiddleware);
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
app.use('/setup', authMiddleware);
app.use('/setup/*', authMiddleware);

// Dashboard routes
app.route('/', dashboardRoutes);
app.route('/', onboardingRoutes);
app.route('/', onboardingChat);
app.route('/', productRoutes);
app.route('/', auditRoutes);
app.route('/', decisionRoutes);
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
app.route('/', planRoutes);
app.route('/', timelineRoutes);
app.route('/', integrationsRoutes);
app.route('/', teamRoutes);
app.route('/', investorRoutes);
app.route('/', playbookRoutes);
app.route('/', agentRoutes);
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
// SCP v4: New dashboard pages
app.route('/agents/inbox', agentsInbox);
app.route('/agents/wiki', agentsWiki);
app.route('/agents/okr', agentsOkr);
app.route('/agents/decisions', agentsDecisions);
app.route('/benchmarks', benchmarks);
app.route('/audit-log', auditLog);
// SCP v5: Gap-closing features
app.route('/agents/actions', agentsActions);
app.route('/agents/accuracy', agentsAccuracy);
app.route('/agents/transparency', agentsTransparency);
app.route('/scenarios', scenarios);
app.route('/privacy', privacySettings);
app.route('/board', boardPacket);
app.route('/brief', weeklyBrief);
// REST API v1 (API key auth — no session needed)
app.route('/api/v1', apiV1);

// API routes
app.route('/', apiProductRoutes);
app.route('/', apiMetricRoutes);
app.route('/', apiAuditLogRoutes);
app.route('/', apiUXRoutes);
app.route('/', apiAskRoutes);
app.route('/', mobileRoutes);

// ─── 404 Handler ─────────────────────────────────────────────────────────────

app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// ─── Error Handler ───────────────────────────────────────────────────────────

app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

// ─── Cron Scheduler ──────────────────────────────────────────────────────────

function startScheduler(): void {
  console.log('Starting job scheduler...');
  for (const [name, job] of Object.entries(JOB_REGISTRY)) {
    try {
      new CronJob(job.schedule, async () => {
        console.log(`[CRON] Running: ${name}`);
        try {
          await job.fn();
        } catch (err) {
          console.error(`[CRON] Error in ${name}:`, err);
        }
      }, null, true, 'UTC');
      console.log(`  ✓ ${name} — ${job.schedule}`);
    } catch (err) {
      console.error(`  ✗ ${name} — failed to schedule:`, err);
    }
  }
}

// ─── Server Start ────────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT ?? '8080', 10);

console.log(`
╔══════════════════════════════════════════════════╗
║  FOUNDRY — Sovereign Company Platform            ║
║  Port: ${String(port).padEnd(42)}║
║  Environment: ${(process.env.NODE_ENV ?? 'development').padEnd(35)}║
╚══════════════════════════════════════════════════╝
`);

// ─── Serve ───────────────────────────────────────────────────────────────────

import { serve } from '@hono/node-server';

// Run migrations then start server
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
          console.warn(`[STARTUP] SCP provision skipped for ${p.id}:`, err);
        });
      }
      console.log(`[STARTUP] SCP: provisioned for ${products.rows.length} product(s)`);
    } catch (err) {
      // Non-fatal: SCP provisioning failure should not block server startup
      console.warn('[STARTUP] SCP provisioning error (non-fatal):', err);
    }

    if (process.env.NODE_ENV === 'production') {
      startScheduler();
    }
    serve({
      fetch: app.fetch,
      port,
    }, (info) => {
      console.log(`Listening on http://localhost:${info.port}`);
    });
  })
  .catch((err) => {
    console.error('[STARTUP] Migration failed — cannot start:', err);
    process.exit(1);
  });

export default app;
