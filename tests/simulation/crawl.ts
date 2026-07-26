// =============================================================================
// FOUNDRY — Full-surface crawl (the production gate)
//
// Boots EVERY route module exactly as src/index.ts mounts them (same order,
// same prefixes) against an in-memory DB with a stubbed founder, then:
//   1. mechanically enumerates every registered GET route via Hono's .routes,
//      substitutes seeded ids for params, and drives each one — any 5xx,
//      handler throw, or template artifact (undefined/NaN/[object Object]/
//      Invalid Date) in rendered HTML is a defect;
//   2. harvests every internal href/form-action emitted by those pages and
//      verifies each resolves against the mounted route table (method-aware)
//      — dead links are defects;
//   3. statically cross-checks src/index.ts middleware registrations against
//      the mounted route table — an authed surface not covered by
//      authMiddleware, or a state-changing route not covered by
//      csrfMiddleware, is a defect.
//
// Run:  npx tsx tests/simulation/crawl.ts
// =============================================================================

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

import { readFileSync } from 'fs';

const { Hono } = await import('hono');
const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');

// ── Mount table: mirrors src/index.ts exactly (same modules, same prefixes) ──
const R = async (p: string) => (await import(`../../src/routes/${p}.js`)) as Record<string, any>;

const mounts: Array<[string, any]> = [];
{
  const pub = await R('public/landing');
  for (const k of ['landingRoutes', 'pricingRoutes', 'caseStudyRoutes', 'legalRoutes', 'manifestoRoutes', 'helpRoutes']) mounts.push(['/', pub[k]]);
  mounts.push(['/', (await R('auth/clerk')).authRoutes]);
  mounts.push(['/', (await R('share/index')).shareRoutes]);
  mounts.push(['/', (await R('ingest/index')).ingestRoutes]);
  mounts.push(['/', (await R('internal/health')).healthRoutes]);
  mounts.push(['/', (await R('internal/ecosystem')).ecosystemRoutes]);
  mounts.push(['/', (await R('dashboard/index')).dashboardRoutes]);
  mounts.push(['/', (await R('dashboard/onboarding')).onboardingRoutes]);
  mounts.push(['/', (await R('dashboard/products')).productRoutes]);
  mounts.push(['/', (await R('dashboard/audit')).auditRoutes]);
  mounts.push(['/', (await R('dashboard/decisions')).decisionRoutes]);
  mounts.push(['/', (await R('dashboard/fleet')).fleetRoutes]);
  mounts.push(['/', (await R('dashboard/letter')).letterRoutes]);
  mounts.push(['/', (await R('dashboard/lifecycle')).lifecycleRoutes]);
  mounts.push(['/', (await R('dashboard/digest')).digestRoutes]);
  mounts.push(['/', (await R('dashboard/cohorts')).cohortRoutes]);
  mounts.push(['/', (await R('dashboard/competitive')).competitiveRoutes]);
  mounts.push(['/', (await R('dashboard/beta')).betaRoutes]);
  mounts.push(['/', (await R('dashboard/journey')).journeyRoutes]);
  mounts.push(['/', (await R('dashboard/koldly')).koldlyRoutes]);
  mounts.push(['/', (await R('dashboard/settings')).settingsRoutes]);
  mounts.push(['/', (await R('dashboard/revenue')).revenueRoutes]);
  mounts.push(['/', (await R('dashboard/portfolio')).portfolioRoutes]);
  mounts.push(['/', (await R('dashboard/founder-ops')).founderOpsRoutes]);
  mounts.push(['/', (await R('dashboard/plan')).planRoutes]);
  mounts.push(['/', (await R('signal/timeline')).timelineRoutes]);
  mounts.push(['/', (await R('dashboard/integrations')).integrationsRoutes]);
  mounts.push(['/', (await R('dashboard/team')).teamRoutes]);
  mounts.push(['/', (await R('dashboard/investors')).investorRoutes]);
  mounts.push(['/', (await R('dashboard/execution-playbooks')).executionPlaybooks]);
  mounts.push(['/', (await R('dashboard/playbooks')).playbookRoutes]);
  mounts.push(['/', (await R('dashboard/agents-wisdom')).agentWisdomRoutes]);
  mounts.push(['/', (await R('dashboard/agents-briefings')).agentBriefingRoutes]);
  mounts.push(['/', (await R('dashboard/agents-evolve')).agentEvolveRoutes]);
  mounts.push(['/', (await R('dashboard/agents-constitution')).agentConstitutionRoutes]);
  mounts.push(['/', (await R('dashboard/agents-remediations')).agentRemediationRoutes]);
  mounts.push(['/', (await R('dashboard/agents-temporal')).agentTemporalRoutes]);
  mounts.push(['/', (await R('dashboard/agents-integrations')).agentIntegrationRoutes]);
  mounts.push(['/', (await R('dashboard/agents-customers')).agentCustomerRoutes]);
  mounts.push(['/', (await R('dashboard/agents-messages')).agentMessageRoutes]);
  mounts.push(['/', (await R('dashboard/agents-strategy')).agentStrategyRoutes]);
  mounts.push(['/', (await R('dashboard/agents-experiments')).agentExperimentRoutes]);
  mounts.push(['/', (await R('dashboard/agents-inbox')).agentsInbox]);
  mounts.push(['/', (await R('dashboard/agents-okr')).agentsOkr]);
  mounts.push(['/', (await R('dashboard/agents-decisions')).agentsDecisions]);
  mounts.push(['/', (await R('dashboard/benchmarks')).benchmarks]);
  mounts.push(['/', (await R('dashboard/audit-log')).auditLog]);
  mounts.push(['/', (await R('dashboard/agents-actions')).agentsActions]);
  mounts.push(['/', (await R('dashboard/agents-accuracy')).agentsAccuracy]);
  mounts.push(['/', (await R('dashboard/agents-transparency')).agentsTransparency]);
  mounts.push(['/', (await R('dashboard/scenarios')).scenarios]);
  mounts.push(['/', (await R('dashboard/privacy')).privacySettings]);
  mounts.push(['/board', (await R('dashboard/board-packet')).boardPacket]);
  mounts.push(['/', (await R('dashboard/weekly-brief')).weeklyBrief]);
  mounts.push(['/', (await R('dashboard/agents-debate')).agentsDebate]);
  mounts.push(['/', (await R('dashboard/agent-intelligence')).agentIntelligence]);
  mounts.push(['/', (await R('dashboard/memory')).memoryGraph]);
  mounts.push(['/', (await R('dashboard/signals-multimodal')).multimodalSignals]);
  mounts.push(['/', (await R('dashboard/ambient')).ambientRoutes]);
  mounts.push(['/', (await R('dashboard/network-intelligence')).networkIntelligence]);
  mounts.push(['/', (await R('dashboard/exit')).exitRoutes]);
  mounts.push(['/', (await R('api/webhooks/transcripts')).transcriptWebhooks]);
  mounts.push(['/', (await R('api/webhooks/voice-reply')).voiceReplyWebhook]);
  mounts.push(['/', (await R('dashboard/roi')).roiDashboard]);
  mounts.push(['/', (await R('dashboard/founder-intelligence')).founderIntelligence]);
  mounts.push(['/', (await R('dashboard/integration-health')).integrationHealth]);
  mounts.push(['/', (await R('api/priority')).priorityApi]);
  mounts.push(['/agents', (await R('dashboard/agents')).agentRoutes]);
  mounts.push(['/api/v1', ((await import('../../src/api/v1/index.js')) as any).apiV1]);
  mounts.push(['/', (await R('api/products')).apiProductRoutes]);
  mounts.push(['/', (await R('api/metrics')).apiMetricRoutes]);
  mounts.push(['/', (await R('api/audit-log')).apiAuditLogRoutes]);
  mounts.push(['/', (await R('api/ux')).apiUXRoutes]);
  mounts.push(['/', (await R('api/ask')).apiAskRoutes]);
  mounts.push(['/', (await R('api/feedback')).feedbackRoutes]);
  mounts.push(['/', (await R('api/mobile')).mobileRoutes]);
  mounts.push(['/', (await R('api/tier1')).tier1ApiRoutes]);
  mounts.push(['/', (await R('api/tier2')).tier2ApiRoutes]);
  mounts.push(['/', (await R('api/tier3')).tier3ApiRoutes]);
  mounts.push(['/', (await R('api/tier4')).tier4ApiRoutes]);
  mounts.push(['/', (await R('api/supercharge')).superchargeApiRoutes]);
  mounts.push(['/', (await R('api/platform')).platformApiRoutes]);
  mounts.push(['/', (await R('api/founder-intelligence')).founderIntelRoutes]);
}

// ── App assembly with founder stub ───────────────────────────────────────────
type FounderRow = Record<string, unknown>;
let currentFounder: FounderRow | null = null;
let currentProductId: string | null = null;
let lastError = '';

const app = new (Hono as any)();
app.use('*', async (c: any, next: any) => {
  if (currentFounder) {
    c.set('founder', currentFounder);
    c.set('userId', currentFounder.id);
    if (currentProductId) c.set('productId', currentProductId);
  }
  c.set('csrfToken', 'test-csrf');
  await next();
});
app.onError((err: any, c: any) => {
  lastError = String(err?.stack ?? err).split('\n').slice(0, 5).join(' | ');
  return c.text(`ERR: ${err?.message ?? err}`, 500);
});
for (const [prefix, mod] of mounts) app.route(prefix, mod);

// ── Route table ──────────────────────────────────────────────────────────────
interface RouteEntry { method: string; path: string }
const routeTable: RouteEntry[] = (app.routes as Array<{ method: string; path: string }>)
  .filter((r) => r.method !== 'ALL' && r.method !== 'USE')
  .map((r) => ({ method: r.method, path: r.path }));

const uniq = new Map<string, RouteEntry>();
for (const r of routeTable) uniq.set(`${r.method} ${r.path}`, r);
const allRoutes = [...uniq.values()];
const getRoutes = allRoutes.filter((r) => r.method === 'GET' && !r.path.includes('*'));

function routeMatches(method: string, pathname: string): boolean {
  return allRoutes.some((r) => {
    if (r.method !== method) return false;
    if (r.path.includes('*')) {
      const prefix = r.path.slice(0, r.path.indexOf('*'));
      return pathname.startsWith(prefix);
    }
    const rx = new RegExp('^' + r.path.replace(/:[^/]+/g, '[^/]+').replace(/[.]/g, '\\.') + '/?$');
    return rx.test(pathname);
  });
}

// ── Seeding ──────────────────────────────────────────────────────────────────
let seq = 0;
const id = (p: string) => `${p}_${(seq++).toString(36).padStart(4, '0')}`;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
const day = (daysAgo: number) => iso(daysAgo).slice(0, 10);

const seeded: Record<string, string> = {};

async function seed(): Promise<void> {
  const fid = id('f');
  await query(
    `INSERT INTO founders (id, clerk_user_id, email, name, tier, created_at) VALUES (?, ?, ?, ?, 'investor_ready', ?)`,
    [fid, id('clerk'), 'thmsnrtn@gmail.com', 'Operator', iso(90)],
  );
  seeded.founderId = fid;

  // Two products: one rich, one sparse — the fleet view needs >1.
  const p1 = id('p'); const p2 = id('p');
  for (const [pid, name, repo] of [[p1, 'AcreOS', 'acreos'], [p2, 'SideBet', null]] as const) {
    await query(
      `INSERT INTO products (id, name, owner_id, github_repo_owner, github_repo_name, status, scp_status, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', 'active', ?)`,
      [pid, name, fid, repo, repo ? 'app' : null, iso(60)],
    );
    await query(`INSERT INTO lifecycle_state (product_id, risk_state) VALUES (?, 'green')`, [pid]).catch(() => {});
  }
  seeded.productId = p1;
  seeded.productId2 = p2;
  currentProductId = p1;

  // 14 days of metrics on p1 (real dates, real rates — exercises date + pct formatting).
  for (let d = 14; d >= 1; d--) {
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, signups_7d, active_users, new_mrr_cents, churned_mrr_cents, activation_rate, churn_rate, day_30_retention, nps_score, support_volume_7d)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id('m'), p1, day(d), 40 + d, 180 + d * 3, 250000 + d * 1000, 30000, 0.34, 0.045, 0.61, 42, 7],
    );
  }

  // Decisions across every category/gate/status.
  const cats = ['urgent', 'strategic', 'product', 'marketing', 'informational'] as const;
  const stats = ['pending', 'approved', 'rejected', 'executed', 'expired'] as const;
  for (let i = 0; i < cats.length; i++) {
    const did = id('d');
    await query(
      `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [did, p1, cats[i], i % 5, `Decision about ${cats[i]} matters`, 'Because the signal moved', stats[i], iso(i + 1)],
    );
    if (i === 0) seeded.decisionId = did;
  }

  // Customers on p1.
  for (const [nm, mrr, risk] of [['Dana Ives', 9900, 0.1], ['Lee Park', 4900, 0.7], ['Ana Cruz', 19900, 0.3]] as const) {
    const cid = id('c');
    await query(
      `INSERT INTO customers (id, product_id, owner_id, name, email, plan, mrr_cents, signed_up_at, last_active_at, health_score, churn_risk)
       VALUES (?, ?, ?, ?, ?, 'pro', ?, ?, ?, ?, ?)`,
      [cid, p1, fid, nm, `${nm.split(' ')[0].toLowerCase()}@ex.com`, mrr, iso(50), iso(2), 0.8, risk],
    );
    seeded.customerId ??= cid;
  }

  // Briefings + agents.
  await query(
    `INSERT INTO scp_briefings (id, product_id, briefing_date, headline, briefing_text) VALUES (?, ?, ?, ?, ?)`,
    [id('b'), p1, day(0), 'Churn risk concentrated in one account', 'Lee Park is 70% churn risk; act this week.'],
  ).catch(() => {});
  seeded.date = day(0);
  for (const [nm, st, h] of [['atlas', 'active', 82], ['forge', 'active', 61], ['harbor', 'paused', 40]] as const) {
    const aid = id('ai');
    await query(
      `INSERT INTO agent_instances (id, product_id, agent_name, display_name, status, last_run_at, next_run_at, domain_health_score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [aid, p1, nm, nm.toUpperCase(), st, iso(2), iso(-1), h],
    ).catch(() => {});
    seeded.agentId ??= aid;
    seeded.agentName ??= nm;
  }

  // Autopilot policy + notification via real services (they know the schema).
  const { setPolicy } = await import('../../src/services/autopilot/policy.js');
  await setPolicy(p1, 'customer_success', 'suggest', fid).catch(() => {});
  const { createNotification } = await import('../../src/services/ux/notifications.js');
  await createNotification(fid, p1, 'signal_alert', 'Churn moved', 'Churn rate crossed 4%').catch(() => {});

  currentFounder = (await query('SELECT * FROM founders WHERE id = ?', [fid])).rows[0] as FounderRow;
}

// ── Param substitution ───────────────────────────────────────────────────────
const MISSING = 'zzz-nonexistent';
function paramValue(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('product')) return seeded.productId;
  if (n.includes('decision')) return seeded.decisionId;
  if (n.includes('customer')) return seeded.customerId;
  if (n.includes('agent') && n.includes('name')) return seeded.agentName;
  if (n.includes('agent')) return seeded.agentId;
  if (n === ':date' || n.includes('date')) return seeded.date;
  if (n.includes('file')) return 'app.css';
  if (n.includes('token')) return MISSING;
  return MISSING;
}

function substitute(path: string): { url: string; hasMissing: boolean } {
  let hasMissing = false;
  const url = path.replace(/:([^/]+)/g, (_, p) => {
    const v = paramValue(':' + p);
    if (v === MISSING) hasMissing = true;
    return v;
  });
  return { url, hasMissing };
}

// ── The crawl ────────────────────────────────────────────────────────────────
interface Finding { kind: string; where: string; note: string }
const findings: Finding[] = [];
let driven = 0;

const ARTIFACTS = [/\bundefined\b/, /\bNaN\b/, /\[object Object\]/, /Invalid Date/];

function scanHtml(where: string, html: string): void {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
  for (const rx of ARTIFACTS) {
    const m = stripped.match(rx);
    if (m) {
      const idx = stripped.indexOf(m[0]);
      const ctx = stripped.slice(Math.max(0, idx - 80), idx + 80).replace(/\s+/g, ' ');
      findings.push({ kind: 'artifact', where, note: `"${m[0]}" in rendered HTML: …${ctx}…` });
    }
  }
}

const harvestedLinks = new Map<string, string>(); // href -> first page seen on
const harvestedActions = new Map<string, string>();

function harvest(where: string, html: string): void {
  for (const m of html.matchAll(/href="(\/[^"#?]*)/g)) {
    const h = m[1];
    if (h.startsWith('/static/') || h === '/sw.js' || h === '/manifest.json') continue;
    if (!harvestedLinks.has(h)) harvestedLinks.set(h, where);
  }
  for (const m of html.matchAll(/<form[^>]*method="(GET|POST|get|post)"[^>]*action="(\/[^"#?]*)"|<form[^>]*action="(\/[^"#?]*)"[^>]*method="(GET|POST|get|post)"/g)) {
    const method = (m[1] ?? m[4] ?? 'POST').toUpperCase();
    const target = m[2] ?? m[3];
    const key = `${method} ${target}`;
    if (!harvestedActions.has(key)) harvestedActions.set(key, where);
  }
  for (const m of html.matchAll(/fetch\('(\/[^'?]*)'\s*,\s*\{\s*method:\s*'(GET|POST|PUT|DELETE)'/g)) {
    if (!harvestedActions.has(m[1])) harvestedActions.set(`${m[2]} ${m[1]}`, where);
  }
}

async function drive(): Promise<void> {
  for (const r of getRoutes.sort((a, b) => a.path.localeCompare(b.path))) {
    const { url, hasMissing } = substitute(r.path);
    driven++;
    lastError = '';
    let res: Response;
    try {
      res = await app.request(url, { headers: { accept: 'text/html,application/json' } });
    } catch (e) {
      findings.push({ kind: '5xx', where: `GET ${r.path}`, note: `request threw: ${String(e).slice(0, 200)}` });
      continue;
    }
    if (res.status >= 500 && res.status !== 503) {
      // 503 = deliberate degradation (AI provider unavailable in this
      // environment) with a clean JSON error — not a defect. 500 = crash.
      findings.push({ kind: '5xx', where: `GET ${r.path}`, note: `${res.status} — ${lastError || (await res.clone().text().catch(() => '')).slice(0, 160)}` });
      continue;
    }
    if (hasMissing) continue; // 404/302 for made-up ids is correct; don't scan
    const ct = res.headers.get('content-type') ?? '';
    if (res.status === 200 && ct.includes('text/html')) {
      const html = await res.text();
      scanHtml(`GET ${r.path}`, html);
      harvest(`GET ${r.path}`, html);
    }
  }
}

async function checkLinks(): Promise<void> {
  for (const [href, from] of harvestedLinks) {
    if (!routeMatches('GET', href)) {
      findings.push({ kind: 'dead-link', where: from, note: `href "${href}" resolves to no mounted GET route` });
      continue;
    }
    // Also actually fetch it once — a matching pattern can still 404 on real data.
    lastError = '';
    const res = await app.request(href, { headers: { accept: 'text/html' } });
    if (res.status === 404) findings.push({ kind: 'dead-link', where: from, note: `href "${href}" returns 404 for a fully-seeded founder` });
    if (res.status >= 500 && res.status !== 503) findings.push({ kind: '5xx', where: from, note: `href "${href}" → ${res.status} ${lastError}` });
  }
  for (const [action, from] of harvestedActions) {
    const [maybeMethod, maybePath] = action.includes(' ') ? action.split(' ') : ['POST', action];
    if (!routeMatches(maybeMethod, maybePath)) {
      findings.push({ kind: 'dead-form', where: from, note: `form/fetch targets "${maybeMethod} ${maybePath}" — no mounted route` });
    }
  }
}

// ── Static middleware-coverage check against src/index.ts ────────────────────
function checkMiddlewareCoverage(): void {
  const src = readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf-8');
  const grab = (mw: string): string[] =>
    [...src.matchAll(new RegExp(`app\\.use\\('([^']+)',\\s*${mw}`, 'g'))].map((m) => m[1]);
  const authPaths = grab('authMiddleware');
  const csrfPaths = grab('csrfMiddleware');

  const covered = (paths: string[], p: string): boolean =>
    paths.some((a) => {
      if (a.endsWith('/*')) { const base = a.slice(0, -2); return p === base || p.startsWith(base + '/'); }
      if (a.includes('*')) return new RegExp('^' + a.replace(/\*/g, '[^/]+').replace(/\//g, '\\/') + '$').test(p);
      return p === a;
    });

  // Surfaces that are public BY DESIGN.
  const PUBLIC = [
    /^\/$/, /^\/pricing/, /^\/case-stud/, /^\/privacy-policy/, /^\/terms/, /^\/manifesto/, /^\/help/, /^\/auth\//,
    /^\/share\//, /^\/ingest\//, /^\/webhooks\//, /^\/internal\//, /^\/health/, /^\/static\//, /^\/api\/v1\//,
    /^\/beta$/, /^\/beta\/intake/, /^\/legal/, /^\/refer\//, /^\/r\//, /^\/manifest\.json$/, /^\/sw\.js$/, /^\/robots\.txt$/, /^\/sitemap/,
    /^\/llms\.txt$/, /^\/security\.txt$/, /^\/\.well-known\//, /^\/api\/webhooks\//, /^\/api\/transcripts\//, /^\/api\/voice/,
  ];

  for (const r of allRoutes) {
    if (r.path.includes('*')) continue;
    const isPublic = PUBLIC.some((rx) => rx.test(r.path));
    const authed = covered(authPaths, r.path);
    if (!isPublic && !authed) {
      findings.push({ kind: 'no-auth', where: `${r.method} ${r.path}`, note: 'mounted route not covered by any authMiddleware registration and not on the public-by-design list' });
    }
    if (authed && r.method !== 'GET' && !covered(csrfPaths, r.path)) {
      findings.push({ kind: 'no-csrf', where: `${r.method} ${r.path}`, note: 'state-changing authed route not covered by csrfMiddleware' });
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  await runMigrations();
  await seed();
  checkMiddlewareCoverage();
  await drive();
  await checkLinks();

  const byKind = new Map<string, Finding[]>();
  for (const f of findings) {
    if (!byKind.has(f.kind)) byKind.set(f.kind, []);
    byKind.get(f.kind)!.push(f);
  }

  console.log('\n================ FULL-SURFACE CRAWL ================');
  console.log(`Mounted routes: ${allRoutes.length}  (GET driven: ${driven}, links harvested: ${harvestedLinks.size}, actions: ${harvestedActions.size})`);
  console.log(`Findings: ${findings.length}\n`);
  for (const [kind, list] of byKind) {
    console.log(`── ${kind} (${list.length}) ──`);
    for (const f of list) console.log(`  [${f.where}] ${f.note}`);
    console.log('');
  }
  console.log('====================================================\n');
  process.exit(findings.filter((f) => f.kind === '5xx' || f.kind === 'artifact').length > 0 ? 1 : 0);
}

main().catch((e) => { console.error('CRAWL HARNESS CRASH:', e); process.exit(2); });
