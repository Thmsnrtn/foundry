// =============================================================================
// FOUNDRY — Full-surface crawl (the production gate)
//
// Mounts EXACTLY what src/index.ts mounts — read from that file, not listed by
// hand — signs in as the owner the private posture admits, seeds the world
// production has, and then:
//   1. drives every registered GET route with REAL ids of the right kind (a
//      company page with a company, an experiment page with an experiment);
//      any 5xx, 503 included, a 403 for the owner, a 404 for a row that exists,
//      or a template artifact (undefined/NaN/[object Object]/Invalid Date) in
//      rendered HTML is a defect;
//   2. harvests every internal href/form-action those pages emit, fetches each
//      link, SCANS what it returns and harvests from it in turn, and verifies
//      each form action resolves against the mounted route table — dead links
//      are defects;
//   3. statically cross-checks src/index.ts middleware registrations against
//      the mounted route table — an authed surface not covered by
//      authMiddleware, or a state-changing route not covered by
//      csrfMiddleware, is a defect;
//   4. holds a POPULATION FLOOR: the share of :param routes driven with a real
//      id, and the routes, links and pages it reached, may not fall below what
//      it reaches today. A crawl that quietly reaches less is not passing.
//
// WHAT IT USED TO DO (remediation 3, 6 October 2026). Every :id was
// `zzz-nonexistent` and a page with a made-up id was not scanned, so the pages
// that carry the owner's real rows were never looked at; a 503 was counted as
// a pass; the stub founder's email was not the owner the private posture
// admits, so every `requireInstitutionOwner` page was a 403 nobody read; links
// were fetched but what came back was not scanned; and the mount table was a
// hand-kept copy of src/index.ts.
//
// Run:  npx tsx tests/simulation/crawl.ts
//       CRAWL_PLANT=<route>  (gates-fail-when-they-should) makes that route
//       answer 503, to show the crawl goes red on it;
//       CRAWL_PLANT_REDIRECT=<route> makes it send the owner to sign-in.
// =============================================================================

process.env.NODE_ENV = 'test';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com'; // the world's owner — the one the posture admits
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.CLERK_SECRET_KEY = 'sk_test_fake';
process.env.CLERK_PUBLISHABLE_KEY = 'pk_test_fake';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.APP_URL = 'http://localhost:8080';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.RESEND_FROM_ADDRESS = 'Foundry <t@foundry.so>';

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

// No network: the world's provider stubs answer, and anything else fails as a
// machine with no route out would.
const { providerStubs } = await import('../helpers/provider-stubs.js');
const stubs = providerStubs();
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
  try { return await stubs.fetch(u, init); } catch (e) {
    throw new TypeError(`fetch failed (no network in the crawl): ${e instanceof Error ? e.message : String(e)}`);
  }
}) as typeof fetch;

const { Hono } = await import('hono');
const { query } = await import('../../src/db/client.js');
const { seedProductionShape, addCompanies, OWNER } = await import('../helpers/world.js');

// ── Mount table: read from src/index.ts ──────────────────────────────────────
//
// Every `app.route('<prefix>', <name>)` in the entry point, with `<name>`
// imported from the module the entry point imports it from. Nothing is listed
// here by hand, so the crawl cannot drift from what is deployed.
const INDEX = readFileSync(resolve(ROOT, 'src/index.ts'), 'utf-8');
const importOf = new Map<string, string>();
for (const m of INDEX.matchAll(/import\s*\{([^}]+)\}\s*from\s*'(\.\/[^']+)'/g)) {
  for (const name of m[1]!.split(',').map((s) => s.trim().split(/\s+as\s+/).pop()!).filter(Boolean)) {
    importOf.set(name, m[2]!.replace(/\.js$/, '.ts'));
  }
}
const mounts: Array<[string, string, unknown]> = [];
for (const m of INDEX.matchAll(/app\.route\(\s*'([^']*)'\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
  const [, prefix, name] = m as unknown as [string, string, string];
  const from = importOf.get(name);
  if (!from) throw new Error(`src/index.ts mounts ${name} and the crawl cannot see where it is imported from`);
  const mod = (await import(resolve(ROOT, 'src', from))) as Record<string, unknown>;
  if (!mod[name]) throw new Error(`${from} does not export ${name}`);
  mounts.push([prefix, name, mod[name]]);
}
// THE ROUTES src/index.ts DECLARES INLINE. They cannot be imported, so each is
// named here with how the crawl stands in for it; a new one nobody named is a
// finding, so this list cannot go quietly stale.
const INLINE: Record<string, string> = {
  'GET /static/:file': 'mounted below from the same staticAssetHandler',
  'GET /manifest.json': 'mounted below from the same pwaHandlers',
  'GET /sw.js': 'mounted below from the same pwaHandlers',
  'GET /favicon.ico': 'mounted below from the same pwaHandlers',
  'POST /webhooks/stripe': 'a signed provider callback; counted in the population, never driven by a GET crawl',
  'POST /webhooks/stripe/:productId': 'a signed provider callback; counted in the population, never driven by a GET crawl',
  'GET /internal/routes': 'answers which named routes are missing; takes a list, renders no page',
};
const inlineDeclared = [...INDEX.matchAll(/app\.(get|post|put|delete|patch)\(\s*'([^']+)'/g)].map((m) => `${m[1]!.toUpperCase()} ${m[2]!}`);

// ── App assembly, signed in as the owner ─────────────────────────────────────
type FounderRow = Record<string, unknown>;
let currentFounder: FounderRow | null = null;
let lastError = '';
const PLANT = process.env.CRAWL_PLANT ?? null;
const PLANT_REDIRECT = process.env.CRAWL_PLANT_REDIRECT ?? null;

const app = new (Hono as any)();
app.use('*', async (c: any, next: any) => {
  if (currentFounder) { c.set('founder', currentFounder); c.set('userId', currentFounder.id); }
  c.set('csrfToken', 'test-csrf');
  // A PLANTED DEFECT, for the gate that proves this crawl can fail.
  if (PLANT && c.req.path === PLANT) return c.json({ error: 'planted' }, 503);
  if (PLANT_REDIRECT && c.req.path === PLANT_REDIRECT) return c.redirect(`https://foundry.example/auth/login?next=${encodeURIComponent(PLANT_REDIRECT)}`, 302);
  await next();
});
app.onError((err: any, c: any) => {
  lastError = String(err?.stack ?? err).split('\n').slice(0, 4).join(' | ');
  return c.text(`ERR: ${err?.message ?? err}`, 500);
});
{
  const { staticAssetHandler, pwaHandlers } = await import('../../src/routes/public/static-assets.js');
  app.get('/static/:file', staticAssetHandler(resolve(ROOT, 'src')));
  const pwa = pwaHandlers(resolve(ROOT, 'src'));
  app.get('/manifest.json', pwa.manifest);
  app.get('/sw.js', pwa.serviceWorker);
  app.get('/favicon.ico', pwa.favicon);
}
for (const [prefix, , mod] of mounts) app.route(prefix, mod as never);

// ── Route table ──────────────────────────────────────────────────────────────
interface RouteEntry { method: string; path: string }
const uniq = new Map<string, RouteEntry>();
for (const r of (app.routes as Array<{ method: string; path: string }>)) {
  if (r.method === 'ALL' || r.method === 'USE') continue;
  uniq.set(`${r.method} ${r.path}`, { method: r.method, path: r.path });
}
// What the crawl can DRIVE is what it mounted; the inline routes it cannot
// mount still count as routes a link or form may point at.
const getRoutes = [...uniq.values()].filter((r) => r.method === 'GET' && !r.path.includes('*'))
  .sort((a, b) => a.path.localeCompare(b.path));
for (const k of Object.keys(INLINE)) {
  const [method, path] = k.split(' ') as [string, string];
  uniq.set(k, { method, path });
}
const allRoutes = [...uniq.values()];

function routeMatches(method: string, pathname: string): boolean {
  return allRoutes.some((r) => {
    if (r.method !== method) return false;
    if (r.path.includes('*')) return pathname.startsWith(r.path.slice(0, r.path.indexOf('*')));
    const rx = new RegExp('^' + r.path.replace(/:[^/]+/g, '[^/]+').replace(/[.]/g, '\\.') + '/?$');
    return rx.test(pathname);
  });
}

// ── The world production has ─────────────────────────────────────────────────
const { experimentId } = await seedProductionShape({ charter: true, searching: true, eyes: true, undecided: true });
currentFounder = (await query('SELECT * FROM founders WHERE id = ?', [OWNER])).rows[0] as FounderRow;
await addCompanies(app as never, ['Apex Micro Press', 'Northfield Candles', 'Tidewater Templates']);
{
  const mail = await import('../../src/services/public-workshop/mail.js');
  const { publicWorkshopOf } = await import('../../src/services/public-workshop/settings.js');
  await mail.openTheEars(OWNER);
  const to = (await publicWorkshopOf(OWNER))?.contactEmail ?? 'thomas@apexmicro.ai';
  await mail.hearMail({ founderId: OWNER, to, from: 'shop@example.com', fromName: 'A millwork shop', subject: 'About the bid brief', body: 'Is the brief updated weekly?', rfcMessageId: '<crawl-1@example.com>', size: 80 });
}

// ── Param → a real id of the right kind ──────────────────────────────────────
const col = async (sql: string, args: unknown[] = []): Promise<string[]> =>
  ((await query(sql, args)).rows as unknown as Array<Record<string, unknown>>).map((r) => String(Object.values(r)[0]));
const products = await col(`SELECT id FROM products WHERE owner_id = ? AND deleted_at IS NULL ORDER BY rowid`, [OWNER]);
const experiments = await col(`SELECT id FROM venture_experiments WHERE founder_id = ? ORDER BY rowid`, [OWNER]);
const threads = await col(`SELECT DISTINCT thread_key FROM workshop_mail WHERE founder_id = ?`, [OWNER]);
const responsibilities = await col(`SELECT r.id FROM institutional_responsibilities r JOIN products p ON p.id = r.product_id WHERE p.owner_id = ?`, [OWNER]);
const { missionsOf } = await import('../../src/services/mission/read.js');
const missionKeys = (await missionsOf(OWNER)).map((m) => m.key);
let providers: string[] = []; let senses: string[] = [];
try { const { connectorsFor } = await import('../../src/services/senses/journey.js'); providers = (await connectorsFor(products[0]!)).map((c) => c.provider); } catch { /* reported as unmapped */ }
try { const s = await import('../../src/services/senses/index.js'); senses = (await s.whatItCannotSee(products[0]!)).map((g) => g.key); } catch { /* reported as unmapped */ }

const TABLE_OF: Record<string, { table: string; values: string[] }> = {
  id: { table: 'products', values: products },
  companyId: { table: 'products', values: products },
  productId: { table: 'products', values: products },
  experimentId: { table: 'venture_experiments', values: experiments },
  key: { table: 'missions', values: missionKeys },
  thread: { table: 'workshop_mail.thread_key', values: threads },
  provider: { table: 'connectorsFor(product)', values: providers },
  sense: { table: 'senses (whatItCannotSee)', values: senses },
  responsibilityId: { table: 'institutional_responsibilities', values: responsibilities },
  file: { table: 'src/public', values: ['owner.css'] },
  date: { table: 'today', values: [new Date().toISOString().slice(0, 10)] },
  kind: { table: 'why kinds', values: ['company'] },
};
const ROUTE_OVERRIDES: Record<string, Array<Record<string, string>>> = {
  '/foundry/why/:kind/:id': [
    ...(products[0] ? [{ kind: 'company', id: products[0] }] : []),
    ...(experiments[0] ? [{ kind: 'experiment', id: experiments[0] }] : []),
  ],
  '/foundry/experiments/:id': experiments.map((id) => ({ id })),
  '/foundry/experiments/:id/decide': experiments.map((id) => ({ id })),
  '/foundry/experiments/:id/recipients': experiments.map((id) => ({ id })),
  '/foundry/public-workshop/preview/:experimentId': experiments.map((experimentId) => ({ experimentId })),
};
// PARAMS WITH NO OWNER ROW IN THIS WORLD, AND WHY. Anything unmapped and not
// named here is a finding: the population is part of the result.
const KNOWN_UNMAPPED: Record<string, string> = {
  token: 'a signed one-time link (a buyer\'s refund, a shared page): there is no token to have without minting one, and a made-up one is refused, which is checked below',
  customerId: 'the private instance holds no SaaS customers',
  webhookId: 'no outbound webhook is registered for the owner',
  sessionId: 'an API session the owner never opened',
  slug: 'a public page slug served by the public site, not this app',
  orderId: 'no order in the world\'s day one',
  fulfilmentId: 'a buyer\'s signed link names a fulfilment and its token together; a made-up pair is refused, which is checked below',
  responsibilityId: 'the production world holds no institutional responsibility on day one',
};
// AN ADDRESS WHOSE JOB IS TO SEND THE OWNER TO ONBOARDING, and why. Any other
// redirect to sign-in or onboarding is the owner being turned away.
const KNOWN_REDIRECTS: Record<string, string> = {
  '/settings/add-product': 'adding a company is the onboarding flow; this address only names it',
};
// A 404 THAT IS THE RIGHT ANSWER on this world, and why. Named, so a new one
// is a finding.
const KNOWN_404: Record<string, string> = {
  '/foundry/senses/reference-authorize': 'answers only while a reference search waits for authorization; none does here (the remediation program lists it as a known false positive)',
};

const paramsOf = (path: string): string[] => [...path.matchAll(/:([^/]+)/g)].map((m) => m[1]!);
const fill = (path: string, values: Record<string, string>): string => path.replace(/:([^/]+)/g, (_, p: string) => encodeURIComponent(values[p] ?? ''));
const unmapped: Array<{ route: string; param: string; why: string }> = [];
function substitutions(r: RouteEntry): string[] {
  const ps = paramsOf(r.path);
  if (ps.length === 0) return [r.path];
  const ov = ROUTE_OVERRIDES[r.path];
  if (ov) return ov.map((v) => fill(r.path, v));
  const values: Record<string, string> = {};
  for (const p of ps) {
    const m = TABLE_OF[p];
    if (!m || m.values.length === 0) { unmapped.push({ route: r.path, param: p, why: m ? `${m.table} has no row` : 'no table mapped for this name' }); return []; }
    values[p] = m.values[0]!;
  }
  if (ps.length === 1 && TABLE_OF[ps[0]!]?.table === 'products') return products.map((id) => fill(r.path, { [ps[0]!]: id }));
  return [fill(r.path, values)];
}

// ── The crawl ────────────────────────────────────────────────────────────────
interface Finding { kind: string; where: string; note: string }
const findings: Finding[] = [];
const ARTIFACTS = [/\bundefined\b/, /\bNaN\b/, /\[object Object\]/, /Invalid Date/];
// "null" is ordinary English on these pages ("a null result"), so it is not an
// artifact here; the four above are never prose.

function scanHtml(where: string, html: string): void {
  const stripped = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<code[\s\S]*?<\/code>/gi, '').replace(/<pre[\s\S]*?<\/pre>/gi, '');
  for (const rx of ARTIFACTS) {
    const m = stripped.match(rx);
    if (m) {
      const i = stripped.indexOf(m[0]);
      findings.push({ kind: 'artifact', where, note: `"${m[0]}" in rendered HTML: …${stripped.slice(Math.max(0, i - 80), i + 80).replace(/\s+/g, ' ')}…` });
    }
  }
}

const harvestedLinks = new Map<string, string>();
const harvestedActions = new Map<string, string>();
function harvest(where: string, html: string): void {
  for (const m of html.matchAll(/href="(\/[^"#?]*)/g)) {
    const h = m[1]!;
    if (h.startsWith('/static/') || h === '/sw.js' || h === '/manifest.json' || h === '/favicon.ico') continue;
    if (!harvestedLinks.has(h)) harvestedLinks.set(h, where);
  }
  for (const m of html.matchAll(/<form[^>]*method="(GET|POST|get|post)"[^>]*action="(\/[^"#?]*)"|<form[^>]*action="(\/[^"#?]*)"[^>]*method="(GET|POST|get|post)"/g)) {
    const method = (m[1] ?? m[4] ?? 'POST').toUpperCase();
    const key = `${method} ${m[2] ?? m[3]!}`;
    if (!harvestedActions.has(key)) harvestedActions.set(key, where);
  }
}

/** One GET, judged. Real ids only reach here, so every refusal is a defect. */
async function look(where: string, url: string): Promise<number> {
  lastError = '';
  let res: Response;
  try { res = await app.request(url, { headers: { accept: 'text/html,application/json' } }); } catch (e) {
    findings.push({ kind: '5xx', where, note: `${url}: request threw: ${String(e).slice(0, 200)}` });
    return 0;
  }
  // A 503 IS A FAILURE. It used to be excused as "deliberate degradation"; on
  // the owner's world with real ids it is a page the owner cannot open.
  if (res.status >= 500) findings.push({ kind: '5xx', where, note: `${url} → ${String(res.status)} ${lastError || (await res.clone().text().catch(() => '')).slice(0, 160)}` });
  else if (res.status === 403) findings.push({ kind: 'owner-refused', where, note: `${url} → 403 for the owner the posture admits` });
  // A REDIRECT TO SIGN-IN OR ONBOARDING IS A REFUSAL TOO, said politely: the
  // owner, signed in, sent away from a page of theirs (remediation audit).
  // Read as a path, so an absolute URL or a query string cannot slip by.
  else if (res.status >= 300 && res.status < 400 && !KNOWN_REDIRECTS[url]
    && /^\/(auth\/login|onboarding)\b/.test(new URL(res.headers.get('location') ?? '/', 'http://crawl.local').pathname)) {
    findings.push({ kind: 'owner-refused', where, note: `${url} → ${String(res.status)} to ${res.headers.get('location') ?? ''} for the owner` });
  }
  else if (res.status === 404 && !KNOWN_404[url]) findings.push({ kind: 'not-found', where, note: `${url} → 404 for a row that exists` });
  const ct = res.headers.get('content-type') ?? '';
  if (res.status === 200 && ct.includes('text/html')) {
    const html = await res.text();
    scanHtml(where, html);
    // A page that sets its own base address elsewhere (the Workshop preview
    // points at the public site) links to that site, not to this app.
    if (!/<base href="https?:\/\//.test(html)) harvest(where, html);
    pagesScanned++;
  }
  return res.status;
}

let drivenReal = 0; let pagesScanned = 0; let linksFetched = 0;
const paramRoutes = getRoutes.filter((r) => r.path.includes(':'));
let paramRoutesDriven = 0;

async function drive(): Promise<void> {
  for (const r of getRoutes) {
    const urls = substitutions(r);
    if (urls.length && r.path.includes(':')) paramRoutesDriven++;
    for (const url of urls) { drivenReal++; await look(`GET ${r.path}`, url); }
  }
  // A made-up token is refused, never served and never a crash.
  for (const r of getRoutes.filter((x) => paramsOf(x.path).includes('token'))) {
    const made = Object.fromEntries(paramsOf(r.path).map((p) => [p, `zzz-not-a-${p}`]));
    const res = await app.request(fill(r.path, made), { headers: { accept: 'text/html' } });
    if (res.status >= 500 || res.status === 200) findings.push({ kind: 'token', where: `GET ${r.path}`, note: `a made-up token answered ${String(res.status)}` });
  }
}

async function checkLinks(): Promise<void> {
  // Breadth-first over what the pages link to, scanning and harvesting each,
  // until nothing new appears.
  const seen = new Set<string>();
  for (let round = 0; round < 4; round++) {
    const fresh = [...harvestedLinks.entries()].filter(([h]) => !seen.has(h));
    if (fresh.length === 0) break;
    for (const [href, from] of fresh) {
      seen.add(href);
      if (!routeMatches('GET', href)) { findings.push({ kind: 'dead-link', where: from, note: `href "${href}" resolves to no mounted GET route` }); continue; }
      if (Object.keys(INLINE).some((k) => k === `GET ${href}`)) continue;
      linksFetched++;
      await look(`${from} → ${href}`, href);
    }
  }
  for (const [action, from] of harvestedActions) {
    const [method, path] = action.split(' ') as [string, string];
    if (!routeMatches(method, path)) findings.push({ kind: 'dead-form', where: from, note: `form targets "${method} ${path}" — no mounted route` });
  }
}

// ── Static middleware-coverage check against src/index.ts ────────────────────
function checkMiddlewareCoverage(): void {
  const grab = (mw: string): string[] => [...INDEX.matchAll(new RegExp(`app\\.use\\('([^']+)',\\s*${mw}`, 'g'))].map((m) => m[1]!);
  const authPaths = grab('authMiddleware');
  const csrfPaths = grab('csrfMiddleware');
  const covered = (paths: string[], p: string): boolean => paths.some((a) => {
    if (a.endsWith('/*')) { const base = a.slice(0, -2); return p === base || p.startsWith(base + '/'); }
    if (a.includes('*')) return new RegExp('^' + a.replace(/\*/g, '[^/]+').replace(/\//g, '\\/') + '$').test(p);
    return p === a;
  });
  const PUBLIC = [
    /^\/$/, /^\/auth\//,
    /^\/share\//, /^\/ingest\//, /^\/webhooks\//, /^\/internal\//, /^\/health/, /^\/static\//, /^\/api\/v1\//,
    /^\/manifest\.json$/, /^\/sw\.js$/, /^\/favicon\.ico$/, /^\/robots\.txt$/, /^\/sitemap/,
    /^\/\.well-known\//,
    // The Workshop's mail door: a program at Cloudflare's edge with its own secret.
    /^\/workshop\/mail$/,
  ];
  for (const r of allRoutes) {
    if (r.path.includes('*')) continue;
    const isPublic = PUBLIC.some((rx) => rx.test(r.path));
    const authed = covered(authPaths, r.path);
    if (!isPublic && !authed) findings.push({ kind: 'no-auth', where: `${r.method} ${r.path}`, note: 'not covered by authMiddleware and not public by design' });
    if (authed && r.method !== 'GET' && !covered(csrfPaths, r.path)) findings.push({ kind: 'no-csrf', where: `${r.method} ${r.path}`, note: 'state-changing authed route not covered by csrfMiddleware' });
  }
  for (const k of inlineDeclared) {
    if (!INLINE[k]) findings.push({ kind: 'unnamed-inline', where: k, note: 'src/index.ts declares this inline and the crawl does not say how it stands in for it' });
  }
  for (const k of Object.keys(INLINE)) {
    if (!inlineDeclared.includes(k)) findings.push({ kind: 'stale-inline', where: k, note: 'named as inline in the crawl, and src/index.ts no longer declares it' });
  }
}

// ── The population floor ─────────────────────────────────────────────────────
//
// WHAT THE CRAWL REACHES IS PART OF ITS RESULT. A crawl that drives fewer
// routes, maps fewer ids or reaches fewer pages than it did is not passing, it
// is looking at less. The floor is today's reach, a little under so that a
// harmless new route does not trip it; raise it when the reach rises.
// Reach on 6 October 2026: 242 routes, 18 of 24 :param routes driven with a
// real id (the other six named above), 143 pages scanned, 95 links fetched.
const FLOOR = { routes: 230, paramShare: 0.7, pages: 130, links: 85 } as const;

async function main(): Promise<void> {
  checkMiddlewareCoverage();
  await drive();
  await checkLinks();
  for (const u of unmapped) {
    if (!KNOWN_UNMAPPED[u.param]) findings.push({ kind: 'unmapped', where: `GET ${u.route}`, note: `:${u.param} — ${u.why}; map it, or name it in KNOWN_UNMAPPED with the reason` });
  }
  const paramShare = paramRoutes.length === 0 ? 1 : paramRoutesDriven / paramRoutes.length;
  const population = { routes: allRoutes.length, getRoutes: getRoutes.length, drivenReal, paramRoutes: paramRoutes.length, paramRoutesDriven, paramShare: Number(paramShare.toFixed(2)), pages: pagesScanned, links: linksFetched, forms: harvestedActions.size, mounts: mounts.map(([p, n]) => `${p} ${n}`) };
  if (allRoutes.length < FLOOR.routes) findings.push({ kind: 'population', where: 'routes', note: `${String(allRoutes.length)} mounted, under the floor of ${String(FLOOR.routes)}` });
  if (paramShare < FLOOR.paramShare) findings.push({ kind: 'population', where: ':param routes', note: `${String(paramRoutesDriven)} of ${String(paramRoutes.length)} driven with a real id, under ${String(FLOOR.paramShare * 100)}%` });
  if (pagesScanned < FLOOR.pages) findings.push({ kind: 'population', where: 'pages', note: `${String(pagesScanned)} pages scanned, under the floor of ${String(FLOOR.pages)}` });
  if (linksFetched < FLOOR.links) findings.push({ kind: 'population', where: 'links', note: `${String(linksFetched)} harvested links fetched, under the floor of ${String(FLOOR.links)}` });

  console.log('\n================ FULL-SURFACE CRAWL ================');
  console.log(`Population: ${JSON.stringify(population)}`);
  console.log(`Unmapped (named): ${unmapped.filter((u) => KNOWN_UNMAPPED[u.param]).map((u) => `${u.route} :${u.param}`).join(', ') || 'none'}`);
  console.log(`Findings: ${String(findings.length)}\n`);
  const byKind = new Map<string, Finding[]>();
  for (const f of findings) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f]);
  for (const [kind, list] of byKind) {
    console.log(`── ${kind} (${String(list.length)}) ──`);
    for (const f of list) console.log(`  [${f.where}] ${f.note}`);
    console.log('');
  }
  console.log('====================================================\n');
  // ZERO, NOT A RATCHET. The baseline existed because most findings were on
  // commercial surfaces the owner asked not to be developed; those are deleted,
  // and what is left is the owner's surface, which was always held to zero.
  process.exit(findings.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error('CRAWL HARNESS CRASH:', e); process.exit(2); });
