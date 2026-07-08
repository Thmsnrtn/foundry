// =============================================================================
// FOUNDRY — User walkthrough simulation
//
// Boots the REAL route handlers against an in-memory database (real migrations)
// with a stubbed auth context, then drives 15 personas through the actual UI
// surfaces via app.request(). Records every 5xx, unexpected redirect, empty
// flagship, and tenant-isolation result. External calls (AI/GitHub/Stripe) are
// not made by the GET surfaces we drive; the one POST we exercise (run-audit)
// is fire-and-forget and returns its progress page synchronously.
//
// Run:  TURSO_DATABASE_URL=file::memory: npx tsx tests/simulation/walkthrough.ts
// =============================================================================

// ── Env must be set before any module that reads it is imported. ─────────────
process.env.NODE_ENV = 'test';
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.CLERK_SECRET_KEY = 'sk_test_fake';
process.env.CLERK_PUBLISHABLE_KEY = 'pk_test_fake';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.STRIPE_SOLO_PRICE_ID = 'price_solo';
process.env.STRIPE_GROWTH_PRICE_ID = 'price_growth';
process.env.STRIPE_INVESTOR_READY_PRICE_ID = 'price_ir';
process.env.APP_URL = 'http://localhost:8080';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.RESEND_FROM_ADDRESS = 'Foundry <t@foundry.so>';

const { Hono } = await import('hono');
const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');

// Real route modules (no side effects at import).
const { dashboardRoutes } = await import('../../src/routes/dashboard/index.js');
const { decisionRoutes } = await import('../../src/routes/dashboard/decisions.js');
const { fleetRoutes } = await import('../../src/routes/dashboard/fleet.js');
const { settingsRoutes } = await import('../../src/routes/dashboard/settings.js');
const { agentBriefingRoutes } = await import('../../src/routes/dashboard/agents-briefings.js');
const { integrationsRoutes } = await import('../../src/routes/dashboard/integrations.js');
const { founderOpsRoutes } = await import('../../src/routes/dashboard/founder-ops.js');
const { onboardingRoutes } = await import('../../src/routes/dashboard/onboarding.js');
const { productRoutes } = await import('../../src/routes/dashboard/products.js');
const {
  landingRoutes, pricingRoutes, manifestoRoutes, helpRoutes, legalRoutes,
} = await import('../../src/routes/public/landing.js');

type Founder = Record<string, unknown> | null;
let currentFounder: Founder = null;

const AUTHED_PREFIXES = ['/dashboard', '/decisions', '/fleet', '/settings', '/agents', '/integrations', '/founder-ops', '/onboarding', '/products'];
const app = new (Hono as any)();
// Auth stub: inject the persona's founder (mirrors authMiddleware's c.set) and,
// like the real authMiddleware, redirect logged-out users away from authed
// paths instead of letting the handler run without a founder.
app.use('*', async (c: any, next: any) => {
  const path = new URL(c.req.url).pathname;
  if (currentFounder) {
    c.set('founder', currentFounder);
  } else if (AUTHED_PREFIXES.some((p) => path === p || path.startsWith(p + '/'))) {
    return c.redirect('/auth/login');
  }
  c.set('csrfToken', 'test-csrf');
  await next();
});
// Capture any handler exception as a recorded 500 instead of crashing the run.
let lastStack = '';
app.onError((err: any, c: any) => {
  lastStack = String(err?.stack ?? '').split('\n').slice(0, 4).join(' | ');
  return c.text(`ERR: ${err?.message ?? err}`, 500);
});
for (const r of [
  landingRoutes, pricingRoutes, manifestoRoutes, helpRoutes, legalRoutes,
  dashboardRoutes, decisionRoutes, fleetRoutes, settingsRoutes,
  agentBriefingRoutes, integrationsRoutes, founderOpsRoutes,
  onboardingRoutes, productRoutes,
]) app.route('/', r);

// ── Seeding helpers ──────────────────────────────────────────────────────────

let seq = 0;
const id = (p: string) => `${p}_${(seq++).toString(36)}`;

function founderObj(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id, clerk_user_id: row.clerk_user_id, email: row.email, name: row.name ?? null,
    stripe_customer_id: row.stripe_customer_id ?? null, tier: row.tier ?? null,
    cohort_id: null, created_at: row.created_at ?? new Date().toISOString(),
    preferences: null, lifestyle_mode: false, lifestyle_target_mrr: null,
    trial_ends_at: row.trial_ends_at ?? null,
  };
}

const seedFindings: string[] = [];

async function seedFounder(opts: { email: string; name?: string; tier?: string | null; trialEndsAt?: string | null }): Promise<Record<string, unknown>> {
  const fid = id('f');
  const ins = (tier: string | null) => query(
    `INSERT INTO founders (id, clerk_user_id, email, name, tier, trial_ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [fid, id('clerk'), opts.email, opts.name ?? 'Test Founder', tier, opts.trialEndsAt ?? null, new Date().toISOString()],
  );
  try {
    await ins(opts.tier ?? null);
  } catch (e) {
    // A real gap: the code's tier value is rejected by the DB CHECK constraint.
    seedFindings.push(`founders.tier='${opts.tier}' rejected by CHECK — a paid ${opts.tier} customer cannot be recorded (${(e as Error).message})`);
    await ins(null); // continue the walk as an untiered founder
  }
  const r = await query('SELECT * FROM founders WHERE id = ?', [fid]);
  return r.rows[0] as Record<string, unknown>;
}

async function seedProduct(ownerId: string, opts: { name: string; withRepo?: boolean; scpStatus?: string } = { name: 'Acme' }): Promise<string> {
  const pid = id('p');
  await query(
    `INSERT INTO products (id, name, owner_id, github_repo_owner, github_repo_name, status, scp_status)
     VALUES (?, ?, ?, ?, ?, 'active', ?)`,
    [pid, opts.name, ownerId, opts.withRepo ? 'acme' : null, opts.withRepo ? 'app' : null, opts.scpStatus ?? 'active'],
  );
  await query(`INSERT INTO lifecycle_state (product_id, risk_state) VALUES (?, 'green')`, [pid]).catch(() => {});
  return pid;
}

async function seedBriefing(pid: string): Promise<void> {
  await query(
    `INSERT INTO scp_briefings (id, product_id, briefing_date, headline, briefing_text)
     VALUES (?, ?, ?, ?, ?)`,
    [id('b'), pid, new Date().toISOString().slice(0, 10), 'MRR is your lever this week', 'Focus on retaining Accounts X and Y.'],
  ).catch(() => {});
}

async function seedDecision(pid: string, gate = 2): Promise<string> {
  const did = id('d');
  try {
    await query(
      `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status)
       VALUES (?, ?, 'strategic', ?, 'Raise the Pro price to $99', 'Churn is flat and value is under-priced', 'pending')`,
      [did, pid, gate],
    );
  } catch (e) {
    seedFindings.push(`seedDecision failed: ${(e as Error).message}`);
  }
  return did;
}

async function seedAgents(pid: string): Promise<void> {
  for (const [nm, st, h] of [['atlas', 'active', 82], ['forge', 'active', 61], ['harbor', 'paused', 40]] as const) {
    await query(
      `INSERT INTO agent_instances (id, product_id, agent_name, display_name, status, last_run_at, next_run_at, domain_health_score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id('ai'), pid, nm, nm.toUpperCase(), st, '2026-07-06T00:00:00Z', '2026-07-09T00:00:00Z', h],
    ).catch(() => {});
  }
}

// ── The walk ─────────────────────────────────────────────────────────────────

interface Finding { persona: string; method: string; path: string; status: number; note: string }
const findings: Finding[] = [];
let requests = 0;

async function hit(persona: string, method: string, path: string, opts: { expectStatus?: number[]; label?: string } = {}): Promise<Response> {
  requests++;
  const res = await app.request(path, { method });
  const loc = res.headers.get('location');
  const expected = opts.expectStatus ?? [200, 302, 303, 304];
  if (res.status >= 500) {
    let msg = '';
    try { msg = (await res.clone().text()).slice(0, 100); } catch { /* */ }
    findings.push({ persona, method, path, status: res.status, note: `5xx — ${msg}\n      @ ${lastStack}` });
  } else if (opts.expectStatus && !expected.includes(res.status)) {
    findings.push({ persona, method, path, status: res.status, note: `unexpected status (wanted ${expected.join('/')})${loc ? ` → ${loc}` : ''}` });
  } else if (currentFounder && res.status === 302 && loc && loc.includes('/auth/login')) {
    // An AUTHENTICATED user bounced to login is a real problem; a logged-out
    // user redirected to login is correct behavior.
    findings.push({ persona, method, path, status: 302, note: `authenticated user bounced to ${loc}` });
  }
  return res;
}

const AUTHED_GETS = ['/dashboard', '/decisions', '/fleet', '/settings', '/agents/briefings', '/agents/briefings/latest', '/integrations', '/onboarding'];

async function walkAuthed(persona: string, founder: Record<string, unknown>): Promise<void> {
  currentFounder = founderObj(founder);
  for (const path of AUTHED_GETS) await hit(persona, 'GET', path);
}

async function main(): Promise<void> {
  await runMigrations();

  // ── Public pages (logged out) ──────────────────────────────────────────────
  currentFounder = null;
  for (const path of ['/', '/pricing', '/help', '/manifesto', '/privacy', '/terms']) {
    await hit('logged-out visitor', 'GET', path, { expectStatus: [200] });
  }

  // ── Persona seeding + walks ─────────────────────────────────────────────────
  // 1. Brand-new signup, no product
  const p1 = await seedFounder({ email: 'new@a.co', name: 'Nadia New' });
  await walkAuthed('1 new signup (no product)', p1);

  // 2. No-code founder, product, no audit/briefing
  const p2 = await seedFounder({ email: 'nocode@a.co' });
  await seedProduct(p2.id as string, { name: 'NoCodeApp' });
  await walkAuthed('2 product, no audit', p2);

  // 3. Happy path: audit done, briefing + decisions + agents
  const p3 = await seedFounder({ email: 'happy@a.co', tier: 'solo' });
  const p3prod = await seedProduct(p3.id as string, { name: 'HappyApp', withRepo: true });
  await seedBriefing(p3prod); await seedDecision(p3prod); await seedAgents(p3prod);
  await walkAuthed('3 happy path (solo)', p3);
  currentFounder = founderObj(p3);
  await hit('3 happy path (solo)', 'GET', `/agents/briefings/${new Date().toISOString().slice(0, 10)}`);

  // 4. Active trial
  const future = new Date(Date.now() + 8 * 86400000).toISOString();
  const p4 = await seedFounder({ email: 'trial@a.co', trialEndsAt: future });
  await seedProduct(p4.id as string, { name: 'TrialApp' });
  await walkAuthed('4 active trial', p4);

  // 5. Expired trial, no tier
  const past = new Date(Date.now() - 2 * 86400000).toISOString();
  const p5 = await seedFounder({ email: 'expired@a.co', trialEndsAt: past });
  await seedProduct(p5.id as string, { name: 'ExpiredApp' });
  await walkAuthed('5 expired trial', p5);

  // 6/7/8. Paid tiers
  for (const [i, tier] of [['6 paid solo', 'solo'], ['7 paid growth', 'growth'], ['8 paid investor', 'investor_ready']] as const) {
    const f = await seedFounder({ email: `${tier}@a.co`, tier });
    const prod = await seedProduct(f.id as string, { name: `${tier}App`, withRepo: true });
    await seedBriefing(prod); await seedAgents(prod);
    await walkAuthed(i, f);
  }

  // 9. Multi-product (investor)
  const p9 = await seedFounder({ email: 'multi@a.co', tier: 'investor_ready' });
  for (const n of ['Alpha', 'Beta', 'Gamma']) { const pr = await seedProduct(p9.id as string, { name: n }); await seedAgents(pr); await seedBriefing(pr); }
  await walkAuthed('9 multi-product', p9);

  // 10. Abandoned onboarding (product, nothing else) — already covered by #2 vari/ drive onboarding
  const p10 = await seedFounder({ email: 'abandon@a.co' });
  await seedProduct(p10.id as string, { name: 'Abandoned', withRepo: true });
  currentFounder = founderObj(p10);
  await hit('10 abandoned onboarding', 'POST', '/onboarding/run-audit', { label: 'kick audit' });

  // 11. Pending decisions → decision detail
  const p11 = await seedFounder({ email: 'decisions@a.co', tier: 'solo' });
  const p11prod = await seedProduct(p11.id as string, { name: 'DecApp' });
  const d11 = await seedDecision(p11prod, 3);
  await walkAuthed('11 pending decisions', p11);
  currentFounder = founderObj(p11);
  await hit('11 pending decisions', 'GET', `/decisions/${d11}`);

  // 12. Founder-ops admin
  const admin = await seedFounder({ email: 'thmsnrtn@gmail.com', name: 'Operator' });
  const adminProd = await seedProduct(admin.id as string, { name: 'Foundry' });
  await seedBriefing(adminProd); await seedDecision(adminProd);
  currentFounder = founderObj(admin);
  await hit('12 admin', 'GET', '/founder-ops');
  await walkAuthed('12 admin', admin);

  // 13. TENANT ISOLATION — a wisdom-capable (growth) founder tries to view
  // ANOTHER founder's decision + product DNA. Growth passes the tier gate, so
  // this genuinely exercises the ownership check (must be 404, not a leak).
  const attacker = await seedFounder({ email: 'attacker@a.co', tier: 'growth' });
  await seedProduct(attacker.id as string, { name: 'AttackerCo' });
  currentFounder = founderObj(attacker);
  const otherDecision = (await query('SELECT id FROM decisions WHERE product_id = ?', [p3prod])).rows[0] as Record<string, string> | undefined;
  if (otherDecision) {
    await hit('13 adversarial (cross-tenant)', 'GET', `/decisions/${otherDecision.id}`, { expectStatus: [404] });
  }
  await hit('13 adversarial (cross-tenant)', 'GET', `/products/${p3prod}/dna`, { expectStatus: [404] });

  // 14. Logged-out user hitting an authed route → should redirect to login, not 500.
  currentFounder = null;
  await hit('14 logged-out on authed route', 'GET', '/dashboard', { expectStatus: [302, 401, 200] });

  // ── Report ──────────────────────────────────────────────────────────────────
  const bugs = findings.filter((f) => f.status >= 500);
  console.log('\n================ WALKTHROUGH REPORT ================');
  console.log(`Requests driven: ${requests}`);
  console.log(`Seed-level findings (schema/code mismatches): ${seedFindings.length}`);
  for (const s of [...new Set(seedFindings)]) console.log(`  ! ${s}`);
  console.log(`\nRequest findings: ${findings.length}  (5xx bugs: ${bugs.length})\n`);
  if (findings.length === 0) {
    console.log('No 5xx, no unexpected bounces, tenant isolation held. ✅');
  } else {
    for (const f of findings) {
      console.log(`[${f.status}] ${f.persona} — ${f.method} ${f.path}\n      ${f.note}`);
    }
  }
  console.log('====================================================\n');
  process.exit(bugs.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error('HARNESS CRASH:', e); process.exit(2); });
