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
import { onboardingWizard } from '../../views/components.js';
import { getLayoutContext } from './_shared.js';
import { checkAndAwardMilestones } from '../../services/ux/milestones.js';
import { startTour } from '../../services/ux/tour.js';
import { generateDimensionHints } from '../../services/ux/hints.js';
import { nanoid } from 'nanoid';

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
  const githubUrl = `https://github.com/login/oauth/authorize?client_id=${ghClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo`;

  const content = onboardingWizard('connect_github', { github_oauth_url: githubUrl });
  return c.html(dashboardLayout({ ...ctx, showNav: false } as any, content));
});

// Step 2: GitHub OAuth callback
onboardingRoutes.get('/onboarding/github/callback', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, '', 'Select Repository');
  const code = c.req.query('code');
  if (!code) return c.json({ error: 'Missing code' }, 400);

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

  const productId = nanoid();
  const repoUrl = `https://github.com/${body.repo_owner}/${body.repo_name}`;

  await query(
    `INSERT INTO products (id, name, owner_id, github_repo_url, github_repo_owner, github_repo_name, github_access_token, market_category)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [productId, body.repo_name, founder.id, repoUrl, body.repo_owner, body.repo_name, body.access_token, body.market_category ?? null]
  );

  // Initialize lifecycle state
  await query(
    `INSERT INTO lifecycle_state (product_id, current_prompt, risk_state) VALUES (?, 'prompt_1', 'green')`,
    [productId]
  );

  return c.redirect(`/onboarding/audit?product_id=${productId}`);
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
  generateDimensionHints(auditScore.id, body.product_id).catch(() => {});

  return c.redirect('/dashboard?tour=1');
});
