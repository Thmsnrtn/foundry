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
// THE POSTURE THE OWNER RUNS. Without this the crawl booted in the default
// commercial posture, where `views/layout.ts` renders a twenty-five item
// sidebar, a five-tab bar and a command palette that the private instance
// gates off entirely — so the crawl was harvesting links from navigation the
// owner has never seen, and reporting them against a mount table that no
// longer carries them. It must drive the surface that is deployed.
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
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

// ── Mount table: what the owner's instance actually serves ──────────────────
//
// THIS LIST IS HAND-MAINTAINED AND MUST TRACK src/index.ts. It used to mirror
// every mount in that file including the seventy-two commercial routers the
// private instance never served, which is how twenty-two thousand lines of
// unreachable code stayed alive: this crawl was the only thing that imported
// them, and it runs in `npm run check`. Those routers are deleted; what is
// left is the surface the owner can reach, and `dashboard/letter` mounts the
// four `*-place` routers and the shell beneath itself.
const R = async (p: string) => (await import(`../../src/routes/${p}.js`)) as Record<string, any>;

const mounts: Array<[string, any]> = [];
{
  // `public/landing` served six routers — the hero, pricing, case studies, the
  // manifesto, help, and a privacy policy and terms. It was deleted: Private
  // Foundry has no landing page of its own, apexmicro.ai is the public face,
  // and what is left at the root is a door. One router, one route.
  mounts.push(['/', (await R('public/door')).landingRoutes]);
  mounts.push(['/', (await R('auth/clerk')).authRoutes]);
  mounts.push(['/', (await R('share/index')).shareRoutes]);
  mounts.push(['/', (await R('ingest/index')).ingestRoutes]);
  mounts.push(['/', (await R('internal/health')).healthRoutes]);
  mounts.push(['/', (await R('internal/ecosystem')).ecosystemRoutes]);
  mounts.push(['/', (await R('dashboard/onboarding')).onboardingRoutes]);
  mounts.push(['/', (await R('dashboard/letter')).letterRoutes]);
  mounts.push(['/', (await R('dashboard/settings')).settingsRoutes]);
  mounts.push(['/', (await R('dashboard/privacy')).privacySettings]);
  mounts.push(['/api/v1', ((await import('../../src/api/v1/index.js')) as any).apiV1]);
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
    // `/` is the door: it redirects to `/foundry`, which authMiddleware guards.
    // The marketing paths that used to sit beside it here — /pricing,
    // /case-studies, /manifesto, /help, /privacy-policy, /terms — are gone with
    // the page that served them, so they are not exempted from anything any more.
    /^\/$/, /^\/auth\//,
    /^\/share\//, /^\/ingest\//, /^\/webhooks\//, /^\/internal\//, /^\/health/, /^\/static\//, /^\/api\/v1\//,
    /^\/beta$/, /^\/beta\/intake/, /^\/legal/, /^\/refer\//, /^\/r\//, /^\/manifest\.json$/, /^\/sw\.js$/, /^\/robots\.txt$/, /^\/sitemap/,
    /^\/llms\.txt$/, /^\/security\.txt$/, /^\/\.well-known\//, /^\/api\/webhooks\//, /^\/api\/transcripts\//, /^\/api\/voice/,
    // The Workshop's mail door. Public because the caller is a program at
    // Cloudflare's edge with no session to carry; it authenticates with its own
    // secret, and the only institutional state it can reach — the
    // do-not-contact list — it can only add to.
    /^\/workshop\/mail$/,
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

  // A RATCHET, SO THIS CAN BE RUN BY THE BUILD RATHER THAN BY SOMEBODY
  // REMEMBERING.
  //
  // This harness has existed and worked for months and nothing ran it. Most of
  // what it finds is on the commercial surfaces the owner asked not to be
  // developed, so demanding zero would mean either a large cleanup nobody wants
  // or a gate that is switched off — which is how a harness ends up unrun. The
  // count may fall and never rise, and the OWNER'S surface is held to zero,
  // because that is the product being built.
  const { readFileSync, writeFileSync } = await import('node:fs');
  const BASELINE = 'scripts/crawl-findings-baseline.json';
  const onOwnerSurface = findings.filter((f) => /\/foundry(\/|\s|$)/.test(f.where)
    || /"\/foundry/.test(f.note));

  if (process.argv.includes('--write')) {
    writeFileSync(BASELINE, `${JSON.stringify({ findings: findings.length }, null, 2)}\n`);
    console.log(`Baseline written: ${String(findings.length)} findings.`);
    process.exit(0);
  }

  let ceiling = Number.POSITIVE_INFINITY;
  try {
    ceiling = Number((JSON.parse(readFileSync(BASELINE, 'utf8')) as { findings: number })
      .findings);
  } catch {
    console.log(`No baseline at ${BASELINE}; run with --write to record one.`);
  }

  const fatal = findings.filter((f) => f.kind === '5xx' || f.kind === 'artifact');
  if (onOwnerSurface.length > 0) {
    console.error(`The owner's own surface has ${String(onOwnerSurface.length)} finding(s):`);
    for (const f of onOwnerSurface) console.error(`  [${f.where}] ${f.note}`);
  }
  if (findings.length > ceiling) {
    console.error(`Findings rose: ${String(findings.length)} against a baseline of `
      + `${String(ceiling)}. Fix it, or record the new floor with --write and say why.`);
  }
  process.exit(fatal.length > 0 || onOwnerSurface.length > 0 || findings.length > ceiling
    ? 1 : 0);
}

main().catch((e) => { console.error('CRAWL HARNESS CRASH:', e); process.exit(2); });
