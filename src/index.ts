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
app.use('/api/*', authMiddleware);

// Dashboard routes
app.route('/', dashboardRoutes);
app.route('/', onboardingRoutes);
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
║  FOUNDRY — Autonomous Business Intelligence      ║
║  Port: ${String(port).padEnd(42)}║
║  Environment: ${(process.env.NODE_ENV ?? 'development').padEnd(35)}║
╚══════════════════════════════════════════════════╝
`);

// ─── Serve ───────────────────────────────────────────────────────────────────

import { serve } from '@hono/node-server';

// Run migrations then start server
runMigrations()
  .then(() => {
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
