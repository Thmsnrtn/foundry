// =============================================================================
// FOUNDRY — Main Application Entry Point
// Hono HTTP server with all routes, middleware, and cron scheduler.
// =============================================================================

// Validate environment variables before anything else
import { validateEnv, env } from './lib/env.js';
validateEnv();

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { CronJob } from 'cron';
import { log } from './lib/logger.js';
import type { AppVariables } from './types/index.js';

// Middleware
import { authMiddleware } from './middleware/auth.js';
import { internalMiddleware } from './middleware/internal.js';
import { requestIdMiddleware, securityHeaders } from './middleware/security.js';
import { apiRateLimit, authRateLimit, webhookRateLimit } from './middleware/rate-limit.js';
import { csrfProtection } from './middleware/csrf.js';

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
import { apiDocsRoutes } from './routes/dashboard/api-docs.js';

// API routes (auth required)
import { apiProductRoutes } from './routes/api/products.js';
import { apiMetricRoutes } from './routes/api/metrics.js';
import { apiAuditLogRoutes } from './routes/api/audit-log.js';
import { apiUXRoutes } from './routes/api/ux.js';
import { searchRoutes } from './routes/api/search.js';

// Internal routes (ecosystem key required, except /health)
import { healthRoutes } from './routes/internal/health.js';
import { ecosystemRoutes } from './routes/internal/ecosystem.js';

// Public API v1 (API key auth)
import { v1Routes, apiKeyRoutes } from './routes/v1/index.js';

// Stripe webhook (raw body needed)
import { handleWebhook } from './services/billing/stripe.js';

// Scheduled jobs
import { JOB_REGISTRY } from './jobs/index.js';

// ─── App Setup ───────────────────────────────────────────────────────────────

const app = new Hono<{ Variables: AppVariables }>();

// Global middleware — order matters
app.use('*', requestIdMiddleware);
app.use('*', securityHeaders);
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  const status = c.res.status;
  const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
  log[level](`${c.req.method} ${c.req.path} ${status}`, {
    requestId: c.get('requestId'),
    method: c.req.method,
    path: c.req.path,
    statusCode: status,
    durationMs: duration,
  });
});
app.use('*', cors({
  origin: env().APP_URL,
  credentials: true,
  maxAge: 86400,
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
    const mimeTypes: Record<string, string> = { css: 'text/css', js: 'application/javascript', svg: 'image/svg+xml' };
    return c.body(content, 200, { 'Content-Type': mimeTypes[ext ?? ''] ?? 'text/plain', 'Cache-Control': 'public, max-age=3600' });
  } catch {
    return c.notFound();
  }
});

// ─── Rate Limiting ──────────────────────────────────────────────────────────

app.use('/auth/*', authRateLimit);
app.use('/webhooks/*', webhookRateLimit);
app.use('/api/*', apiRateLimit);

// ─── Public Routes ───────────────────────────────────────────────────────────

app.route('/', landingRoutes);
app.route('/', pricingRoutes);
app.route('/', caseStudyRoutes);
app.route('/', authRoutes);

// ─── Stripe Webhook (raw body, no auth) ──────────────────────────────────────

app.post('/webhooks/stripe', async (c) => {
  const signature = c.req.header('stripe-signature');
  if (!signature) return c.json({ error: 'Missing signature' }, 400);
  const body = await c.req.text();
  try {
    await handleWebhook(body, signature);
    return c.json({ received: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Distinguish signature verification failure from processing errors
    if (message.includes('signature') || message.includes('No signatures found')) {
      log.warn('Stripe webhook signature verification failed', { error: message });
      return c.json({ error: 'Invalid signature' }, 401);
    }
    log.error('Stripe webhook processing error', err, { path: '/webhooks/stripe' });
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
app.use('/digest/*', authMiddleware);
app.use('/beta/*', authMiddleware);
app.use('/koldly/*', authMiddleware);
app.use('/settings/*', authMiddleware);
app.use('/switch-product', authMiddleware);
app.use('/api/*', authMiddleware);

// CSRF protection on all dashboard form submissions
app.use('/dashboard/*', csrfProtection);
app.use('/onboarding/*', csrfProtection);
app.use('/products/*', csrfProtection);
app.use('/decisions/*', csrfProtection);
app.use('/beta/*', csrfProtection);
app.use('/settings/*', csrfProtection);
app.use('/switch-product', csrfProtection);

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
app.route('/', apiDocsRoutes);

// API routes
app.route('/', apiProductRoutes);
app.route('/', apiMetricRoutes);
app.route('/', apiAuditLogRoutes);
app.route('/', apiUXRoutes);
app.route('/', searchRoutes);

// API key management (session auth)
app.route('/', apiKeyRoutes);

// Public API v1 (API key auth — self-contained, no session needed)
app.route('/', v1Routes);

// ─── 404 Handler ─────────────────────────────────────────────────────────────

app.notFound((c) => {
  const accept = c.req.header('Accept') ?? '';
  if (accept.includes('text/html')) {
    return c.html(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not Found — Foundry</title><link rel="stylesheet" href="/static/styles.css"></head><body>
      <header class="site-header"><div class="header-left"><a href="/" class="logo">Foundry</a></div></header>
      <main class="main-full" style="text-align:center;padding-top:4rem;">
        <h1 style="font-size:4rem;font-weight:800;color:#e5e7eb;">404</h1>
        <h2>Page not found</h2>
        <p style="color:#6b7280;margin-bottom:2rem;">The page you're looking for doesn't exist or has been moved.</p>
        <a href="/dashboard" class="btn btn-primary">Go to Dashboard</a>
      </main></body></html>`, 404);
  }
  return c.json({ error: 'Not found' }, 404);
});

// ─── Error Handler ───────────────────────────────────────────────────────────

app.onError((err, c) => {
  const requestId = c.get('requestId') as string | undefined;
  const status = (err as any).status ?? 500;

  // Validation errors get 400 with details
  if (status === 400 && (err as any).issues) {
    return c.json({
      error: 'Validation failed',
      details: (err as any).issues,
      requestId,
    }, 400);
  }

  log.error('Unhandled error', err, {
    requestId,
    path: c.req.path,
    method: c.req.method,
  });

  return c.json({
    error: status >= 500 ? 'Internal server error' : err.message,
    requestId,
  }, status);
});

// ─── Cron Scheduler ──────────────────────────────────────────────────────────

const cronJobs: CronJob[] = [];

function startScheduler(): void {
  log.info('Starting job scheduler...');
  for (const [name, job] of Object.entries(JOB_REGISTRY)) {
    try {
      const cronJob = new CronJob(job.schedule, async () => {
        const start = Date.now();
        log.info(`[CRON] Running: ${name}`);
        try {
          await job.fn();
          log.info(`[CRON] Completed: ${name}`, { durationMs: Date.now() - start });
        } catch (err) {
          log.error(`[CRON] Error in ${name}`, err, { durationMs: Date.now() - start });
        }
      }, null, true, 'UTC');
      cronJobs.push(cronJob);
      log.info(`  Scheduled: ${name} — ${job.schedule}`);
    } catch (err) {
      log.error(`  Failed to schedule: ${name}`, err);
    }
  }
}

// ─── Server Start ────────────────────────────────────────────────────────────

const port = parseInt(env().PORT, 10);

log.info('FOUNDRY — Autonomous Business Intelligence', {
  port,
  environment: env().NODE_ENV,
  version: '0.1.0',
});

// Start cron jobs in production
if (env().NODE_ENV === 'production') {
  startScheduler();
}

// ─── Serve ───────────────────────────────────────────────────────────────────

import { serve } from '@hono/node-server';

const server = serve({
  fetch: app.fetch,
  port,
}, (info) => {
  log.info(`Listening on http://localhost:${info.port}`);
});

// ─── Graceful Shutdown ──────────────────────────────────────────────────────

function gracefulShutdown(signal: string): void {
  log.info(`Received ${signal}, shutting down gracefully...`);

  // Stop accepting new connections
  server.close(() => {
    log.info('HTTP server closed');
  });

  // Stop all cron jobs
  for (const job of cronJobs) {
    job.stop();
  }
  log.info(`Stopped ${cronJobs.length} cron jobs`);

  // Give in-flight requests time to complete
  setTimeout(() => {
    log.warn('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
