// =============================================================================
// FOUNDRY — Onboarding Flow
// GitHub connection → repo selection → competitors → first audit
// =============================================================================

import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { selectRepoSchema, addCompetitorsSchema } from '../../lib/validation.js';
import { query } from '../../db/client.js';
import { listRepos } from '../../services/audit/github.js';
import { runAudit } from '../../services/audit/engine.js';
import {
  startAuditProgress,
  updateAuditProgress,
  completeAuditProgress,
  failAuditProgress,
  getAuditProgress,
  AUDIT_TOTAL_STEPS,
  type AuditProgress,
} from '../../services/audit/progress.js';
import { captureArtifact } from '../../services/story/engine.js';
import { dashboardLayout } from '../../views/layout.js';
import { html } from 'hono/html';
import { onboardingWizard } from '../../views/components.js';
import { getLayoutContext } from './_shared.js';
import { checkAndAwardMilestones } from '../../services/ux/milestones.js';
import { startTour } from '../../services/ux/tour.js';
import { generateDimensionHints } from '../../services/ux/hints.js';
import { nanoid } from 'nanoid';
import { encrypt, decrypt, isEncrypted } from '../../services/encryption.js';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';

export const onboardingRoutes = new Hono<AuthEnv>();

// ─── Schemas ─────────────────────────────────────────────────────────────────

const createProductSchema = z.object({
  name: z.string().min(1, 'Product name is required').max(100),
  url: z.string().url('Must be a valid URL').max(500).optional().or(z.literal('')),
  build_platform: z.enum([
    'bubble', 'webflow', 'shopify', 'wordpress', 'retool', 'agency_built', 'other',
  ]).optional().default('other'),
  sector_profile: z.enum([
    'b2b_saas', 'consumer', 'marketplace', 'healthcare', 'education',
    'government', 'developer_tools', 'fintech', 'climate_impact', 'vertical_saas',
  ]).optional().default('b2b_saas'),
});

/** Parse body from JSON or form-encoded data (supports both). */
async function parseBody(c: { req: { header: (n: string) => string | undefined; json: () => Promise<any>; parseBody: () => Promise<any> } }): Promise<Record<string, unknown>> {
  const ct = c.req.header('Content-Type') ?? '';
  if (ct.includes('application/json')) return await c.req.json();
  return await c.req.parseBody() as Record<string, unknown>;
}

// Step 1: Show onboarding page
onboardingRoutes.get('/onboarding', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, '', 'Get Started');
  const ghClientId = process.env.GITHUB_CLIENT_ID ?? '';
  const appUrl = process.env.APP_URL ?? '';
  const redirectUri = `${appUrl}/onboarding/github/callback`;

  // Generate CSRF state token for GitHub OAuth (SEC-02 fix)
  const { randomBytes } = await import('node:crypto');
  const oauthState = randomBytes(32).toString('hex');
  // Store state in oauth_states table with 10-minute expiry
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await query(
    `INSERT INTO oauth_states (state, product_id, founder_id, integration_type, redirect_uri, expires_at)
     VALUES (?, 'pending', ?, 'github', ?, ?)`,
    [oauthState, founder.id, redirectUri, expiresAt]
  );

  const githubUrl = `https://github.com/login/oauth/authorize?client_id=${ghClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo&state=${oauthState}`;

  const content = onboardingWizard('connect_github', { github_oauth_url: githubUrl });
  return c.html(dashboardLayout({ ...ctx, showNav: false } as any, content));
});

// Non-code path: URL-based onboarding
onboardingRoutes.get('/onboarding/no-code', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, '', 'Add Your Product');
  const { html } = await import('hono/html');
  const content = html`
  <div class="onboarding-steps">
    <div class="step-card">
      <h2>Add Your Product</h2>
      <p>Tell us about your product and we'll run a web-based audit from its URL.</p>
      <form method="POST" action="/onboarding/create-product">
        <div class="form-group"><label for="name">Product Name</label><input type="text" id="name" name="name" required placeholder="e.g. LabFlow" /></div>
        <div class="form-group"><label for="url">Product URL</label><input type="url" id="url" name="url" required placeholder="https://your-product.com" /></div>
        <div class="form-group"><label for="build_platform">Built With</label>
          <select id="build_platform" name="build_platform">
            <option value="bubble">Bubble</option><option value="webflow">Webflow</option><option value="shopify">Shopify</option>
            <option value="wordpress">WordPress</option><option value="retool">Retool</option><option value="agency_built">Agency Built</option>
            <option value="other">Other</option>
          </select></div>
        <div class="form-group"><label for="sector_profile">Sector</label>
          <select id="sector_profile" name="sector_profile">
            <option value="b2b_saas">B2B SaaS</option><option value="consumer">Consumer</option><option value="marketplace">Marketplace</option>
            <option value="healthcare">Healthcare</option><option value="education">Education</option><option value="government">Government</option>
            <option value="developer_tools">Developer Tools</option><option value="fintech">Fintech</option>
            <option value="climate_impact">Climate/Impact</option><option value="vertical_saas">Vertical SaaS</option>
          </select></div>
        <button type="submit" class="btn btn-primary" style="margin-top:1rem;">Continue →</button>
      </form>
    </div>
  </div>`;
  return c.html(dashboardLayout({ ...ctx, showNav: false } as any, content));
});

onboardingRoutes.post('/onboarding/create-product', validateBody(createProductSchema), async (c) => {
  const founder = c.get('founder');
  const body = c.get('validatedBody' as never) as z.infer<typeof createProductSchema>;

  // Fluency default: the no-code path suggests plain speech. Presentation only —
  // same product; the founder can change this in Settings anytime.
  import('../../services/ux/fluency.js')
    .then(({ setFluencyDefault }) => setFluencyDefault(founder.id, 'plain'))
    .catch(() => {});

  // Enforce per-tier product limits (mirrors the GitHub onboarding path)
  // Solo: 1, Growth: 3, Investor-Ready: unlimited, No tier: 1
  const productLimits: Record<string, number> = {
    solo: 1,
    growth: 3,
  };
  const isUnlimited = founder.tier === 'investor_ready';
  const limit = isUnlimited ? Infinity : (founder.tier ? (productLimits[founder.tier] ?? 1) : 1);
  const existing = await query(
    "SELECT COUNT(*) as c FROM products WHERE owner_id = ? AND status != 'archived'",
    [founder.id]
  );
  const count = ((existing.rows[0] as Record<string, number>)?.c ?? 0);
  if (count >= limit) {
    const upgradeHint = founder.tier === 'growth'
      ? 'Upgrade to Investor-Ready for unlimited products.'
      : 'Your current plan supports 1 product. Upgrade to add more.';
    const ctx = await getLayoutContext(founder, '', 'Product Limit Reached');
    return c.html(dashboardLayout(ctx, html`
      <div class="card" style="max-width:480px;margin:3rem auto;text-align:center;">
        <h2>Product limit reached</h2>
        <p style="color:var(--text-muted);margin:0.75rem 0 1.5rem;">${upgradeHint}</p>
        <a href="/settings" class="btn btn-primary">View upgrade options</a>
        <a href="/dashboard" class="btn btn-ghost" style="margin-left:0.5rem;">Back to dashboard</a>
      </div>
    `));
  }

  const productId = nanoid();

  await query(
    `INSERT INTO products (id, name, owner_id, build_platform, sector_profile, status) VALUES (?, ?, ?, ?, ?, 'active')`,
    [productId, body.name, founder.id, body.build_platform ?? 'other', body.sector_profile ?? 'b2b_saas']
  );

  if (body.url) {
    await query(`INSERT INTO web_audit_results (id, product_id, owner_id, url) VALUES (?, ?, ?, ?)`,
      [nanoid(), productId, founder.id, body.url]);
  }

  await query(`INSERT INTO lifecycle_state (product_id, current_prompt, risk_state) VALUES (?, 'prompt_1', 'green')`, [productId]);

  // Auto-provision SCP agents for the new product (PM finding: was only happening at server restart)
  try {
    const { ensureProvisioned } = await import('../../services/scp/provisioner.js');
    await ensureProvisioned(productId, founder.id);
  } catch {
    // Non-fatal: product is usable without agents, provisioning retries on next server start
  }

  return c.redirect(`/onboarding/competitors?product_id=${productId}`);
});

// Step 2: GitHub OAuth callback
onboardingRoutes.get('/onboarding/github/callback', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, '', 'Select Repository');
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code) return c.json({ error: 'Missing code' }, 400);

  // Validate OAuth state to prevent CSRF (SEC-02 fix)
  if (!state) return c.json({ error: 'Missing state parameter' }, 400);
  const stateResult = await query(
    `SELECT * FROM oauth_states WHERE state = ? AND founder_id = ? AND integration_type = 'github' AND expires_at > datetime('now')`,
    [state, founder.id]
  );
  if (stateResult.rows.length === 0) return c.json({ error: 'Invalid or expired OAuth state' }, 400);
  // Clean up used state
  await query('DELETE FROM oauth_states WHERE state = ?', [state]);

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const tokenData = await tokenResponse.json() as { access_token?: string; error?: string };
  if (!tokenData.access_token) return c.json({ error: 'GitHub auth failed' }, 400);

  const repos = await listRepos(tokenData.access_token);

  // SEC-10: Store encrypted token in httpOnly cookie instead of browser DOM.
  // The token is never exposed in a hidden form field; it's read server-side
  // from the cookie when the repo-select form is submitted.
  const encryptedGhToken = encrypt(tokenData.access_token);
  setCookie(c, '__gh_pending', encryptedGhToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/onboarding',
    maxAge: 600, // 10 minutes
  });

  const content = onboardingWizard('select_repo', { repos });
  return c.html(dashboardLayout({ ...ctx, showNav: false } as any, content));
});

// Step 3: Select repository
onboardingRoutes.post('/onboarding/select-repo', validateBody(selectRepoSchema), async (c) => {
  const founder = c.get('founder');
  // Fluency default: connecting a repo suggests technical fluency (Settings can change it).
  import('../../services/ux/fluency.js')
    .then(({ setFluencyDefault }) => setFluencyDefault(founder.id, 'technical'))
    .catch(() => {});
  // selectRepoSchema enforces repo_owner / repo_name match /^[\w.-]+$/ so
  // the URL we construct below cannot be path-injected.
  const body = c.get('validatedBody' as never) as z.infer<typeof selectRepoSchema>;

  // SEC-10: Read GitHub token from httpOnly cookie (never from form body / DOM)
  const encryptedGhToken = getCookie(c, '__gh_pending');
  if (!encryptedGhToken) return c.json({ error: 'GitHub session expired. Please reconnect.' }, 400);
  const accessToken = decrypt(encryptedGhToken);
  // Clean up the temporary cookie
  deleteCookie(c, '__gh_pending', { path: '/onboarding' });

  // Enforce per-tier product limits
  // Solo: 1, Growth: 3, Investor-Ready: unlimited, No tier: 1
  const productLimits: Record<string, number> = {
    solo: 1,
    growth: 3,
  };
  const isUnlimited = founder.tier === 'investor_ready';
  const limit = isUnlimited ? Infinity : (founder.tier ? (productLimits[founder.tier] ?? 1) : 1);
  const existing = await query(
    "SELECT COUNT(*) as c FROM products WHERE owner_id = ? AND status != 'archived'",
    [founder.id]
  );
  const count = ((existing.rows[0] as Record<string, number>)?.c ?? 0);
  if (count >= limit) {
    const upgradeHint = founder.tier === 'growth'
      ? 'Upgrade to Investor-Ready for unlimited products.'
      : 'Your current plan supports 1 product. Upgrade to add more.';
    const ctx = await getLayoutContext(founder, '', 'Product Limit Reached');
    return c.html(dashboardLayout(ctx, html`
      <div class="card" style="max-width:480px;margin:3rem auto;text-align:center;">
        <h2>Product limit reached</h2>
        <p style="color:var(--text-muted);margin:0.75rem 0 1.5rem;">${upgradeHint}</p>
        <a href="/settings" class="btn btn-primary">View upgrade options</a>
        <a href="/dashboard" class="btn btn-ghost" style="margin-left:0.5rem;">Back to dashboard</a>
      </div>
    `));
  }

  const productId = nanoid();
  const repoUrl = `https://github.com/${body.repo_owner}/${body.repo_name}`;

  // SEC-01: Encrypt the GitHub access token before storing
  const encryptedToken = encrypt(accessToken);

  await query(
    `INSERT INTO products (id, name, owner_id, github_repo_url, github_repo_owner, github_repo_name, github_access_token, market_category)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [productId, body.repo_name, founder.id, repoUrl, body.repo_owner, body.repo_name, encryptedToken, body.market_category ?? null]
  );

  // Initialize lifecycle state
  await query(
    `INSERT INTO lifecycle_state (product_id, current_prompt, risk_state) VALUES (?, 'prompt_1', 'green')`,
    [productId]
  );

  // Auto-provision SCP agents for the new product
  try {
    const { ensureProvisioned } = await import('../../services/scp/provisioner.js');
    await ensureProvisioned(productId, founder.id);
  } catch {
    // Non-fatal: product is usable, provisioning retries on next server start
  }

  return c.redirect(`/onboarding/competitors?product_id=${productId}`);
});

// Step 3b: Show competitor identification form
onboardingRoutes.get('/onboarding/competitors', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, '', 'Identify Competitors');
  const productId = c.req.query('product_id') ?? '';

  const prodCheck = await query('SELECT id FROM products WHERE id = ? AND owner_id = ?', [productId, founder.id]);
  if (prodCheck.rows.length === 0) return c.redirect('/onboarding');

  const content = onboardingWizard('identify_competitors', { product_id: productId });
  return c.html(dashboardLayout({ ...ctx, showNav: false } as any, content));
});

// Step 4: Identify competitors
//
// Accepts either:
//   - JSON: { product_id, competitors: [{ name, website?, positioning? }, ...] }
//   - Form fields: product_id, competitor_1..competitor_5 (or
//     'competitors[i].name' for richer payloads)
//
// Validation runs after normalization so both shapes pass through the same
// guardrails (max 10 competitors, max field lengths, optional URL well-formed).
onboardingRoutes.post('/onboarding/competitors', async (c) => {
  const founder = c.get('founder');
  const raw = await parseBody(c);
  const productId = raw.product_id as string;
  if (!productId || typeof productId !== 'string' || productId.length > 64) {
    return c.json({ error: 'Invalid product_id' }, 400);
  }

  const prodCheck = await query('SELECT id FROM products WHERE id = ? AND owner_id = ?', [productId, founder.id]);
  if (prodCheck.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  // Normalize JSON array vs flat form fields into a single shape, then run
  // the addCompetitorsSchema validator over it.
  let competitorsRaw: Array<{ name: string; website?: string; positioning?: string }>;
  if (Array.isArray(raw.competitors)) {
    competitorsRaw = raw.competitors as typeof competitorsRaw;
  } else {
    competitorsRaw = [];
    for (let i = 0; i < 5; i++) {
      const name = (raw[`competitors[${i}].name`] ?? raw[`competitor_${i + 1}`]) as string | undefined;
      if (name) competitorsRaw.push({ name });
    }
  }

  const validation = addCompetitorsSchema.safeParse({
    product_id: productId,
    competitors: competitorsRaw,
  });
  if (!validation.success) {
    return c.json(
      {
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      },
      422
    );
  }

  for (const comp of validation.data.competitors ?? []) {
    if (!comp.name) continue;
    await query(
      `INSERT INTO competitors (id, product_id, name, website, positioning) VALUES (?, ?, ?, ?, ?)`,
      [nanoid(), productId, comp.name, comp.website ?? null, comp.positioning ?? null]
    );
  }

  return c.redirect(`/onboarding/audit?product_id=${productId}`);
});

// Step 4b: Show audit step
onboardingRoutes.get('/onboarding/audit', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, '', 'Run Audit');
  const productId = c.req.query('product_id') ?? '';
  const content = onboardingWizard('running_audit', { product_id: productId });
  return c.html(dashboardLayout({ ...ctx, showNav: false } as any, content));
});

// Step 5: Trigger first audit.
// This is the flagship onboarding moment. Rather than block the request for
// 2-5 minutes, we kick the audit off asynchronously and immediately return a
// progress page that HTMX-polls /onboarding/audit-status. The audit reports
// step-by-step progress; when it (and the first briefing) finish, the poll
// redirects to /dashboard?tour=1 — so the founder never lands on an empty
// flagship card (Phase 1.1 + 1.2).
onboardingRoutes.post('/onboarding/run-audit', async (c) => {
  const founder = c.get('founder');
  const body = await parseBody(c) as { product_id?: string };

  // Validate input before touching the DB — a missing/blank product_id must be
  // a clean 400, not an "undefined passed to database" 500.
  if (!body.product_id || typeof body.product_id !== 'string') {
    return c.json({ error: 'product_id is required' }, 400);
  }

  const prodResult = await query('SELECT * FROM products WHERE id = ? AND owner_id = ?', [body.product_id, founder.id]);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const product = prodResult.rows[0] as Record<string, unknown>;

  // SEC-01: Decrypt the GitHub access token when reading from DB
  const rawToken = product.github_access_token as string | null;
  const githubToken = rawToken && isEncrypted(rawToken) ? decrypt(rawToken) : rawToken;

  const productId = body.product_id;
  const founderId = founder.id;
  const founderEmail = founder.email;
  const productName = product.name as string;

  await startAuditProgress(productId);

  // Run the audit + first briefing off the request path. Progress is persisted
  // to onboarding_audit_progress and polled by the progress page below.
  void (async () => {
    try {
      const auditScore = await runAudit({
        id: product.id as string, name: productName, owner_id: product.owner_id as string,
        github_repo_url: product.github_repo_url as string | null,
        github_repo_owner: product.github_repo_owner as string | null,
        github_repo_name: product.github_repo_name as string | null,
        github_access_token: githubToken,
        stack_description: product.stack_description as string | null,
        market_category: product.market_category as string | null,
        created_at: product.created_at as string, updated_at: product.updated_at as string,
        status: product.status as 'active',
        sector_profile: 'b2b_saas', growth_stage: 'pre_launch',
        growth_stage_updated_at: null, growth_stage_overridden: false,
      }, 'initial', (step, label) => updateAuditProgress(productId, step, label));

      // Activation funnel: repo connected + audit completed (Phase 5.2).
      void (async () => {
        try {
          const { recordFunnelStep } = await import('../../services/telemetry/funnel.js');
          await recordFunnelStep('repo_connected', { founderId, productId });
          await recordFunnelStep('audit_done', { founderId, productId });
        } catch { /* non-fatal */ }
      })();

      await updateAuditProgress(productId, 8, 'Preparing your dashboard');
      await captureArtifact({
        productId, phase: 'prompt_1', artifactType: 'audit',
        title: `Initial Audit: ${productName} — ${auditScore.composite?.toFixed(1)}/10`,
        content: JSON.stringify({ composite: auditScore.composite, verdict: auditScore.verdict }),
      });

      await checkAndAwardMilestones(productId, founderId);
      await startTour(founderId, productId);
      generateDimensionHints(auditScore.id, productId).catch(() => {});

      // Phase 1.6: auto-draft Product DNA from the repo README so the founder
      // edits instead of typing 10 fields from blank. Fire-and-forget — the
      // DNA page shows a "Draft with AI" button for a manual pass too.
      (async () => {
        try {
          const { autofillProductDNA } = await import('../../services/wisdom/dna-autofill.js');
          await autofillProductDNA(productId, founderId);
        } catch { /* non-fatal */ }
      })();

      // Day-1 activation email (idempotent via the gateway). Fire-and-forget.
      (async () => {
        try {
          const { sendAuditResultsEmail } = await import('../../lib/onboarding-emails.js');
          await sendAuditResultsEmail(
            founderEmail,
            productName,
            auditScore.composite ?? 0,
            (auditScore.verdict as string) ?? 'NOT_READY',
            auditScore.blocking_issues?.length ?? 0,
            productId,
          );
        } catch { /* non-fatal */ }
      })();

      // Step 9: await the first briefing so the CEO-briefing card is populated
      // before we redirect the founder to the dashboard.
      await updateAuditProgress(productId, 9, 'Writing your first briefing');
      try {
        const { generateDailyBriefing } = await import('../../services/scp/briefing.js');
        await generateDailyBriefing(productId);
      } catch (err) {
        // Non-fatal: the daily cron will produce a briefing tomorrow regardless.
        const { logger } = await import('../../services/logger.js');
        logger.warn('immediate post-onboarding briefing failed', { productId, error: String(err) });
      }

      await completeAuditProgress(productId);
    } catch (err) {
      const { logger } = await import('../../services/logger.js');
      logger.error('onboarding audit failed', { productId, error: String(err) });
      await failAuditProgress(productId, err instanceof Error ? err.message : String(err));
    }
  })();

  const ctx = await getLayoutContext(founder, '', 'Running Audit');
  return c.html(dashboardLayout({ ...ctx, showNav: false } as any, auditProgressPage(productId)));
});

// HTMX poll target — returns the live progress fragment. On completion it sets
// HX-Redirect so the browser navigates to the (now non-empty) dashboard.
onboardingRoutes.get('/onboarding/audit-status', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.query('product_id') ?? '';

  // Tenant scope: only the owner may poll their product's progress.
  const owned = await query('SELECT id FROM products WHERE id = ? AND owner_id = ?', [productId, founder.id]);
  if (owned.rows.length === 0) return c.html(auditProgressFragment(null), 404);

  const progress = await getAuditProgress(productId);
  if (progress?.status === 'completed') {
    c.header('HX-Redirect', '/dashboard?tour=1');
    return c.html(html`<div>Done — taking you to your dashboard…</div>`);
  }
  return c.html(auditProgressFragment(progress));
});

// ─── Audit progress UI (Phase 1.1 / 1.2) ─────────────────────────────────────

/** Full progress page shown immediately after the audit is kicked off. */
function auditProgressPage(productId: string) {
  return html`
  <div class="step-card" style="max-width:560px;margin:6vh auto 0;text-align:center;">
    <h2 style="margin-bottom:0.5rem;">Analyzing your product</h2>
    <p style="color:var(--color-text-muted,#9ca3af);margin-bottom:1.5rem;">
      Foundry is reading your codebase across ten dimensions and writing your first briefing.
      This usually takes 2–5 minutes — you can watch it happen below.
    </p>
    <div id="audit-progress"
         hx-get="/onboarding/audit-status?product_id=${productId}"
         hx-trigger="load, every 1500ms"
         hx-swap="innerHTML">
      ${auditProgressFragment(null)}
    </div>
  </div>`;
}

/** Inner fragment re-rendered on every poll. */
function auditProgressFragment(progress: AuditProgress | null) {
  if (progress?.status === 'error') {
    return html`
      <div style="padding:1rem;border-radius:8px;background:rgba(220,38,38,0.1);color:#fca5a5;">
        <p style="margin-bottom:0.75rem;">The audit hit a problem: ${progress.error ?? 'unknown error'}.</p>
        <form method="POST" action="/onboarding/run-audit">
          <input type="hidden" name="product_id" value="${progress.product_id}" />
          <button type="submit" class="btn btn-secondary">Try again</button>
        </form>
      </div>`;
  }

  const total = progress?.total_steps ?? AUDIT_TOTAL_STEPS;
  const step = Math.min(progress?.current_step ?? 0, total);
  const label = progress?.step_label ?? 'Starting…';
  const pct = Math.round((step / total) * 100);

  return html`
    <div style="text-align:left;">
      <div style="display:flex;justify-content:space-between;font-size:0.85rem;color:var(--color-text-muted,#9ca3af);margin-bottom:0.4rem;">
        <span>${label}…</span>
        <span>Step ${step} / ${total}</span>
      </div>
      <div style="height:10px;border-radius:6px;background:rgba(255,255,255,0.08);overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:var(--color-accent,#6366f1);transition:width 0.4s ease;"></div>
      </div>
    </div>`;
}
