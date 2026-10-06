// =============================================================================
// FOUNDRY — the owner's walk: every page he can reach, in a real browser, on
// his phone and his desk, at three moments of one world.
//
// Serves the REAL owner surface (`ownerApp()` from the world helper, signed in
// as the seeded owner, with FOUNDRY_OWNER_EMAIL matching so the Workshop is
// not a 403) against a production-shaped world — a live charter, a search in
// flight, the proven eyes open, Experiment 001 undecided — plus three companies
// he named. Playwright then walks it as a person would: every door, every
// place, every :id page with a REAL id from the seeded database; on an
// iPhone 13, an iPhone SE and a 1440px desk; on day 1, after eight days and a
// morning, and after thirty more days and another morning.
//
// For each page × viewport × day it records what a reviewer would be asked to
// look for and nobody does: status, template artifacts, console errors,
// sideways overflow, tap targets under 44px, axe serious/critical violations,
// heading sanity, the owner's reading burden (words and controls), whether the
// one thing that needs him is on the first screen of the phone, whether the
// count in the header is the count the rows give, and how fast it came.
//
// A 503 is a finding here. A 404 on a real id is a finding here. Nothing is
// baselined.
//
// Run:  npx tsx tests/simulation/campaign/owner-walk.ts
// Out:  tests/simulation/campaign/owner-walk-results.jsonl   (one line per visit)
//       tests/simulation/campaign/findings.jsonl              (F-WALK-n, appended)
//       tests/simulation/campaign/shots/<day>/<viewport>/<route-slug>.png
// =============================================================================

process.env.NODE_ENV = 'test';
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.ENCRYPTION_KEY ??= '0'.repeat(64);
process.env.CLERK_SECRET_KEY ??= 'sk_test_fake';
process.env.CLERK_PUBLISHABLE_KEY ??= 'pk_test_fake';
process.env.ANTHROPIC_API_KEY ??= 'sk-ant-test';
process.env.STRIPE_SECRET_KEY ??= 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_fake';

import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { chromium, type Browser, type Page } from 'playwright-core';

const HERE = dirname(fileURLToPath(import.meta.url));
// Outputs go outside the source tree (CAMPAIGN_OUT overrides).
const OUT_DIR = process.env.CAMPAIGN_OUT ?? resolve(tmpdir(), 'foundry-campaign');
mkdirSync(OUT_DIR, { recursive: true });
const ROOT = resolve(HERE, '../../..');
// WALK_ONLY=<regex> walks only the routes that match, into files of their own,
// and numbers its findings after the full walk's rather than replacing them.
const ONLY = process.env.WALK_ONLY ? new RegExp(process.env.WALK_ONLY) : null;
const OUT = resolve(OUT_DIR, ONLY ? 'owner-walk-results.only.jsonl' : 'owner-walk-results.jsonl');
const FINDINGS = resolve(OUT_DIR, 'findings.jsonl');
const SHOTS = resolve(OUT_DIR, ONLY ? 'shots-only' : 'shots');
const AXE = ['/home/user/AcreOS/node_modules/axe-core/axe.min.js', resolve(ROOT, 'node_modules/axe-core/axe.min.js')].find((p) => existsSync(p));
const CHROMIUM = [
  '/opt/pw-browsers/chromium-1228/chrome-linux64/chrome',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium', '/usr/bin/google-chrome',
].find((p) => existsSync(p));
if (!CHROMIUM) { console.error('no Chromium binary found'); process.exit(2); }
if (!AXE) { console.error('no axe-core found'); process.exit(2); }

// NO NETWORK. The world's provider stubs answer Cloudflare, Resend and Stripe
// as a rehearsal; anything else is a network error, exactly as a machine with
// no route out would see it. Nothing here reaches the internet.
const { providerStubs } = await import('../../helpers/provider-stubs.js');
const stubs = providerStubs();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
  if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u)) return realFetch(url as never, init);
  try { return await stubs.fetch(u, init); } catch (e) {
    throw new TypeError(`fetch failed (no network in the laboratory): ${e instanceof Error ? e.message : String(e)}`);
  }
}) as typeof fetch;

const { query } = await import('../../../src/db/client.js');
const {
  seedProductionShape, addCompanies, advanceDays, runMorning, MORNING, HANDS, ownerApp, OWNER,
} = await import('../../helpers/world.js');

// ── The world ────────────────────────────────────────────────────────────────
const t0 = Date.now();
const { experimentId: X } = await seedProductionShape({ charter: true, searching: true, eyes: true, undecided: true });
const app = await ownerApp();
(app as unknown as { onError: (f: (e: Error, c: { text: (s: string, n: number) => Response }) => Response) => void })
  .onError((err, c) => c.text(`ERR: ${String(err?.stack ?? err).split('\n').slice(0, 4).join(' | ')}`, 500));
// The manifest and the service worker come with ownerApp() now, from the same
// handlers src/index.ts mounts (remediation 1.6), so the walk adds nothing here.
const companyIds = await addCompanies(app, ['Apex Micro Press', 'Northfield Candles', 'Tidewater Templates']);

// Mail, so the Inbox has threads and one of them needs him.
{
  const mail = await import('../../../src/services/public-workshop/mail.js');
  const { publicWorkshopOf } = await import('../../../src/services/public-workshop/settings.js');
  await mail.openTheEars(OWNER);
  const w = await publicWorkshopOf(OWNER);
  const to = w?.contactEmail ?? 'thomas@apexmicro.ai';
  await mail.hearMail({ founderId: OWNER, to, from: 'shop@example.com', fromName: 'A millwork shop', subject: 'About the bid brief', body: 'Is the brief updated weekly? We bid on three jobs a month.', rfcMessageId: '<walk-1@example.com>', size: 120 });
  await mail.hearMail({ founderId: OWNER, to, from: 'buyer@example.com', fromName: 'Dana Ives', subject: 'Thanks', body: 'This was useful.', rfcMessageId: '<walk-2@example.com>', size: 40 });
}
console.log(`world seeded in ${String(Date.now() - t0)}ms: owner ${OWNER}, experiment ${X}, companies ${companyIds.join(', ')}`);

// ── Serve it ─────────────────────────────────────────────────────────────────
// THE VIEWER, AS PRODUCTION HAS IT. `authMiddleware` runs every owner request
// inside `withViewer(founder.id, …)`, which is the only way the header's
// "Needs you" count is computed; the laboratory's ownerApp does not mount that
// middleware, so without this every page renders NO count (never a zero) and
// the honesty check has nothing to read. Set WALK_VIEWER=0 to see the surface
// exactly as the laboratory serves it.
const { withViewer } = await import('../../../src/views/owner/viewer.js');
const viewer = process.env.WALK_VIEWER !== '0';
const server = serve({ fetch: (req: Request) => (viewer ? withViewer(OWNER, () => app.fetch(req)) : app.fetch(req)), port: 0, hostname: '127.0.0.1' });
if (!server.address()) await new Promise<void>((r) => { (server as unknown as { once: (ev: string, f: () => void) => void }).once('listening', r); });
const port = (server.address() as { port: number }).port;
const BASE = `http://127.0.0.1:${String(port)}`;
console.log(`serving the owner surface at ${BASE}`);

// ── The pages, from the rows ─────────────────────────────────────────────────
const DOORS = ['/foundry', '/foundry/companies', '/foundry/explore', '/foundry/controls'];

/** Every parameterless GET in src/routes/dashboard/*-place.ts, read from the files so this cannot rot. */
function placesFromSource(): string[] {
  const dir = resolve(ROOT, 'src/routes/dashboard');
  const out = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('-place.ts'))) {
    const src = readFileSync(resolve(dir, f), 'utf8');
    for (const m of src.matchAll(/\.get\(\s*'(\/[^']+)'/g)) if (!m[1]!.includes(':')) out.add(m[1]!);
  }
  return [...out].sort();
}
const PLACES = placesFromSource();
// places.ts (not a *-place file) and the owner's exit doors, which the surface links from every page.
const ALSO = ['/foundry/needs-you', '/foundry/decisions', '/foundry/searching', '/foundry/inbox?show=handled', '/foundry/inbox?show=needs',
  '/foundry/controls/connectors', '/letter', '/settings', '/privacy'];

interface PageSpec { route: string; kind: 'door' | 'place' | 'also' | 'company' | 'experiment' | 'mission' | 'thread' | 'why' | 'connector' }

async function pagesNow(): Promise<PageSpec[]> {
  const pages: PageSpec[] = [];
  for (const r of DOORS) pages.push({ route: r, kind: 'door' });
  for (const r of PLACES) if (!DOORS.includes(r)) pages.push({ route: r, kind: 'place' });
  for (const r of ALSO) pages.push({ route: r, kind: 'also' });
  const products = (await query(`SELECT id FROM products WHERE owner_id = ? AND deleted_at IS NULL ORDER BY rowid`, [OWNER])).rows as unknown as Array<{ id: string }>;
  for (const { id } of products) {
    pages.push({ route: `/foundry/companies/${id}`, kind: 'company' });
    for (const sub of ['authority', 'work', 'economics', 'customers', 'experiments', 'evidence']) pages.push({ route: `/foundry/companies/${id}/${sub}`, kind: 'company' });
    pages.push({ route: `/foundry/why/company/${id}`, kind: 'why' });
  }
  const experiments = (await query(`SELECT id FROM venture_experiments WHERE founder_id = ? ORDER BY rowid`, [OWNER])).rows as unknown as Array<{ id: string }>;
  for (const { id } of experiments) {
    pages.push({ route: `/foundry/experiments/${id}`, kind: 'experiment' });
    pages.push({ route: `/foundry/experiments/${id}/decide`, kind: 'experiment' });
    pages.push({ route: `/foundry/experiments/${id}/recipients`, kind: 'experiment' });
    pages.push({ route: `/foundry/public-workshop/preview/${id}`, kind: 'experiment' });
    pages.push({ route: `/foundry/why/experiment/${id}`, kind: 'why' });
  }
  const { missionsOf } = await import('../../../src/services/mission/read.js');
  for (const m of await missionsOf(OWNER)) pages.push({ route: `/foundry/missions/${encodeURIComponent(m.key)}`, kind: 'mission' });
  const threads = (await query(`SELECT DISTINCT thread_key FROM workshop_mail WHERE founder_id = ? ORDER BY rowid`, [OWNER])).rows as unknown as Array<{ thread_key: string }>;
  for (const t of threads) pages.push({ route: `/foundry/inbox/${encodeURIComponent(t.thread_key)}`, kind: 'thread' });
  try {
    const { connectorsFor } = await import('../../../src/services/senses/journey.js');
    const first = products[0]?.id;
    if (first) for (const cn of (await connectorsFor(first)).slice(0, 2)) pages.push({ route: `/foundry/controls/connectors/${encodeURIComponent(cn.provider)}`, kind: 'connector' });
  } catch (e) { console.log(`connectors could not be listed: ${e instanceof Error ? e.message : String(e)}`); }
  const seen = new Set<string>();
  return pages.filter((p) => (seen.has(p.route) ? false : (seen.add(p.route), true))).filter((p) => !ONLY || ONLY.test(p.route));
}

// ── What the rows say needs him ──────────────────────────────────────────────
interface Truth { service: number | null; raw: Record<string, number>; rawTotal: number }
async function truthNow(): Promise<Truth> {
  const n = async (sql: string, args: unknown[] = []): Promise<number> => {
    try { return Number((((await query(sql, args)).rows[0] as Record<string, unknown> | undefined)?.n) ?? 0); } catch { return -1; }
  };
  const raw: Record<string, number> = {
    proposed_acts_undecided: await n(`SELECT COUNT(*) AS n FROM proposed_acts a JOIN products p ON p.id = a.product_id WHERE p.owner_id = ? AND a.decided_at IS NULL`, [OWNER]),
    recommendations_undecided: await n(`SELECT COUNT(*) AS n FROM situation_recommendations r JOIN products p ON p.id = r.product_id WHERE p.owner_id = ? AND r.decided_at IS NULL`, [OWNER]),
    responsibility_candidates_open: await n(`SELECT COUNT(*) AS n FROM responsibility_candidates rc JOIN products p ON p.id = rc.product_id WHERE p.owner_id = ? AND rc.status = 'pending'`, [OWNER]),
    experiments_undecided: await n(`SELECT COUNT(*) AS n FROM venture_experiments WHERE founder_id = ? AND decision IS NULL`, [OWNER]),
    mail_needing_owner: -1,
    missions_tripped: -1,
  };
  try {
    const mail = await import('../../../src/services/public-workshop/mail.js');
    raw.mail_needing_owner = (await mail.needsTheOwner(OWNER)).length;
  } catch { /* counted as unknown */ }
  try {
    const { missionsOf } = await import('../../../src/services/mission/read.js');
    raw.missions_tripped = (await missionsOf(OWNER)).filter((m) => m.tripped !== null).length;
  } catch { /* counted as unknown */ }
  let service: number | null = null;
  try {
    const { needsYouCount } = await import('../../../src/services/needs-you/queue.js');
    service = await needsYouCount(OWNER);
  } catch (e) { console.log(`needsYouCount threw: ${e instanceof Error ? e.message : String(e)}`); }
  const rawTotal = Object.values(raw).filter((v) => v >= 0).reduce((a, b) => a + b, 0);
  return { service, raw, rawTotal };
}

// ── The viewports ────────────────────────────────────────────────────────────
const VIEWPORTS = [
  { name: 'iphone13', width: 390, height: 844, mobile: true },
  { name: 'iphoneSE', width: 375, height: 667, mobile: true },
  { name: 'desktop', width: 1440, height: 900, mobile: false },
] as const;

// ── What the browser measures ────────────────────────────────────────────────
// PLAIN JAVASCRIPT IN A STRING, ON PURPOSE. tsx transpiles this file with
// esbuild's keepNames, which rewrites every inner function as `__name(...)`;
// Playwright serialises a function by its source, and `__name` does not exist
// in the page. A string is evaluated as written.
interface Measured {
  ttfbMs: number | null; dclMs: number | null; artifacts: string[]; overflowX: number; h1Count: number; words: number; controls: number; barControls: number;
  smallTargets: { under44: number; under24: number; first: string[] } | null;
  oneThing: { present: boolean; top: number | null; inFirstViewport: boolean | null; primaryTop: number | null; primaryInFirstViewport: boolean | null };
  headerNeeds: number | null; headerNeedsLabel: string | null; bodyClaimsNeeds: number | null; title: string;
}
const MEASURE_JS = String.raw`(mobile) => {
  const nav = performance.getEntriesByType('navigation')[0];
  const ttfbMs = nav ? Math.round(nav.responseStart - nav.requestStart) : null;
  const dclMs = nav ? Math.round(nav.domContentLoadedEventEnd - nav.startTime) : null;
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll('script,style,code,pre,kbd,noscript').forEach((e) => e.remove());
  const text = (clone.textContent || '').replace(/\s+/g, ' ');
  const artifacts = [];
  for (const rx of [/\bundefined\b/, /\bNaN\b/, /\[object Object\]/, /Invalid Date/, /(^|[^a-zA-Z])null([^a-zA-Z]|$)/]) {
    const m = rx.exec(text);
    if (m) { const i = m.index; artifacts.push('"' + m[0].trim() + '" …' + text.slice(Math.max(0, i - 60), i + 60) + '…'); }
  }
  const de = document.documentElement;
  const overflowX = Math.max(0, de.scrollWidth - window.innerWidth);
  const h1Count = document.querySelectorAll('h1').length;
  const main = document.querySelector('main');
  const words = (main ? main.innerText : document.body.innerText).split(/\s+/).filter(Boolean).length;
  const sel = (e) => {
    const tag = e.tagName.toLowerCase();
    const id = e.id ? '#' + e.id : '';
    const cls = e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    const href = e.getAttribute('href'); const txt = (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30);
    return tag + id + cls + (href ? '[href="' + href.slice(0, 40) + '"]' : '') + (txt ? ' "' + txt + '"' : '');
  };
  const visible = (e) => {
    const r = e.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(e); return cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const ctrlKey = (e) => e.tagName + '|' + (e.getAttribute('href') || '') + '|' + (e.getAttribute('name') || '') + '=' + (e.getAttribute('value') || '') + '|' + (e.textContent || '').trim().slice(0, 40);
  const inMain = [...(main || document.body).querySelectorAll('a[href],button,input[type=submit],summary,[role=button]')].filter(visible);
  const controls = new Set(inMain.map(ctrlKey)).size;
  const barControls = new Set([...document.querySelectorAll('nav.places a[href],nav.places button')].filter(visible).map(ctrlKey)).size;
  let smallTargets = null;
  if (mobile) {
    const all = [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button]')].filter(visible);
    const small = all.filter((e) => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; });
    const tiny = all.filter((e) => { const r = e.getBoundingClientRect(); return r.width < 24 || r.height < 24; });
    smallTargets = { under44: small.length, under24: tiny.length, first: small.slice(0, 3).map(sel) };
  }
  const one = document.querySelector('#the-one-thing');
  const H = window.innerHeight;
  const primary = (one && one.querySelector('.btn.go, .do button, .do a')) || document.querySelector('main .btn.go');
  const oneThing = {
    present: Boolean(one),
    top: one ? Math.round(one.getBoundingClientRect().top + window.scrollY) : null,
    inFirstViewport: one ? one.getBoundingClientRect().top < H && one.getBoundingClientRect().bottom > 0 : null,
    primaryTop: primary ? Math.round(primary.getBoundingClientRect().top + window.scrollY) : null,
    primaryInFirstViewport: primary ? primary.getBoundingClientRect().bottom <= H : null,
  };
  const needs = document.querySelector('main .brand a.needs');
  const b = needs ? needs.querySelector('b') : null;
  const label = needs ? needs.getAttribute('aria-label') : null;
  let headerNeeds = null;
  if (b) headerNeeds = Number(b.textContent); else if (label && /Nothing needs you/.test(label)) headerNeeds = 0;
  const claim = /(\d+)\s+things?\s+needs?\s+you/i.exec(main ? main.innerText : '');
  const bodyClaimsNeeds = claim ? Number(claim[1]) : null;
  return { ttfbMs, dclMs, artifacts, overflowX, h1Count, words, controls, barControls, smallTargets, oneThing, headerNeeds, headerNeedsLabel: label, bodyClaimsNeeds, title: document.title };
}`;
const AXE_JS = String.raw`(async () => {
  const r = await window.axe.run(document, { resultTypes: ['violations'] });
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, impact: v.impact, count: v.nodes.length, firstTarget: String((v.nodes[0] && v.nodes[0].target && v.nodes[0].target[0]) || '') }));
})()`;

// ── One visit ────────────────────────────────────────────────────────────────
interface Visit {
  day: string; viewport: string; route: string; kind: string; status: number | null; finalPath: string; contentType: string;
  ttfbMs: number | null; dclMs: number | null;
  artifacts: string[]; consoleErrors: string[]; failedSubresources: string[];
  overflowX: number; h1Count: number;
  smallTargets: { under44: number; under24: number; first: string[] } | null;
  axe: { critical: Record<string, { count: number; firstTarget: string }>; serious: Record<string, { count: number; firstTarget: string }> } | null;
  words: number; controls: number; barControls: number;
  oneThing: { present: boolean; top: number | null; inFirstViewport: boolean | null; primaryTop: number | null; primaryInFirstViewport: boolean | null };
  headerNeeds: number | null; headerNeedsLabel: string | null; bodyClaimsNeeds: number | null;
  truth: Truth; honest: boolean | null;
  title: string; serverError: string;
}

async function visit(page: Page, day: string, vp: typeof VIEWPORTS[number], spec: PageSpec, truth: Truth): Promise<Visit> {
  const consoleErrors: string[] = [];
  const failedSubresources: string[] = [];
  const onConsole = (m: { type: () => string; text: () => string }) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); };
  const onPageError = (e: Error) => { consoleErrors.push(`pageerror: ${e.message.slice(0, 200)}`); };
  const onResponse = (r: { url: () => string; status: () => number }) => { const u = r.url(); if (u !== BASE + spec.route && r.status() >= 400) failedSubresources.push(`${String(r.status())} ${u.replace(BASE, '')}`); };
  const onFailed = (r: { url: () => string; failure: () => { errorText: string } | null }) => { failedSubresources.push(`failed ${r.url().replace(BASE, '')} ${r.failure()?.errorText ?? ''}`); };
  page.on('console', onConsole); page.on('pageerror', onPageError); page.on('response', onResponse); page.on('requestfailed', onFailed);
  // EVERY REQUEST THE BROWSER MAKES, not only the page's: a manifest, an icon
  // or a service worker's fetch fires no page 'response' event, and a 404 among
  // them showed only as an anonymous console line (remediation 1.6).
  const cdp = await page.context().newCDPSession(page).catch(() => null);
  const onNet = (e: { response: { url: string; status: number } }) => {
    if (e.response.status >= 400 && e.response.url !== BASE + spec.route) failedSubresources.push(`${String(e.response.status)} ${e.response.url.replace(BASE, '')} (browser)`);
  };
  if (cdp) { await cdp.send('Network.enable').catch(() => undefined); cdp.on('Network.responseReceived', onNet as never); }
  let status: number | null = null; let contentType = ''; let serverError = '';
  try {
    const res = await page.goto(BASE + spec.route, { waitUntil: 'load', timeout: 45_000 });
    status = res?.status() ?? null; contentType = res?.headers()['content-type'] ?? '';
    if (res && res.status() >= 500) serverError = (await res.text().catch(() => '')).slice(0, 400);
  } catch (e) {
    consoleErrors.push(`navigation: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
  }

  const base = {
    day, viewport: vp.name, route: spec.route, kind: spec.kind, status, finalPath: page.url().replace(BASE, ''), contentType, serverError,
    ttfbMs: null as number | null, dclMs: null as number | null, artifacts: [] as string[], consoleErrors, failedSubresources,
    overflowX: 0, h1Count: 0, smallTargets: null as Visit['smallTargets'], axe: null as Visit['axe'],
    words: 0, controls: 0, barControls: 0,
    oneThing: { present: false, top: null, inFirstViewport: null, primaryTop: null, primaryInFirstViewport: null } as Visit['oneThing'],
    headerNeeds: null as number | null, headerNeedsLabel: null as string | null, bodyClaimsNeeds: null as number | null,
    truth, honest: null as boolean | null, title: '',
  };
  const isHtml = contentType.includes('text/html');
  if (!isHtml) {
    page.off('console', onConsole); page.off('pageerror', onPageError); page.off('response', onResponse); page.off('requestfailed', onFailed);
    return base;
  }

  const measured = await page.evaluate(`(${MEASURE_JS})(${String(vp.mobile)})`) as Measured;

  let axe: Visit['axe'] = null;
  try {
    await page.addScriptTag({ path: AXE });
    const result = await page.evaluate(AXE_JS) as Array<{ id: string; impact: string; count: number; firstTarget: string }>;
    axe = { critical: {}, serious: {} };
    for (const v of result) axe[v.impact as 'critical' | 'serious'][v.id] = { count: v.count, firstTarget: v.firstTarget };
  } catch (e) { consoleErrors.push(`axe: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`); }

  const shotDir = resolve(SHOTS, day, vp.name);
  mkdirSync(shotDir, { recursive: true });
  const slug = (spec.route.replace(/^\//, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/_+$/, '') || 'root').slice(0, 120);
  try { await page.screenshot({ path: resolve(shotDir, `${slug}.png`), fullPage: true }); } catch (e) { consoleErrors.push(`screenshot: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`); }

  page.off('console', onConsole); page.off('pageerror', onPageError); page.off('response', onResponse); page.off('requestfailed', onFailed);
  const honest = measured.headerNeeds === null || truth.service === null ? null : measured.headerNeeds === truth.service;
  return { ...base, ...measured, axe, honest };
}

// ── The three moments ────────────────────────────────────────────────────────
writeFileSync(OUT, '');
const visits: Visit[] = [];
const mornings: Array<{ day: string; ran: Array<{ job: string; ok: boolean; error?: string }> }> = [];
const browser: Browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

const MOMENTS: Array<{ day: string; before: () => Promise<void> }> = [
  { day: 'day1', before: async () => { /* as seeded */ } },
  { day: 'day9', before: async () => { await advanceDays(8); mornings.push({ day: 'day9', ran: await runMorning([...new Set([...MORNING, ...HANDS])]) }); } },
  { day: 'day39', before: async () => { await advanceDays(30); mornings.push({ day: 'day39', ran: await runMorning([...new Set([...MORNING, ...HANDS])]) }); } },
];

try {
  for (const moment of MOMENTS) {
    const tm = Date.now();
    await moment.before();
    const pages = await pagesNow();
    const truth = await truthNow();
    console.log(`\n── ${moment.day}: ${String(pages.length)} pages; rows say needs-you service=${String(truth.service)} raw=${JSON.stringify(truth.raw)}`);
    await Promise.all(VIEWPORTS.map(async (vp) => {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: 1,
        colorScheme: 'dark', userAgent: vp.mobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' : undefined,
      });
      const page = await ctx.newPage();
      for (const spec of pages) {
        const v = await visit(page, moment.day, vp, spec, truth);
        visits.push(v);
        appendFileSync(OUT, `${JSON.stringify(v)}\n`);
        const flags = [v.status && v.status >= 400 ? `HTTP ${String(v.status)}` : '', v.artifacts.length ? 'ARTIFACT' : '', v.overflowX ? `overflow ${String(v.overflowX)}px` : '',
          v.axe && Object.keys(v.axe.critical).length ? `axe-critical ${Object.keys(v.axe.critical).join(',')}` : '', v.honest === false ? 'HEADER≠ROWS' : ''].filter(Boolean).join(' ');
        process.stdout.write(`  ${vp.name.padEnd(9)} ${String(v.status ?? '—').padStart(3)} ${String(v.words).padStart(5)}w ${String(v.controls).padStart(3)}c  ${spec.route}${flags ? `  ← ${flags}` : ''}\n`);
      }
      await ctx.close();
    }));
    console.log(`── ${moment.day} walked in ${String(Math.round((Date.now() - tm) / 1000))}s`);
  }
} finally {
  await browser.close();
  server.close();
}

// ── Findings ─────────────────────────────────────────────────────────────────
interface Finding { id: string; sev: 'P1' | 'P2' | 'P3' | 'UX'; area: string; title: string; evidence: string }
const findings: Finding[] = [];
const priorWalk = existsSync(FINDINGS) ? readFileSync(FINDINGS, 'utf8').split('\n').filter((l) => /"id":"F-WALK-/.test(l)) : [];
let n = ONLY ? priorWalk.reduce((m, l) => Math.max(m, Number(/"id":"F-WALK-(\d+)"/.exec(l)?.[1] ?? 0)), 0) : 0;
const add = (sev: Finding['sev'], area: string, title: string, evidence: string) => { n += 1; findings.push({ id: `F-WALK-${String(n)}`, sev, area, title, evidence }); };
const where = (vs: Visit[]) => [...new Set(vs.map((v) => `${v.day}/${v.viewport}`))].join(', ');
const byRoute = new Map<string, Visit[]>();
for (const v of visits) { const k = v.route; if (!byRoute.has(k)) byRoute.set(k, []); byRoute.get(k)!.push(v); }

for (const [route, vs] of byRoute) {
  const bad = vs.filter((v) => v.status === null || v.status >= 500);
  if (bad.length) add('P1', 'availability', `${route} answers ${bad[0]!.status === null ? 'nothing' : String(bad[0]!.status)}`, `${where(bad)} — ${bad[0]!.serverError || bad[0]!.consoleErrors[0] || ''}`.trim());
  const forbidden = vs.filter((v) => v.status === 403);
  if (forbidden.length) add('P2', 'authority', `${route} is a 403 for the owner`, where(forbidden));
  const gone = vs.filter((v) => v.status === 404);
  if (gone.length) add('P2', 'dead-page', `${route} is a 404 with a real id`, where(gone));
  const moved = vs.filter((v) => v.status === 200 && v.finalPath && v.finalPath !== v.route);
  if (moved.length) add('UX', 'redirect', `${route} bounces to ${moved[0]!.finalPath}`, `${where(moved)} — a real id, and the page sends him somewhere else`);
  const art = vs.filter((v) => v.artifacts.length);
  if (art.length) add('P1', 'artifact', `${route} renders a template artifact`, `${where(art)} — ${art[0]!.artifacts.join(' / ')}`);
  const errs = vs.filter((v) => v.consoleErrors.length);
  if (errs.length) add('P3', 'console', `${route} logs browser errors`, `${where(errs)} — ${[...new Set(errs.flatMap((v) => v.consoleErrors))].slice(0, 3).join(' / ')}`);
  const sub = vs.filter((v) => v.failedSubresources.length);
  if (sub.length) add('P3', 'subresource', `${route} loads something that fails`, `${where(sub)} — ${[...new Set(sub.flatMap((v) => v.failedSubresources))].slice(0, 3).join(' / ')}`);
  const over = vs.filter((v) => v.overflowX > 0);
  if (over.length) add('UX', 'overflow', `${route} scrolls sideways`, `${over.map((v) => `${v.day}/${v.viewport}: ${String(v.overflowX)}px`).join(', ')} (the owner's mobile gate fails on 1px)`);
  const crit = new Map<string, Visit[]>(); const ser = new Map<string, Visit[]>();
  for (const v of vs) {
    for (const id of Object.keys(v.axe?.critical ?? {})) { if (!crit.has(id)) crit.set(id, []); crit.get(id)!.push(v); }
    for (const id of Object.keys(v.axe?.serious ?? {})) { if (!ser.has(id)) ser.set(id, []); ser.get(id)!.push(v); }
  }
  for (const [id, hits] of crit) add('P2', 'axe-critical', `${route}: ${id}`, `${where(hits)} — ${String(hits[0]!.axe!.critical[id]!.count)} node(s), first ${hits[0]!.axe!.critical[id]!.firstTarget}`);
  for (const [id, hits] of ser) add('P3', 'axe-serious', `${route}: ${id}`, `${where(hits)} — ${String(hits[0]!.axe!.serious[id]!.count)} node(s), first ${hits[0]!.axe!.serious[id]!.firstTarget}`);
  const h1 = vs.filter((v) => v.status === 200 && v.contentType.includes('html') && v.h1Count !== 1);
  if (h1.length) add('UX', 'headings', `${route} has ${String(h1[0]!.h1Count)} h1s`, where(h1));
  const dishonest = vs.filter((v) => v.honest === false);
  if (dishonest.length) add('P2', 'honesty', `${route}: header says ${String(dishonest[0]!.headerNeeds)} need(s) him; the queue says ${String(dishonest[0]!.truth.service)}`, `${where(dishonest)} — rows ${JSON.stringify(dishonest[0]!.truth.raw)}`);
  const claims = vs.filter((v) => v.bodyClaimsNeeds !== null && v.truth.service !== null && v.bodyClaimsNeeds !== v.truth.service);
  if (claims.length) add('P2', 'honesty', `${route}: the page says ${String(claims[0]!.bodyClaimsNeeds)} thing(s) need him; the queue says ${String(claims[0]!.truth.service)}`, `${where(claims)} — rows ${JSON.stringify(claims[0]!.truth.raw)}`);
  const mobile = vs.filter((v) => v.smallTargets && v.status === 200);
  const worst = mobile.sort((a, b) => (b.smallTargets!.under44) - (a.smallTargets!.under44))[0];
  if (worst && worst.smallTargets!.under24 > 0) add('UX', 'tap-targets', `${route}: ${String(worst.smallTargets!.under24)} control(s) under 24px on a phone (${String(worst.smallTargets!.under44)} under 44px)`, `${worst.day}/${worst.viewport} — ${worst.smallTargets!.first.join(' ; ')}`);
  const heavy = vs.filter((v) => v.viewport === 'iphone13' && v.words > 700);
  if (heavy.length) add('UX', 'reading-burden', `${route}: ${String(Math.max(...heavy.map((v) => v.words)))} words on a phone`, `${where(heavy)} — ${String(Math.max(...heavy.map((v) => v.controls)))} controls`);
  const slow = vs.filter((v) => (v.ttfbMs ?? 0) > 1500);
  if (slow.length) add('UX', 'speed', `${route}: ${String(Math.max(...slow.map((v) => v.ttfbMs ?? 0)))}ms to first byte`, where(slow));
}
// The one thing, on Home, on the phone.
for (const v of visits.filter((x) => x.route === '/foundry' && x.viewport !== 'desktop')) {
  if (!v.oneThing.present) add('UX', 'one-thing', `Home has no "one thing" card on ${v.day}`, `${v.day}/${v.viewport} — the queue says ${String(v.truth.service)} need(s) him`);
  else if (v.oneThing.inFirstViewport === false) add('UX', 'one-thing', `Home's one thing is below the first screen on ${v.day}`, `${v.day}/${v.viewport} — card top at ${String(v.oneThing.top)}px, screen ${String(VIEWPORTS.find((x) => x.name === v.viewport)!.height)}px`);
  else if (v.oneThing.primaryInFirstViewport === false) add('UX', 'one-thing', `Home's one thing is on the first screen but its button is not, on ${v.day}`, `${v.day}/${v.viewport} — button top at ${String(v.oneThing.primaryTop)}px`);
}
for (const m of mornings) for (const r of m.ran.filter((x) => !x.ok)) add('P3', 'morning', `${m.day}: routine ${r.job} failed in the laboratory`, (r.error ?? '').slice(0, 300));

// THIS RUN'S FINDINGS REPLACE THE LAST RUN'S; other campaigns' lines in the same file are kept.
if (!ONLY) { const kept = existsSync(FINDINGS) ? readFileSync(FINDINGS, 'utf8').split('\n').filter((l) => l && !/"id":"F-WALK-/.test(l)) : [];
  writeFileSync(FINDINGS, kept.length ? kept.join('\n') + '\n' : ''); }
for (const f of findings) appendFileSync(FINDINGS, `${JSON.stringify(f)}\n`);

// ── Summary ──────────────────────────────────────────────────────────────────
const routes = [...byRoute.keys()];
const html200 = visits.filter((v) => v.status === 200 && v.contentType.includes('html'));
console.log('\n================ OWNER WALK ================');
console.log(`Pages covered: ${String(routes.length)} routes × ${String(VIEWPORTS.length)} viewports × ${String(MOMENTS.length)} moments = ${String(visits.length)} visits (${String(html200.length)} rendered HTML 200)`);
const byClass = new Map<string, number>();
for (const f of findings) byClass.set(`${f.sev} ${f.area}`, (byClass.get(`${f.sev} ${f.area}`) ?? 0) + 1);
console.log(`Findings: ${String(findings.length)}`);
for (const [k, c] of [...byClass].sort()) console.log(`  ${k}: ${String(c)}`);
const heaviest = [...byRoute].map(([r, vs]) => ({ r, w: Math.max(...vs.filter((v) => v.viewport === 'iphone13').map((v) => v.words)), c: Math.max(...vs.map((v) => v.controls)) }));
console.log('\n10 heaviest pages by words (iPhone 13, max over days):');
for (const p of [...heaviest].sort((a, b) => b.w - a.w).slice(0, 10)) console.log(`  ${String(p.w).padStart(5)}w ${String(p.c).padStart(3)}c  ${p.r}`);
console.log('\n10 pages with the most controls (max over visits):');
for (const p of [...heaviest].sort((a, b) => b.c - a.c).slice(0, 10)) console.log(`  ${String(p.c).padStart(3)}c ${String(p.w).padStart(5)}w  ${p.r}`);
const fives = visits.filter((v) => v.status === null || v.status >= 500);
console.log(`\n5xx/503: ${String(fives.length)}`); for (const v of fives.slice(0, 20)) console.log(`  ${v.day}/${v.viewport} ${String(v.status)} ${v.route} ${v.serverError}`);
const arts = visits.filter((v) => v.artifacts.length);
console.log(`Artifacts: ${String(arts.length)}`); for (const v of arts.slice(0, 20)) console.log(`  ${v.day}/${v.viewport} ${v.route}: ${v.artifacts.join(' / ')}`);
console.log('\nHonesty (header count vs the queue vs the rows):');
for (const day of MOMENTS.map((m) => m.day)) {
  const home = visits.find((v) => v.route === '/foundry' && v.day === day && v.viewport === 'iphone13');
  if (home) console.log(`  ${day}: header=${String(home.headerNeeds)} (${home.headerNeedsLabel ?? 'no label'}) body=${String(home.bodyClaimsNeeds)} queue=${String(home.truth.service)} rows=${JSON.stringify(home.truth.raw)}`);
}
console.log('\nThe one thing on Home, on the phone:');
for (const v of visits.filter((x) => x.route === '/foundry' && x.viewport === 'iphone13')) console.log(`  ${v.day}: present=${String(v.oneThing.present)} top=${String(v.oneThing.top)} firstScreen=${String(v.oneThing.inFirstViewport)} buttonTop=${String(v.oneThing.primaryTop)} buttonOnFirstScreen=${String(v.oneThing.primaryInFirstViewport)} words=${String(v.words)} controls=${String(v.controls)}`);
console.log('\nMornings:');
for (const m of mornings) console.log(`  ${m.day}: ${m.ran.map((r) => `${r.job}:${r.ok ? 'ok' : 'FAILED'}`).join(' ')}`);
const median = (xs: number[]) => { const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)]! : 0; };
console.log(`\nTTFB median ${String(median(html200.map((v) => v.ttfbMs ?? NaN)))}ms, max ${String(Math.max(...html200.map((v) => v.ttfbMs ?? 0)))}ms; DCL median ${String(median(html200.map((v) => v.dclMs ?? NaN)))}ms`);
console.log(`\nResults: ${OUT}\nFindings: ${FINDINGS}\nShots: ${SHOTS}`);
console.log('============================================');
process.exit(0);
