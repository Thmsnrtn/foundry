// =============================================================================
// FOUNDRY — the crawl, with real ids.
//
// `tests/simulation/crawl.ts` enumerates every registered GET route and drives
// it, but it never fills a `:id` with a row that exists (every param is
// `zzz-nonexistent`, and a 404 for a made-up id is counted as correct), it
// counts a 503 as a pass, and its founder stub carries an email the private
// posture's owner check does not recognise — so every `requireInstitutionOwner`
// page it drove was a 403 it never looked at. This one mounts the same table
// (plus the Stripe webhook mounts and the static routes it omits), seeds the
// rich world, maps every `:param` to a REAL id of the right kind, drives each
// route three ways — the real id, a foreign id that exists in no table, and a
// malformed one — and flags 5xx, 503, 403-for-the-owner, template artifacts,
// 404s on real ids and dead internal links. The params it could not map are
// printed: the population is part of the result.
//
// Run:  npx tsx tests/simulation/campaign/id-pages-crawl.ts
// Out:  tests/simulation/campaign/id-pages-crawl-results.jsonl
//       tests/simulation/campaign/findings.jsonl (F-CRAWL-n, appended)
// =============================================================================

process.env.NODE_ENV = 'test';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com'; // the seeded owner's address, so the Workshop is his
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.CLERK_SECRET_KEY = 'sk_test_fake';
process.env.CLERK_PUBLISHABLE_KEY = 'pk_test_fake';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fake';
process.env.ENCRYPTION_KEY ??= '0'.repeat(64);
process.env.APP_URL ??= 'http://localhost:3000';

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';

const HERE = dirname(fileURLToPath(import.meta.url));
// Outputs go outside the source tree (CAMPAIGN_OUT overrides).
const OUT_DIR = process.env.CAMPAIGN_OUT ?? resolve(tmpdir(), 'foundry-campaign');
mkdirSync(OUT_DIR, { recursive: true });
const ROOT = resolve(HERE, '../../..');
const OUT = resolve(OUT_DIR, 'id-pages-crawl-results.jsonl');
const FINDINGS = resolve(OUT_DIR, 'findings.jsonl');

// No network, as in the walk: the stubs answer the providers; anything else is a network error.
const { providerStubs } = await import('../../helpers/provider-stubs.js');
const stubs = providerStubs();
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
  try { return await stubs.fetch(u, init); } catch (e) {
    throw new TypeError(`fetch failed (no network in the laboratory): ${e instanceof Error ? e.message : String(e)}`);
  }
}) as typeof fetch;

const { Hono } = await import('hono');
const { query } = await import('../../../src/db/client.js');
const { seedProductionShape, addCompanies, OWNER } = await import('../../helpers/world.js');

// ── Mount table: crawl.ts's list, plus what it omits ────────────────────────
const R = async (p: string) => (await import(`../../../src/routes/${p}.js`)) as Record<string, any>;
const mounts: Array<[string, any]> = [];
{
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
  mounts.push(['/api/v1', ((await import('../../../src/api/v1/index.js')) as any).apiV1]);
}

// ── App assembly, signed in as the seeded owner ─────────────────────────────
type FounderRow = Record<string, unknown>;
let currentFounder: FounderRow | null = null;
let lastError = '';
const app = new (Hono as any)();
app.use('*', async (c: any, next: any) => {
  if (currentFounder) { c.set('founder', currentFounder); c.set('userId', currentFounder.id); }
  c.set('csrfToken', 'test-csrf');
  await next();
});
app.onError((err: any, c: any) => {
  lastError = String(err?.stack ?? err).split('\n').slice(0, 4).join(' | ');
  return c.text(`ERR: ${err?.message ?? err}`, 500);
});
// WHAT src/index.ts MOUNTS INLINE AND crawl.ts LEAVES OUT: the static assets,
// the manifest, the service worker, and the two Stripe webhook doors (POST;
// counted in the population, never driven — this crawl drives GET only).
{
  const { staticAssetHandler } = await R('public/static-assets');
  app.get('/static/:file', staticAssetHandler(resolve(ROOT, 'src')));
  const { readFileSync } = await import('node:fs');
  app.get('/manifest.json', (c: any) => { try { return c.body(readFileSync(resolve(ROOT, 'src/public/manifest.json'), 'utf-8'), 200, { 'Content-Type': 'application/manifest+json' }); } catch { return c.notFound(); } });
  app.get('/sw.js', (c: any) => { try { return c.body(readFileSync(resolve(ROOT, 'src/public/sw.js'), 'utf-8'), 200, { 'Content-Type': 'application/javascript' }); } catch { return c.notFound(); } });
  const { handleWebhook } = await import('../../../src/services/venture/stripe-webhook.js');
  app.post('/webhooks/stripe', async (c: any) => {
    const signature = c.req.header('stripe-signature');
    if (!signature) return c.json({ error: 'Missing signature' }, 400);
    try { await handleWebhook(await c.req.text(), signature); return c.json({ received: true }); } catch { return c.json({ error: 'Webhook processing failed' }, 400); }
  });
  app.post('/webhooks/stripe/:productId', async (c: any) => {
    if (!c.req.header('stripe-signature')) return c.json({ error: 'Missing signature' }, 400);
    return c.json({ error: 'Webhook processing failed' }, 400);
  });
}
for (const [prefix, mod] of mounts) app.route(prefix, mod);

// ── Route table ──────────────────────────────────────────────────────────────
interface RouteEntry { method: string; path: string }
const uniq = new Map<string, RouteEntry>();
for (const r of (app.routes as Array<{ method: string; path: string }>)) {
  if (r.method === 'ALL' || r.method === 'USE') continue;
  uniq.set(`${r.method} ${r.path}`, { method: r.method, path: r.path });
}
const allRoutes = [...uniq.values()];
const getRoutes = allRoutes.filter((r) => r.method === 'GET' && !r.path.includes('*')).sort((a, b) => a.path.localeCompare(b.path));
const paramRoutes = getRoutes.filter((r) => r.path.includes(':'));

function routeMatches(method: string, pathname: string): boolean {
  return allRoutes.some((r) => {
    if (r.method !== method) return false;
    if (r.path.includes('*')) return pathname.startsWith(r.path.slice(0, r.path.indexOf('*')));
    const rx = new RegExp('^' + r.path.replace(/:[^/]+/g, '[^/]+').replace(/[.]/g, '\\.') + '/?$');
    return rx.test(pathname);
  });
}

// ── The world ────────────────────────────────────────────────────────────────
const { experimentId } = await seedProductionShape({ charter: true, searching: true, eyes: true, undecided: true });
currentFounder = (await query('SELECT * FROM founders WHERE id = ?', [OWNER])).rows[0] as FounderRow;
const companyIds = await addCompanies(app as never, ['Apex Micro Press', 'Northfield Candles', 'Tidewater Templates']);
{
  const mail = await import('../../../src/services/public-workshop/mail.js');
  const { publicWorkshopOf } = await import('../../../src/services/public-workshop/settings.js');
  await mail.openTheEars(OWNER);
  const to = (await publicWorkshopOf(OWNER))?.contactEmail ?? 'thomas@apexmicro.ai';
  await mail.hearMail({ founderId: OWNER, to, from: 'shop@example.com', fromName: 'A millwork shop', subject: 'About the bid brief', body: 'Is the brief updated weekly?', rfcMessageId: '<crawl-1@example.com>', size: 80 });
}

// ── Param → real id ──────────────────────────────────────────────────────────
// A param is mapped by NAME to a table (and by ROUTE where the name is ambiguous).
const products = ((await query(`SELECT id FROM products WHERE owner_id = ? AND deleted_at IS NULL ORDER BY rowid`, [OWNER])).rows as unknown as Array<{ id: string }>).map((r) => r.id);
const experiments = ((await query(`SELECT id FROM venture_experiments WHERE founder_id = ? ORDER BY rowid`, [OWNER])).rows as unknown as Array<{ id: string }>).map((r) => r.id);
const threads = ((await query(`SELECT DISTINCT thread_key FROM workshop_mail WHERE founder_id = ?`, [OWNER])).rows as unknown as Array<{ thread_key: string }>).map((r) => r.thread_key);
const customers = ((await query(`SELECT c.id FROM customers c JOIN products p ON p.id = c.product_id WHERE p.owner_id = ?`, [OWNER])).rows as unknown as Array<{ id: string }>).map((r) => r.id);
const webhooks = ((await query(`SELECT w.id FROM webhooks w JOIN products p ON p.id = w.product_id WHERE p.owner_id = ?`, [OWNER])).rows as unknown as Array<{ id: string }>).map((r) => r.id).filter(Boolean);
const responsibilities = ((await query(`SELECT r.id FROM institutional_responsibilities r JOIN products p ON p.id = r.product_id WHERE p.owner_id = ?`, [OWNER])).rows as unknown as Array<{ id: string }>).map((r) => r.id);
const { missionsOf } = await import('../../../src/services/mission/read.js');
const missionKeys = (await missionsOf(OWNER)).map((m) => m.key);
let providers: string[] = []; let senses: string[] = [];
try { const { connectorsFor } = await import('../../../src/services/senses/journey.js'); providers = (await connectorsFor(products[0]!)).map((c) => c.provider); } catch (e) { console.log(`connectorsFor: ${String(e)}`); }
try { const s = await import('../../../src/services/senses/index.js'); senses = (await s.whatItCannotSee(products[0]!)).map((g) => g.key); } catch (e) { console.log(`whatItCannotSee: ${String(e)}`); }
const today = new Date().toISOString().slice(0, 10);

const TABLE_OF: Record<string, { table: string; values: string[] }> = {
  id: { table: 'products', values: products },
  companyId: { table: 'products', values: products },
  productId: { table: 'products', values: products },
  experimentId: { table: 'venture_experiments', values: experiments },
  key: { table: 'missions (missionsOf keys)', values: missionKeys },
  thread: { table: 'workshop_mail.thread_key', values: threads },
  provider: { table: 'connectorsFor(product).provider', values: providers },
  sense: { table: 'senses.sense_key (whatItCannotSee)', values: senses },
  responsibilityId: { table: 'institutional_responsibilities', values: responsibilities },
  customerId: { table: 'customers', values: customers },
  webhookId: { table: 'webhooks', values: webhooks },
  file: { table: 'src/public', values: ['owner.css'] },
  date: { table: 'today', values: [today] },
  kind: { table: 'WHY_KINDS', values: ['company'] },
};
/** Routes whose params mean something only together. Each entry is one concrete substitution. */
const ROUTE_OVERRIDES: Record<string, Array<Record<string, string>>> = {
  '/foundry/why/:kind/:id': [
    ...(products[0] ? [{ kind: 'company', id: products[0] }] : []),
    ...(experiments[0] ? [{ kind: 'experiment', id: experiments[0] }] : []),
  ],
  '/foundry/experiments/:id': experiments.map((id) => ({ id })),
  '/foundry/experiments/:id/decide': experiments.map((id) => ({ id })),
  '/foundry/experiments/:id/recipients': experiments.map((id) => ({ id })),
};

const paramsOf = (path: string): string[] => [...path.matchAll(/:([^/]+)/g)].map((m) => m[1]!);
const fill = (path: string, values: Record<string, string>): string => path.replace(/:([^/]+)/g, (_, p: string) => encodeURIComponent(values[p] ?? ''));

interface Substitution { url: string; values: Record<string, string> }
const unmapped: Array<{ route: string; param: string; why: string }> = [];
function substitutions(r: RouteEntry): Substitution[] {
  const ps = paramsOf(r.path);
  if (ps.length === 0) return [{ url: r.path, values: {} }];
  const ov = ROUTE_OVERRIDES[r.path];
  if (ov) {
    if (ov.length === 0) { for (const p of ps) unmapped.push({ route: r.path, param: p, why: 'no row for the override' }); return []; }
    return ov.map((values) => ({ url: fill(r.path, values), values }));
  }
  const values: Record<string, string> = {};
  for (const p of ps) {
    const m = TABLE_OF[p];
    if (!m) { unmapped.push({ route: r.path, param: p, why: 'no table mapped for this param name' }); return []; }
    if (m.values.length === 0) { unmapped.push({ route: r.path, param: p, why: `${m.table} has no row for the owner` }); return []; }
    values[p] = m.values[0]!;
  }
  // Every company, for the company pages; otherwise the first row.
  if (ps.length === 1 && TABLE_OF[ps[0]!]?.table === 'products') return products.map((id) => ({ url: fill(r.path, { [ps[0]!]: id }), values: { [ps[0]!]: id } }));
  return [{ url: fill(r.path, values), values }];
}

// ── Driving ──────────────────────────────────────────────────────────────────
interface Result { phase: 'real' | 'foreign' | 'malformed'; route: string; url: string; status: number; location: string | null; contentType: string; artifact: string | null; serverError: string; variant?: string }
interface Finding { kind: string; where: string; note: string }
const results: Result[] = [];
const findings: Finding[] = [];
const ARTIFACTS = [/\bundefined\b/, /\bNaN\b/, /\[object Object\]/, /Invalid Date/];
const harvested = new Map<string, string>();

function scan(html: string): string | null {
  const stripped = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<code[\s\S]*?<\/code>/gi, '').replace(/<pre[\s\S]*?<\/pre>/gi, '');
  for (const rx of ARTIFACTS) {
    const m = stripped.match(rx);
    if (m) { const i = stripped.indexOf(m[0]); return `"${m[0]}": …${stripped.slice(Math.max(0, i - 80), i + 80).replace(/\s+/g, ' ')}…`; }
  }
  return null;
}
function harvest(where: string, html: string): void {
  for (const m of html.matchAll(/href="(\/[^"#?]*)/g)) {
    const h = m[1]!;
    if (h.startsWith('/static/') || h === '/sw.js' || h === '/manifest.json') continue;
    if (!harvested.has(h)) harvested.set(h, where);
  }
}
async function hit(phase: Result['phase'], route: string, url: string, variant?: string): Promise<Result> {
  lastError = '';
  let res: Response;
  try {
    res = await app.request(url, { headers: { accept: 'text/html,application/json' } });
  } catch (e) {
    const r: Result = { phase, route, url, status: 0, location: null, contentType: '', artifact: null, serverError: `request threw: ${String(e).slice(0, 200)}`, variant };
    results.push(r); return r;
  }
  const ct = res.headers.get('content-type') ?? '';
  let artifact: string | null = null;
  if (phase === 'real' && res.status === 200 && ct.includes('text/html')) {
    const html = await res.text();
    artifact = scan(html);
    harvest(`GET ${route}`, html);
  }
  const r: Result = { phase, route, url, status: res.status, location: res.headers.get('location'), contentType: ct, artifact, serverError: lastError, variant };
  results.push(r);
  return r;
}

let drivenReal = 0; let drivenForeign = 0; let drivenMalformed = 0; const drivenRoutes = new Set<string>();
for (const r of getRoutes) {
  for (const s of substitutions(r)) {
    drivenReal += 1; drivenRoutes.add(r.path);
    const res = await hit('real', r.path, s.url);
    const isApi = r.path.startsWith('/api/v1');
    if (res.status === 0 || (res.status >= 500 && res.status !== 503)) findings.push({ kind: '5xx', where: `GET ${s.url}`, note: `${String(res.status)} — ${res.serverError}` });
    else if (res.status === 503) findings.push({ kind: '503', where: `GET ${s.url}`, note: 'a 503 is a finding here, not a pass' });
    else if (res.status === 403 && !isApi) findings.push({ kind: '403-for-owner', where: `GET ${s.url}`, note: 'the signed-in owner was refused' });
    else if (res.status === 404 && Object.keys(s.values).length) findings.push({ kind: '404-real-id', where: `GET ${s.url}`, note: `a real id (${JSON.stringify(s.values)}) answers 404` });
    else if (res.status === 404 && !isApi) findings.push({ kind: 'dead-route', where: `GET ${s.url}`, note: 'a registered parameterless route answers 404' });
    if (res.artifact) findings.push({ kind: 'artifact', where: `GET ${s.url}`, note: res.artifact });
  }
}

// Foreign ids: valid-looking, in no table.
for (const r of paramRoutes) {
  const ps = paramsOf(r.path);
  const values: Record<string, string> = Object.fromEntries(ps.map((p) => [p, nanoid(21)]));
  drivenForeign += 1;
  const res = await hit('foreign', r.path, fill(r.path, values));
  if (res.status === 0 || (res.status >= 500 && res.status !== 503)) findings.push({ kind: '5xx-foreign-id', where: `GET ${res.url}`, note: `${String(res.status)} — ${res.serverError}` });
  else if (res.status === 503) findings.push({ kind: '503-foreign-id', where: `GET ${res.url}`, note: '' });
}
// Malformed ids.
const MALFORMED: Array<{ name: string; value: string; raw?: boolean }> = [
  { name: 'traversal', value: '../../etc' },
  { name: 'traversal-raw', value: '%2e%2e%2f%2e%2e%2fetc', raw: true },
  { name: '400-chars', value: 'a'.repeat(400) },
  { name: 'unicode', value: '☃️日本語-ünïcödé' },
  { name: 'sql-quote', value: "x'; DROP TABLE products; --" },
];
for (const r of paramRoutes) {
  for (const m of MALFORMED) {
    const ps = paramsOf(r.path);
    const url = m.raw ? r.path.replace(/:([^/]+)/g, m.value) : fill(r.path, Object.fromEntries(ps.map((p) => [p, m.value])));
    drivenMalformed += 1;
    const res = await hit('malformed', r.path, url, m.name);
    if (res.status === 0 || (res.status >= 500 && res.status !== 503)) findings.push({ kind: '5xx-malformed-id', where: `GET ${r.path} [${m.name}]`, note: `${String(res.status)} — ${res.serverError}` });
    else if (res.status === 503) findings.push({ kind: '503-malformed-id', where: `GET ${r.path} [${m.name}]`, note: '' });
  }
}

// Dead links, from the pages that rendered.
let linksChecked = 0;
for (const [href, from] of harvested) {
  linksChecked += 1;
  if (!routeMatches('GET', href)) { findings.push({ kind: 'dead-link', where: from, note: `href "${href}" resolves to no mounted GET route` }); continue; }
  lastError = '';
  const res = await app.request(href, { headers: { accept: 'text/html' } });
  if (res.status === 404) findings.push({ kind: 'dead-link', where: from, note: `href "${href}" returns 404 for the owner` });
  else if (res.status === 403) findings.push({ kind: 'dead-link', where: from, note: `href "${href}" returns 403 for the owner` });
  else if (res.status >= 500) findings.push({ kind: res.status === 503 ? '503' : '5xx', where: from, note: `href "${href}" → ${String(res.status)} ${lastError}` });
}

// ── Output ───────────────────────────────────────────────────────────────────
writeFileSync(OUT, results.map((r) => JSON.stringify(r)).join('\n') + '\n');
// THIS RUN'S FINDINGS REPLACE THE LAST RUN'S; other campaigns' lines in the same file are kept.
{ const { existsSync, readFileSync } = await import('node:fs');
  const kept = existsSync(FINDINGS) ? readFileSync(FINDINGS, 'utf8').split('\n').filter((l) => l && !/"id":"F-CRAWL-/.test(l)) : [];
  writeFileSync(FINDINGS, kept.length ? kept.join('\n') + '\n' : ''); }
const SEV: Record<string, string> = { '5xx': 'P1', '503': 'P1', artifact: 'P1', '5xx-foreign-id': 'P1', '5xx-malformed-id': 'P1', '503-foreign-id': 'P1', '503-malformed-id': 'P1', '403-for-owner': 'P2', '404-real-id': 'P2', 'dead-route': 'P2', 'dead-link': 'P2' };
findings.forEach((f, i) => appendFileSync(FINDINGS, `${JSON.stringify({ id: `F-CRAWL-${String(i + 1)}`, sev: SEV[f.kind] ?? 'P3', area: f.kind, title: `${f.kind}: ${f.where}`, evidence: f.note })}\n`));

const hist = (phase: Result['phase']) => { const h: Record<string, number> = {}; for (const r of results.filter((x) => x.phase === phase)) h[String(r.status)] = (h[String(r.status)] ?? 0) + 1; return Object.entries(h).sort().map(([k, v]) => `${k}×${String(v)}`).join(' '); };
console.log('\n================ ID-PAGES CRAWL ================');
console.log(`Population: ${String(allRoutes.length)} mounted routes, ${String(getRoutes.length)} GET routes (${String(paramRoutes.length)} with params); POST-only doors counted, not driven: ${String(allRoutes.filter((r) => r.method !== 'GET').length)}`);
console.log(`Driven with real ids: ${String(drivenReal)} requests over ${String(drivenRoutes.size)} routes; ${String(getRoutes.length - drivenRoutes.size)} GET routes NOT driven (unmapped)`);
console.log(`Driven with foreign ids: ${String(drivenForeign)}; with malformed ids: ${String(drivenMalformed)}; links checked: ${String(linksChecked)}`);
console.log(`Status histogram — real: ${hist('real')}\n                   foreign: ${hist('foreign')}\n                   malformed: ${hist('malformed')}`);
console.log(`Ids on hand: products ${String(products.length)}, experiments ${String(experiments.length)}, missions ${String(missionKeys.length)}, threads ${String(threads.length)}, providers ${String(providers.length)} [${providers.join(', ')}], senses ${String(senses.length)} [${senses.join(', ')}], responsibilities ${String(responsibilities.length)}, customers ${String(customers.length)}, webhooks ${String(webhooks.length)}`);
console.log(`\nUnmapped (${String(unmapped.length)}):`);
for (const u of unmapped) console.log(`  ${u.route}  :${u.param}  — ${u.why}`);
const byKind = new Map<string, Finding[]>();
for (const f of findings) { if (!byKind.has(f.kind)) byKind.set(f.kind, []); byKind.get(f.kind)!.push(f); }
console.log(`\nFindings: ${String(findings.length)}`);
for (const [kind, list] of byKind) { console.log(`── ${kind} (${String(list.length)}) ──`); for (const f of list) console.log(`  [${f.where}] ${f.note}`); }
console.log('\nEvery real-id visit:');
for (const r of results.filter((x) => x.phase === 'real')) console.log(`  ${String(r.status).padStart(3)} ${r.url}${r.location ? ` → ${r.location}` : ''}`);
console.log(`\nResults: ${OUT}\nFindings: ${FINDINGS}`);
console.log('=================================================');
console.log(`experiment ${experimentId}; companies ${companyIds.join(', ')}`);
process.exit(0);
