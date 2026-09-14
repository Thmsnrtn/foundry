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
import { publicRateLimit, apiRateLimit, authRateLimit, webhookRateLimit, aiRateLimit } from './middleware/rate-limit.js';
import { internalMiddleware } from './middleware/internal.js';

// Public routes (no auth)
import { landingRoutes } from './routes/public/door.js';

// Auth routes
import { authRoutes } from './routes/auth/clerk.js';

// Dashboard routes (auth required)
import { onboardingRoutes } from './routes/dashboard/onboarding.js';
import { letterRoutes } from './routes/dashboard/letter.js';
import { noteAllStopped, noteScheduled } from './lib/scheduler-standing.js';
import { isPrivateOwnerInstance } from './lib/instance-posture.js';
import { ownerFailurePage } from './routes/dashboard/foundry-shell.js';
import { isOwnerSurface } from './lib/owner-surface-script.js';
import { settingsRoutes } from './routes/dashboard/settings.js';

// Share routes (public, token-gated)
import { shareRoutes } from './routes/share/index.js';

// Metric Ingest (public, token-gated)
import { ingestRoutes } from './routes/ingest/index.js';

// Signal Timeline

// Weekly Operating Plan

// New routes: Integrations, Team, Investors, Playbooks

// SCP: Agent Roster + all SCP sub-routes
// SCP v2/v3: New capability layers
// SCP v4: New dashboard pages
// SCP v5: Gap-closing — execution, forecasting, investor layer, accuracy, privacy
import { privacySettings } from './routes/dashboard/privacy.js';
// SCP v6: Full evolved platform
// SCP v7: ROI dashboard, founder intelligence, integration health, priority API
// REST API v1 (API key auth)
import { apiV1 } from './api/v1/index.js';

// API routes (auth required)

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
// Six mounts became one. `/` is a door to the owner's instance; the pricing,
// case-study, manifesto, help, privacy-policy and terms pages sold and
// documented Commercial Foundry, and apexmicro.ai is the public face now.
// See `routes/public/door.ts` for what went and why.
app.route('/', landingRoutes);
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

// WHETHER THE ROUTES THE OWNER PRESSES ARE IN THIS RELEASE.
//
// The owner opened the deployed product and got a 404 from the only button on
// the screen, and the deploy had reported success — because success meant
// /internal/health answered 200, a probe that cannot see a page, a link or a
// form. A post-deploy check cannot ask as him either: under /foundry the
// session middleware answers 401 before routing, so an unauthenticated request
// to a route that does not exist looks exactly like one to a route that does.
//
// This is the smallest thing that closes that gap: the paths this release
// actually registered under the owner's prefix. It lists paths, never handlers
// or data, and every one of them is already visible to him in the HTML of his
// own pages.
// ASKED, NOT ENUMERATED.
//
// This returned the whole inventory to anyone. The reasoning was that every
// path is already visible to him in the HTML of his own pages — true for HIM,
// and he is the only one who can load those pages. To a stranger, who gets 401
// from every one of them, the complete list of his routes was new information
// and this was the only place to get it. A gate whose subject is exactly "what
// a reader with no account can see" caught it.
//
// So it answers a question instead of publishing an answer: name the routes you
// expect and it says which are missing. A stranger can confirm a guess and
// cannot harvest a map, which is the difference that matters.
//
// The stronger version needs a secret the deploy workflow does not currently
// hold: it has FLY_API_TOKEN only, so the check would have to run inside the
// machine, where ECOSYSTEM_SERVICE_KEY is already in the environment. Worth
// doing when the workflow is next opened; not worth guessing at blind.
app.get('/internal/routes', (c) => {
  const want = c.req.queries('want') ?? [];
  const registered = new Set(app.routes
    .filter((r) => r.path === '/foundry' || r.path.startsWith('/foundry/'))
    .map((r) => `${r.method} ${r.path}`));
  if (want.length === 0) {
    return c.json({ asked: 0, missing: [],
      hint: 'name routes with ?want=METHOD%20/path — this does not list them' });
  }
  return c.json({
    asked: want.length,
    missing: want.filter((w) => !registered.has(w)),
  });
});

// All other internal routes require ecosystem service key
app.use('/internal/*', async (c, next) => {
  // Health and the route inventory are the two things a deploy has to be able
  // to ask before it can hold a key, and neither returns anything that is not
  // already in the HTML of the owner's own pages.
  if (c.req.path === '/internal/health' || c.req.path === '/internal/routes') return next();
  return internalMiddleware(c, next);
});
app.route('/', ecosystemRoutes);

// ─── Authenticated Routes ────────────────────────────────────────────────────

// Apply auth middleware to all dashboard and API routes
app.use('/onboarding/*', authMiddleware);
app.use('/settings', authMiddleware);
app.use('/settings/*', authMiddleware);
// Cookie/session APIs use Clerk. Machine-facing REST API v1 owns its bearer
// API-key authentication in apiV1 and must not have that credential consumed
// as a Clerk token first.
app.use('/api/*', sessionAuthForApiRoutes);
app.use('/privacy', authMiddleware);
app.use('/privacy/*', authMiddleware);
// SCP v7 auth
// SCP v6 auth
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

// ─── EIGHTY-NINE MOUNTS THAT GUARDED NOTHING ─────────────────────────────────
//
// Auth, CSRF and rate-limit middleware were registered on fifty-nine path
// prefixes with no route behind any of them: /investors, /board, /benchmarks,
// /playbooks, /roi, /team, /memory, /network, /exit, /scenarios, /ambient,
// /integrations, /agents, /dashboard, /plan, /checkout and the rest. Those were
// Commercial Foundry's surfaces. The routers are deleted; the guards on their
// doors outlived the doors by about a hundred lines.
//
// Harmless at runtime and misleading to read, which is the reason to remove
// them: a reader checking whether a surface is protected finds a mount and
// stops there, and the mount says nothing about whether the route exists. What
// remains is the list of prefixes this application actually serves. The crawl
// (`tests/simulation/crawl.ts`) checks the other direction on every run — a
// route with no auth in front of it is a defect there — so the two halves are
// held from both ends rather than by this list being carefully maintained.
//
// THE ONE THING THAT WAS NOT DEAD: the per-user AI rate limit. It was mounted
// on /api/ask, /api/chat, /decisions, /validate and /plan — all deleted — which
// left the two paths that DO call a model from a user's request with no cap but
// the AI client's per-product daily ceiling. They are named here instead.
app.use('/foundry/ask', aiRateLimit);
app.use('/talk/message', aiRateLimit);

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

// CSRF protection on all authenticated routes (SEC-03)
import { csrfMiddleware } from './middleware/csrf.js';
app.use('/onboarding/*', csrfMiddleware);
app.use('/settings', csrfMiddleware);
app.use('/settings/*', csrfMiddleware);
app.use('/privacy/*', csrfMiddleware);
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

// Dashboard routes
// ── The owner's instance ─────────────────────────────────────────────────────
//
// Everything Private Foundry needs, and nothing else.
app.route('/', onboardingRoutes);
app.route('/', letterRoutes);
app.route('/', settingsRoutes);
app.route('/', privacySettings);

// ── Commercial Foundry ───────────────────────────────────────────────────────
//
// SEVENTY-TWO MOUNTS THE OWNER HAS NO USE FOR.
//
// This is the product Foundry was built to replace: agents, boards, playbooks,
// fleet observatories, ambient layers, ROI dashboards. It was not dormant — its
// navigation rendered on the advanced surface two taps from his first screen,
// and every route was live.
//
// The owner may one day build Commercial Foundry using Private Foundry. Until
// then it is not to bog down the private instance. It is preserved in full:
// branch `archive/commercial-foundry`, and in git history forever.
//
// Not deleted, because the services underneath are shared and separating them
// means deciding file by file which half of the system each belongs to — a
// decision worth making when the commercial product is actually being built.
// Unmounted is the honest state: the code exists, and his instance does not
// serve it.
// ── Commercial Foundry, deleted ──────────────────────────────────────────────
//
// Seventy-two route modules and twenty-two thousand lines the owner could not
// reach: agents, boards, playbooks, fleet observatories, ambient layers, ROI
// dashboards. They were unmounted on this instance and still imported,
// type-checked and tested, which made them load-bearing for CI and for nothing
// else. Deleted here on 2026-09-13; preserved in full on branch
// `archive/commercial-foundry` at 9049f60e and in history.
//
// The services beneath them are shared and stay. Some are now reached only by
// the tests that were written against those routes; separating those is its
// own pass, and it is named in OWNER_OS_MIGRATION.md rather than started here.

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
