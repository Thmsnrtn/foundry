// =============================================================================
// FOUNDRY — Onboarding Flow
// GitHub connection → repo selection → competitors → first audit
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { query } from '../../db/client.js';
import { listRepos } from '../../services/audit/github.js';
import { runAudit } from '../../services/audit/engine.js';
import { captureArtifact } from '../../services/story/engine.js';
import { dashboardLayout } from '../../views/layout.js';
import { onboardingWizard } from '../../views/components.js';
import { getLayoutContext } from './_shared.js';
import { checkAndAwardMilestones } from '../../services/ux/milestones.js';
import { startTour } from '../../services/ux/tour.js';
import { generateDimensionHints } from '../../services/ux/hints.js';
import { nanoid } from 'nanoid';
import { selectRepoSchema, validate } from '../../lib/validation.js';
import { encryptToken, getPlaintextToken } from '../../lib/crypto.js';
import { log } from '../../lib/logger.js';
import { sendAuditResultsEmail } from '../../lib/onboarding-emails.js';

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
  const ctx = await getLayoutContext(founder, '', 'Get Started', undefined, c);
  const ghClientId = process.env.GITHUB_CLIENT_ID ?? '';
  const appUrl = process.env.APP_URL ?? '';
  const redirectUri = `${appUrl}/onboarding/github/callback`;
  const githubUrl = `https://github.com/login/oauth/authorize?client_id=${ghClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo`;

  const content = onboardingWizard('connect_github', { github_oauth_url: githubUrl });
  return c.html(dashboardLayout({ ...ctx, showNav: false } as any, content));
});

// Step 2: GitHub OAuth callback
onboardingRoutes.get('/onboarding/github/callback', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, '', 'Select Repository', undefined, c);
  const code = c.req.query('code');
  if (!code) return c.redirect('/onboarding?error=github_denied');

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
  if (!tokenData.access_token) return c.redirect('/onboarding?error=github_auth_failed');

  const repos = await listRepos(tokenData.access_token);

  // Store token in encrypted HttpOnly cookie instead of passing to view template
  const encryptedToken = encryptToken(tokenData.access_token);
  c.header('Set-Cookie', `__gh_token=${encryptedToken}; Path=/onboarding; HttpOnly; SameSite=Strict; Max-Age=3600${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);

  const content = onboardingWizard('select_repo', { repos });
  return c.html(dashboardLayout({ ...ctx, showNav: false } as any, content));
});

// Step 3: Select repository
onboardingRoutes.post('/onboarding/select-repo', async (c) => {
  const founder = c.get('founder');
  const rawBody = await parseBody(c);

  // Retrieve token from encrypted cookie (not form body)
  const cookie = c.req.header('Cookie') ?? '';
  const tokenCookie = cookie.split(';').find((c) => c.trim().startsWith('__gh_token='));
  const encryptedToken = tokenCookie?.split('=').slice(1).join('=')?.trim();
  if (!encryptedToken) {
    return c.redirect('/onboarding?error=token_expired');
  }
  const accessToken = getPlaintextToken(encryptedToken);
  if (!accessToken) {
    return c.redirect('/onboarding?error=token_invalid');
  }

  const body = validate(selectRepoSchema, { ...rawBody, access_token: accessToken });

  const productId = nanoid();
  const repoUrl = `https://github.com/${body.repo_owner}/${body.repo_name}`;

  // Encrypt the token before storing in database
  const encryptedStorageToken = encryptToken(accessToken);

  await query(
    `INSERT INTO products (id, name, owner_id, github_repo_url, github_repo_owner, github_repo_name, github_access_token, market_category)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [productId, body.repo_name, founder.id, repoUrl, body.repo_owner, body.repo_name, encryptedStorageToken, body.market_category ?? null]
  );

  // Clear the temporary token cookie
  c.header('Set-Cookie', '__gh_token=; Path=/onboarding; HttpOnly; SameSite=Strict; Max-Age=0');

  // Initialize lifecycle state
  await query(
    `INSERT INTO lifecycle_state (product_id, current_prompt, risk_state) VALUES (?, 'prompt_1', 'green')`,
    [productId]
  );

  return c.redirect(`/onboarding/audit?product_id=${productId}`);
});

// Skip GitHub — create product without repo
onboardingRoutes.get('/onboarding/skip-github', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, '', 'Name Your Product', undefined, c);
  const content = html`
  <div class="onboarding-steps">
    <div class="step-card">
      <h2><span class="step-number">1</span> Name Your Product</h2>
      <p>You can connect a GitHub repo later. For now, let's set up Foundry for revenue intelligence and decision management.</p>
      <form method="POST" action="/onboarding/create-manual">
        <div class="form-group">
          <label for="product_name">Product Name</label>
          <input type="text" name="product_name" id="product_name" placeholder="My SaaS Product" required minlength="1" maxlength="100" />
        </div>
        <div class="form-group">
          <label for="market_category">Market Category (optional)</label>
          <select name="market_category" id="market_category">
            <option value="">Select...</option>
            <option value="developer_tools">Developer Tools</option>
            <option value="marketing">Marketing</option>
            <option value="sales">Sales</option>
            <option value="productivity">Productivity</option>
            <option value="analytics">Analytics</option>
            <option value="fintech">Fintech</option>
            <option value="healthcare">Healthcare</option>
            <option value="education">Education</option>
            <option value="ecommerce">E-commerce</option>
            <option value="other">Other</option>
          </select>
        </div>
        <button type="submit" class="btn btn-primary">Create Product</button>
      </form>
    </div>
  </div>`;
  return c.html(dashboardLayout({ ...ctx, showNav: false } as any, content));
});

onboardingRoutes.post('/onboarding/create-manual', async (c) => {
  const founder = c.get('founder');
  const body = await parseBody(c);
  const productName = (body.product_name as string ?? '').trim();
  if (!productName) return c.redirect('/onboarding/skip-github?error=name_required');

  const productId = nanoid();
  await query(
    `INSERT INTO products (id, name, owner_id, market_category) VALUES (?, ?, ?, ?)`,
    [productId, productName, founder.id, (body.market_category as string) || null]
  );
  await query(
    `INSERT INTO lifecycle_state (product_id, current_prompt, risk_state) VALUES (?, 'prompt_4', 'green')`,
    [productId]
  );

  // Skip to prompt_4 (Intelligence Activation) since no audit is possible
  return c.redirect('/dashboard');
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
  const ctx = await getLayoutContext(founder, '', 'Run Audit', undefined, c);
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
  const auditScore = await runAudit({
    id: product.id as string, name: product.name as string, owner_id: product.owner_id as string,
    github_repo_url: product.github_repo_url as string | null,
    github_repo_owner: product.github_repo_owner as string | null,
    github_repo_name: product.github_repo_name as string | null,
    github_access_token: product.github_access_token as string | null,
    stack_description: product.stack_description as string | null,
    market_category: product.market_category as string | null,
    created_at: product.created_at as string, updated_at: product.updated_at as string,
    status: product.status as 'active',
  }, 'initial');

  await captureArtifact({
    productId: body.product_id, phase: 'prompt_1', artifactType: 'audit',
    title: `Initial Audit: ${product.name} — ${auditScore.composite?.toFixed(1)}/10`,
    content: JSON.stringify({ composite: auditScore.composite, verdict: auditScore.verdict }),
  });

  // UX Intelligence: award milestones, start tour, generate dimension hints (fire-and-forget)
  await checkAndAwardMilestones(body.product_id, founder.id);
  await startTour(founder.id, body.product_id);
  generateDimensionHints(auditScore.id, body.product_id).catch((err) => {
    console.error('[onboarding] Failed to generate dimension hints:', err?.message, { auditId: auditScore.id, productId: body.product_id });
  });

  // Send audit results email (the founder's first real value email)
  const blockingIssues = auditScore.blocking_issues ? (typeof auditScore.blocking_issues === 'string' ? JSON.parse(auditScore.blocking_issues) : auditScore.blocking_issues) : [];
  sendAuditResultsEmail(
    founder.email,
    product.name as string,
    auditScore.composite ?? 0,
    auditScore.verdict ?? 'NOT_READY',
    Array.isArray(blockingIssues) ? blockingIssues.length : 0,
    body.product_id,
  ).catch((err) => {
    log.error('Failed to send audit results email', err, { productId: body.product_id });
  });

  return c.redirect('/dashboard?tour=1');
});
