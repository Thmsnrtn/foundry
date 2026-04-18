// =============================================================================
// FOUNDRY — Onboarding Flow
// GitHub connection → repo selection → competitors → first audit
// =============================================================================

import { Hono } from 'hono';
import type { AuthEnv } from '../../middleware/auth.js';
import { query } from '../../db/client.js';
import { listRepos } from '../../services/audit/github.js';
import { runAudit } from '../../services/audit/engine.js';
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

export const onboardingRoutes = new Hono<AuthEnv>();

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

onboardingRoutes.post('/onboarding/create-product', async (c) => {
  const founder = c.get('founder');
  const body = await parseBody(c) as Record<string, string>;

  // Enforce per-tier product limits (mirrors the GitHub onboarding path)
  const productLimits: Record<string, number> = {
    solo: 1,
    growth: 1,
    investor_ready: 5,
  };
  const limit = founder.tier ? (productLimits[founder.tier] ?? 1) : 1;
  const existing = await query(
    "SELECT COUNT(*) as c FROM products WHERE owner_id = ? AND status != 'archived'",
    [founder.id]
  );
  const count = ((existing.rows[0] as Record<string, number>)?.c ?? 0);
  if (count >= limit) {
    const upgradeHint = founder.tier === 'growth'
      ? 'Upgrade to Investor-Ready for up to 5 products.'
      : founder.tier === 'investor_ready'
        ? 'You have reached the 5-product limit.'
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
  const content = onboardingWizard('select_repo', { repos, _token: tokenData.access_token });
  return c.html(dashboardLayout({ ...ctx, showNav: false } as any, content));
});

// Step 3: Select repository
onboardingRoutes.post('/onboarding/select-repo', async (c) => {
  const founder = c.get('founder');
  const body = await parseBody(c) as { repo_owner: string; repo_name: string; access_token: string; market_category?: string };

  // Enforce per-tier product limits
  const productLimits: Record<string, number> = {
    solo: 1,
    growth: 1,
    investor_ready: 5,
  };
  const limit = founder.tier ? (productLimits[founder.tier] ?? 1) : 1;
  const existing = await query(
    "SELECT COUNT(*) as c FROM products WHERE owner_id = ? AND status != 'archived'",
    [founder.id]
  );
  const count = ((existing.rows[0] as Record<string, number>)?.c ?? 0);
  if (count >= limit) {
    const upgradeHint = founder.tier === 'growth'
      ? 'Upgrade to Investor-Ready for up to 5 products.'
      : founder.tier === 'investor_ready'
        ? 'You have reached the 5-product limit.'
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
  const encryptedToken = encrypt(body.access_token);

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
onboardingRoutes.post('/onboarding/competitors', async (c) => {
  const founder = c.get('founder');
  const raw = await parseBody(c);
  const productId = raw.product_id as string;

  const prodCheck = await query('SELECT id FROM products WHERE id = ? AND owner_id = ?', [productId, founder.id]);
  if (prodCheck.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  // Support both JSON array and flat form fields (competitor_1, competitor_2, ...)
  let competitors: Array<{ name: string; website?: string; positioning?: string }>;
  if (Array.isArray(raw.competitors)) {
    competitors = raw.competitors as typeof competitors;
  } else {
    competitors = [];
    for (let i = 0; i < 5; i++) {
      const name = (raw[`competitors[${i}].name`] ?? raw[`competitor_${i + 1}`]) as string | undefined;
      if (name) competitors.push({ name });
    }
  }

  for (const comp of competitors) {
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

// Step 5: Trigger first audit
onboardingRoutes.post('/onboarding/run-audit', async (c) => {
  const founder = c.get('founder');
  const body = await parseBody(c) as { product_id: string };

  const prodResult = await query('SELECT * FROM products WHERE id = ? AND owner_id = ?', [body.product_id, founder.id]);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const product = prodResult.rows[0] as Record<string, unknown>;

  // SEC-01: Decrypt the GitHub access token when reading from DB
  const rawToken = product.github_access_token as string | null;
  const githubToken = rawToken && isEncrypted(rawToken) ? decrypt(rawToken) : rawToken;

  const auditScore = await runAudit({
    id: product.id as string, name: product.name as string, owner_id: product.owner_id as string,
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
  }, 'initial');

  await captureArtifact({
    productId: body.product_id, phase: 'prompt_1', artifactType: 'audit',
    title: `Initial Audit: ${product.name} — ${auditScore.composite?.toFixed(1)}/10`,
    content: JSON.stringify({ composite: auditScore.composite, verdict: auditScore.verdict }),
  });

  // UX Intelligence: award milestones, start tour, generate dimension hints (fire-and-forget)
  await checkAndAwardMilestones(body.product_id, founder.id);
  await startTour(founder.id, body.product_id);
  generateDimensionHints(auditScore.id, body.product_id).catch(() => {});

  return c.redirect('/dashboard?tour=1');
});
