// =============================================================================
// FROM NOTHING TO A SALE — can Foundry make a product and sell it on its own?
//
// The owner's question, verbatim: "can Foundry actually create a portfolio of
// digital income streams from scratch? It has been running but hasn't ever had
// a test succeed to where something gets created."
//
// This runs the REAL institution, day by day, the way production runs it:
//   - every routine in JOB_REGISTRY through the job lock, the hands re-run
//     through the day as their hourly schedule does;
//   - the eyes read the REAL public sources (Hacker News, npm, DuckDuckGo,
//     iTunes, Remotive, GitHub, Wikipedia), recorded once to a cassette so a
//     re-run reads exactly the same world;
//   - the model is a local stand-in (`model-standin.mjs`) that the real
//     client reaches over HTTP. In `oracle` mode a capable model answers each
//     call; in `script` mode it answers with schema-shaped, content-free
//     output (plumbing only). The call log says which answered what.
//   - Stripe, Cloudflare and Resend are the repo's shape-faithful stubs, so a
//     link, a page or a send is a REAL call the institution made;
//   - buyers come from an explicit market model (below), calibrated against a
//     real seller's reported numbers, and pay through the REAL webhook route.
//
// Worlds (FROM_NOTHING_WORLD):
//   today      production as it stands: no charter, minutes-per-sale refused,
//              no Stripe webhook secret. The owner has asked it to search.
//   all-acts   every owner act the pipeline needs is done on day 0: charter
//              signed, minutes-per-sale allowed, webhook secret set, money
//              tools on, the Workshop stood up with a proven reply route.
//   late-charter  as all-acts, but the charter is signed on day LATE (10):
//              what the forge designed before then — can it ever be made?
//
// Output: $CAMPAIGN_OUT/from-nothing/<world>/{timeline.json,days.txt}.
// Runs only when FROM_NOTHING=1 (it needs the stand-in on STANDIN_PORT).
// =============================================================================
const STANDIN = `http://127.0.0.1:${process.env.STANDIN_PORT ?? '7799'}`;
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.NODE_ENV = 'test';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);
process.env.OPENROUTER_BASE_URL = `${STANDIN}/api/v1`;
process.env.OPENROUTER_API_KEY = 'sk-or-standin';
process.env.AI_TIMEOUT_MS = process.env.AI_TIMEOUT_MS ?? String(25 * 60_000);
// A slow local stand-in: the per-call budget and the forge pass deadline (F-DOOR-1)
// would otherwise cut it off at production's bounds.
process.env.AI_CALL_BUDGET_MS = process.env.AI_CALL_BUDGET_MS ?? String(75 * 60_000);
process.env.FORGE_PASS_BUDGET_MS = process.env.FORGE_PASS_BUDGET_MS ?? String(6 * 60 * 60_000);

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { query } from '../../../src/db/client.js';
import { providerStubs } from '../../helpers/provider-stubs.js';
import { HANDS, OWNER, advanceDays, giveTheWorkshopEars, seedProductionShape } from '../../helpers/world.js';
import { CAMPAIGN_OUT, runUnderLock, stripeSignature, type RunOutcome } from './campaign-helpers.js';

const ON = process.env.FROM_NOTHING === '1';
const WORLD = (process.env.FROM_NOTHING_WORLD ?? 'all-acts') as 'today' | 'all-acts' | 'late-charter';
const DAYS = Number(process.env.FROM_NOTHING_DAYS ?? 30);
const LATE = Number(process.env.FROM_NOTHING_LATE_DAY ?? 10);
const OUT = resolve(CAMPAIGN_OUT, 'from-nothing', WORLD + (process.env.FROM_NOTHING_TAG ? '-' + process.env.FROM_NOTHING_TAG : ''));
const CASSETTE = resolve(process.env.FROM_NOTHING_CASSETTE ?? resolve(CAMPAIGN_OUT, 'from-nothing', 'cassette.json'));
const CASSETTE_MODE = process.env.FROM_NOTHING_CASSETTE_MODE ?? 'record'; // record | replay

// ── The world's fetch: real public sources (cassette), the model stand-in, stubs for the rest ──
const PUBLIC_SOURCES = /^https:\/\/(hn\.algolia\.com|registry\.npmjs\.org|api\.github\.com|wikimedia\.org|[a-z]+\.wikipedia\.org|duckduckgo\.com|itunes\.apple\.com|remotive\.com)\//;
const realFetch = globalThis.fetch;
const { state, fetch: stubFetch } = providerStubs();
const cassette: Record<string, { status: number; body: string; contentType: string; at: string }> =
  existsSync(CASSETTE) ? JSON.parse(readFileSync(CASSETTE, 'utf8')) : {};
let cassetteDirty = false;
const sourceCalls: Array<{ day: number; url: string; status: number; from: 'cassette' | 'world' | 'missing' }> = [];
let today = 0;

async function worldFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  const u = String(url);
  if (u.startsWith(STANDIN)) return realFetch(url, init);
  if (PUBLIC_SOURCES.test(u)) {
    const key = `${init?.method ?? 'GET'} ${u}${init?.body ? ' #' + createHash('sha1').update(String(init.body)).digest('hex').slice(0, 10) : ''}`;
    const hit = cassette[key];
    if (hit) { sourceCalls.push({ day: today, url: u, status: hit.status, from: 'cassette' }); return new Response(hit.body, { status: hit.status, headers: { 'content-type': hit.contentType } }); }
    if (CASSETTE_MODE !== 'record') { sourceCalls.push({ day: today, url: u, status: 599, from: 'missing' }); return new Response('not in cassette', { status: 503 }); }
    try {
      const r = await realFetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
      const body = await r.text();
      cassette[key] = { status: r.status, body, contentType: r.headers.get('content-type') ?? 'application/json', at: new Date().toISOString() };
      cassetteDirty = true;
      sourceCalls.push({ day: today, url: u, status: r.status, from: 'world' });
      return new Response(body, { status: r.status, headers: { 'content-type': cassette[key].contentType } });
    } catch (e) {
      sourceCalls.push({ day: today, url: u, status: 598, from: 'world' });
      throw e;
    }
  }
  return stubFetch(url, init);
}
if (ON) vi.stubGlobal('fetch', worldFetch);

// ── The market: who finds a page, and who buys ─────────────────────────────────
// Every number here is an ASSUMPTION, stated so it can be argued with. The only
// external anchor is one seller's self-report (Travis Nicholson, Medium,
// 2026-10-04): $14,756 from 56,069 product-page views in year 1 and $27,415
// from ~145,000 in year 2 (≈ $0.19–0.26 per view; ≈4–5% view→purchase at a $5
// price with bundles) — an author WITH an audience, selling what his articles
// had already proven people wanted. Foundry has no audience; its only channels
// are what it actually did: pages announced to search engines (IndexNow), and
// strangers written to. A page nobody is sent to is found by search alone.
type Band = 'pessimistic' | 'base' | 'optimistic';
const BAND = (process.env.FROM_NOTHING_MARKET ?? 'base') as Band;
const MARKET: Record<Band, { searchVisitsPerDayAfterIndex: number; indexLagDays: number; visitToBuy: number; writtenToBuy: number }> = {
  // A new domain with no links: search sends almost nobody for weeks.
  pessimistic: { searchVisitsPerDayAfterIndex: 0.2, indexLagDays: 21, visitToBuy: 0.005, writtenToBuy: 0.0 },
  base: { searchVisitsPerDayAfterIndex: 1.0, indexLagDays: 14, visitToBuy: 0.01, writtenToBuy: 0.005 },
  // The playbook's own rates, as if Foundry had his audience.
  optimistic: { searchVisitsPerDayAfterIndex: 8, indexLagDays: 7, visitToBuy: 0.045, writtenToBuy: 0.02 },
};
let rngState = 0x2f6b1d3 ^ ['pessimistic', 'base', 'optimistic'].indexOf(BAND);
const rand = () => { rngState = (rngState * 1103515245 + 12345) >>> 0; return rngState / 0xffffffff; };
const poisson = (lambda: number) => { let k = 0; let p = Math.exp(-lambda); let s = p; const u = rand(); while (u > s && k < 1000) { k++; p *= lambda / k; s += p; } return k; };

interface Day {
  day: number;
  jobs: Record<string, RunOutcome['state']>;
  refusals: Array<{ job: string; message: string }>;
  counts: Record<string, number>;
  modelCalls: { total: number; byCaller: Record<string, number> };
  spendCents: number;
  needsYou: number;
  needsYouItems: string[];
  pagesLive: string[];
  paymentLinks: number;
  sends: { total: number; toStrangers: number };
  market: { visits: number; buys: number; revenueCents: number };
  eyes: { calls: number; fromWorld: number; failed: number };
  /** What Controls tells the owner ("can Foundry sell on its own?") on this day — compared with what happened. */
  saysItCanSell: { yes: boolean; blockers: string[] } | null;
  firstHeldGate: string | null;
}

const one = async (sql: string, p: unknown[] = []) => (await query(sql, p)).rows[0] as Record<string, unknown> | undefined;
const n = async (sql: string, p: unknown[] = []) => { try { return Number((await one(sql, p))?.n ?? 0); } catch { return -1; } };

async function counts(): Promise<Record<string, number>> {
  return {
    retrievals: await n('SELECT COUNT(*) n FROM market_retrievals'),
    retrievalItems: await n('SELECT COUNT(*) n FROM retrieval_items'),
    seeds: await n('SELECT COUNT(*) n FROM opportunity_seeds'),
    stances: await n('SELECT COUNT(*) n FROM epistemic_stances'),
    opportunities: await n('SELECT COUNT(*) n FROM venture_opportunities'),
    experiments: await n('SELECT COUNT(*) n FROM venture_experiments'),
    designs: await n('SELECT COUNT(*) n FROM probe_designs'),
    forgeRefusals: await n('SELECT COUNT(*) n FROM forge_refusals'),
    materials: await n('SELECT COUNT(*) n FROM experiment_materials'),
    exposures: await n('SELECT COUNT(*) n FROM experiment_exposures'),
    publications: await n('SELECT COUNT(*) n FROM public_publications'),
    fulfilments: await n('SELECT COUNT(*) n FROM experiment_fulfilments'),
  };
}

async function modelCallsSoFar(): Promise<Array<{ caller: string; outcome: string }>> {
  const log = resolve(process.env.STANDIN_DIR ?? '', 'calls.jsonl');
  if (!process.env.STANDIN_DIR || !existsSync(log)) return [];
  return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { caller: string; outcome: string; kind: string })
    .filter((c) => c.kind !== 'embeddings');
}
const callerKey = (s: string) => s.replace(/[^a-zA-Z ]/g, ' ').trim().split(/\s+/).slice(0, 6).join(' ');

/** Pages the Workshop serves right now: the store the program reads. */
function pagesLive(): string[] {
  const ns = state.cf.namespaces.find((x) => x.title === 'apexmicro-pages');
  const store = ns ? state.cf.kv.get(ns.id) : undefined;
  return store ? [...store.keys()].filter((k) => k.includes('experiments/')) : [];
}

let app: Hono;
// Production already holds Experiment 001 (hand-made, settled): it is the
// baseline, and everything reported is what the institution made AFTER it.
let baseline: Record<string, number> = {};
let seededPages = new Set<string>();
let seededLinks = new Set<string>();
const minus = (c: Record<string, number>) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v - (baseline[k] ?? 0)]));
const firstIndexedDay = new Map<string, number>();
let saleSeq = 0;

/** A buyer pays: Stripe takes the money and tells Foundry through the real webhook route. */
async function aBuyerPays(experimentId: string, amount: number): Promise<number> {
  const k = String(++saleSeq);
  const pi = `pi_mk_${k}`; const ch = `ch_mk_${k}`;
  const email = `buyer${k}@example.org`;
  state.buyers.set(pi, email);
  state.charges.set(ch, { amount, amount_refunded: 0, metadata: { app: 'foundry', experiment_id: experimentId, primitive: 'sale' } });
  state.payments.push({ id: pi, created: Math.floor(Date.now() / 1000), amount, amount_received: amount, currency: 'usd', status: 'succeeded', latest_charge: ch, metadata: { app: 'foundry', experiment_id: experimentId, primitive: 'sale' }, receipt_email: email });
  const payload = JSON.stringify({ id: `evt_mk_${k}`, object: 'event', type: 'payment_intent.succeeded', created: Math.floor(Date.now() / 1000), livemode: false,
    data: { object: { id: pi, object: 'payment_intent', amount, amount_received: amount, currency: 'usd', receipt_email: email, latest_charge: ch, metadata: { app: 'foundry', experiment_id: experimentId, primitive: 'sale' } } } });
  const r = await app.request('/webhooks/stripe', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': stripeSignature(payload, String(process.env.STRIPE_WEBHOOK_SECRET ?? 'unset')) }, body: payload });
  return r.status;
}

async function theMarketVisits(day: number): Promise<Day['market']> {
  const m = MARKET[BAND];
  let visits = 0; let buys = 0; let revenueCents = 0;
  const announced = new Set(state.indexNow.flatMap((a) => a.urlList));
  for (const link of state.paymentLinks.filter((l) => l.active && !seededLinks.has(l.id))) {
    const experimentId = link.metadata.experiment_id;
    if (!experimentId) continue;
    const page = [...announced].find((u) => experimentId && pagesLive().length > 0 && u.includes('/experiments/'));
    if (page && !firstIndexedDay.has(experimentId)) firstIndexedDay.set(experimentId, day);
    const since = firstIndexedDay.has(experimentId) ? day - (firstIndexedDay.get(experimentId) ?? day) : -1;
    const search = since >= m.indexLagDays ? poisson(m.searchVisitsPerDayAfterIndex) : 0;
    const strangersToday = state.sends.filter((s) => (s as { day?: number }).day === day && !/foundry|apexmicro|owner@/i.test(s.to.join(','))).length;
    visits += search;
    const price = state.prices.find((p) => link.line_items.some((li) => li.price === p.id))?.unit_amount ?? 0;
    let wouldBuy = 0;
    for (let i = 0; i < search; i++) if (rand() < m.visitToBuy) wouldBuy++;
    for (let i = 0; i < strangersToday; i++) if (rand() < m.writtenToBuy) wouldBuy++;
    for (let i = 0; i < wouldBuy; i++) {
      const status = await aBuyerPays(experimentId, price);
      if (status === 200) { buys++; revenueCents += price; }
    }
  }
  return { visits, buys, revenueCents };
}

/** The first gate holding the pipeline today, read from what the institution itself says. */
async function firstHeldGate(c: Record<string, number>, refusals: Day['refusals'], eyesToday: number): Promise<string | null> {
  if (eyesToday === 0) return 'eyes: nothing read from the world today';
  if (c.seeds === 0) return 'discovery: no seed sown from what was read';
  if (c.opportunities === 0 && c.experiments === 0) return 'promotion: no seed earned a second stance';
  if (c.designs === 0) return refusals.find((r) => r.job === 'forge_tick')?.message ?? 'forge: nothing designed';
  if (c.materials === 0) {
    const fr = await one('SELECT * FROM forge_refusals ORDER BY rowid DESC LIMIT 1');
    return 'make: no product made' + (fr ? ` — forge refused: ${JSON.stringify(fr).slice(0, 300)}` : '');
  }
  if (c.exposures === 0) return 'hand: nothing placed in the world (' + (refusals.find((r) => r.job === 'experiment_hand_tick')?.message ?? 'no refusal recorded') + ')';
  if (pagesLive().filter((p) => !seededPages.has(p)).length === 0) return 'publication: no new page served';
  return null;
}

describe.runIf(ON)(`from nothing to a sale — world=${WORLD}, ${String(DAYS)} days, market=${BAND}`, () => {
  const timeline: Day[] = [];

  it('the world is set as the owner would find it', async () => {
    mkdirSync(OUT, { recursive: true });
    const providers = { state, fetch: worldFetch as unknown as ReturnType<typeof providerStubs>['fetch'] };
    await seedProductionShape({ settledBy: 'the world', providers, searching: true, eyes: true, charter: WORLD === 'all-acts' });
    vi.stubGlobal('fetch', worldFetch); // seedProductionShape put the bare stub on globalThis
    if (WORLD === 'today') {
      delete process.env.STRIPE_WEBHOOK_SECRET; // production, 5 October: not set
      delete process.env.FOUNDRY_ENABLE_MONEY_TOOLS;
    } else {
      process.env.FOUNDRY_ENABLE_MONEY_TOOLS = 'true';
      state.domains.push({ id: 'dom_w', name: 'apexmicro.ai', status: 'verified', records: [] });
      const { standUpWorkshop } = await import('../../../src/services/public-workshop/infrastructure.js');
      await standUpWorkshop(OWNER, worldFetch as unknown as typeof fetch);
      // The seeded world already sent a reply-route check; the owner's act here is
      // having a route that is proven, which the helper does when it can.
      try { await giveTheWorkshopEars(OWNER); } catch (e) {
        const { theReplyRouteHasBeenProven } = await import('../../helpers/world.js');
        await theReplyRouteHasBeenProven(OWNER);
        writeFileSync(resolve(OUT, 'setup-notes.txt'), `reply route: ${e instanceof Error ? e.message : String(e)} — proven directly instead\n`, { flag: 'a' });
      }
      const { supersedeOriginationPolicy } = await import('../../../src/services/venture/legal-surface.js');
      const r = await supersedeOriginationPolicy({ founderId: OWNER, requirement: 'front_loaded_attention', treatment: 'prefer',
        why: 'the owner allows offers that still take some of his minutes per sale', by: `founder:${OWNER}` });
      expect(r).not.toHaveProperty('refused');
    }
    app = (await import('../../../src/index.js')).default as unknown as Hono;
    baseline = await counts();
    seededPages = new Set(pagesLive());
    seededLinks = new Set(state.paymentLinks.map((l) => l.id));
    writeFileSync(resolve(OUT, 'world.json'), JSON.stringify({ WORLD, DAYS, BAND, LATE, standin: STANDIN, startedAt: new Date().toISOString() }, null, 1));
  }, 600_000);

  it(`runs ${String(DAYS)} days of the institution and records what got made`, async () => {
    const { JOB_REGISTRY } = await import('../../../src/jobs/index.js');
    const { MORNING } = await import('../../helpers/world.js');
    const rest = Object.keys(JOB_REGISTRY).filter((j) => !(MORNING as readonly string[]).includes(j));
    const { needsYou } = await import('../../../src/services/needs-you/queue.js');
    let callsBefore = 0;
    for (let d = 1; d <= DAYS; d++) {
      today = d;
      if (WORLD === 'late-charter' && d === LATE) {
        const { signCharter } = await import('../../../src/services/institution/charter.js');
        await signCharter({ founderId: OWNER, testsTotalCents: 10000, probesInFlight: 3, cognitionCentsPerDay: 300, days: 60,
          publicVoice: 'Apex Micro', statement: 'A river of nickels: dozens of small, sturdy things, each tested for real, none needing me.' });
      }
      await advanceDays(1);
      const sendsBefore = state.sends.length;
      const jobs: Day['jobs'] = {};
      const refusals: Day['refusals'] = [];
      const order = [...MORNING, ...rest, ...HANDS, ...HANDS];
      for (const job of order) {
        const r = await runUnderLock(job);
        jobs[job] = jobs[job] === 'defect' ? 'defect' : r.state;
        if (r.state === 'refused' || r.state === 'defect') refusals.push({ job, message: `${r.state}: ${r.errorName ?? ''} ${r.message ?? ''}`.slice(0, 400) });
      }
      for (const s of state.sends.slice(sendsBefore)) (s as { day?: number }).day = d;
      const market = await theMarketVisits(d);
      const c = minus(await counts());
      const calls = await modelCallsSoFar();
      const todays = calls.slice(callsBefore); callsBefore = calls.length;
      const byCaller: Record<string, number> = {};
      for (const x of todays) byCaller[callerKey(x.caller)] = (byCaller[callerKey(x.caller)] ?? 0) + 1;
      const ny = await needsYou(OWNER).catch(() => ({ items: [], later: [] }));
      const spend = await one(`SELECT COALESCE(SUM(spent_cents),0) AS c FROM ai_daily_spend WHERE scope = 'global'`).catch(() => undefined);
      const { productionFacts, canSellOnItsOwn } = await import('../../../src/services/control/production-facts.js');
      const says = await productionFacts(OWNER).then((f) => canSellOnItsOwn(f)).catch(() => null);
      const day: Day = {
        saysItCanSell: says ? { yes: says.yes, blockers: says.blockers } : null,
        day: d, jobs, refusals, counts: c,
        modelCalls: { total: todays.length, byCaller },
        spendCents: Number(spend?.c ?? -1),
        needsYou: ny.items.length,
        needsYouItems: ny.items.map((i) => String((i as { title?: string; what?: string }).title ?? (i as { what?: string }).what ?? JSON.stringify(i).slice(0, 120))),
        pagesLive: pagesLive().filter((p) => !seededPages.has(p)),
        paymentLinks: state.paymentLinks.filter((l) => !seededLinks.has(l.id)).length,
        sends: { total: state.sends.length - sendsBefore, toStrangers: state.sends.slice(sendsBefore).filter((s) => !/apexmicro|foundry|owner@/i.test(s.to.join(','))).length },
        market,
        eyes: { calls: sourceCalls.filter((x) => x.day === d).length, fromWorld: sourceCalls.filter((x) => x.day === d && x.from === 'world').length, failed: sourceCalls.filter((x) => x.day === d && x.status >= 400).length },
        firstHeldGate: await firstHeldGate(c, refusals, sourceCalls.filter((x) => x.day === d).length),
      };
      timeline.push(day);
      writeFileSync(resolve(OUT, 'timeline.json'), JSON.stringify(timeline, null, 1));
      if (cassetteDirty) { mkdirSync(resolve(CASSETTE, '..'), { recursive: true }); writeFileSync(CASSETTE, JSON.stringify(cassette)); cassetteDirty = false; }
      const line = `day ${String(d).padStart(2)} | eyes ${day.eyes.calls} | seeds ${c.seeds} opp ${c.opportunities} exp ${c.experiments} designs ${c.designs} made ${c.materials} placed ${c.exposures} pages ${day.pagesLive.length} | calls ${todays.length} | needs-you ${day.needsYou} | visits ${market.visits} buys ${market.buys} | says-can-sell ${day.saysItCanSell?.yes ?? '?'} | ${day.firstHeldGate ?? 'nothing held'}`;
      writeFileSync(resolve(OUT, 'days.txt'), line + '\n', { flag: 'a' });
      console.log(line);
    }
    writeFileSync(resolve(OUT, 'source-calls.json'), JSON.stringify(sourceCalls, null, 1));
    expect(timeline.length).toBe(DAYS);
  }, 48 * 3600_000);
});

describe.skipIf(ON)('from nothing to a sale (off unless FROM_NOTHING=1)', () => {
  it('is a campaign run by hand against the model stand-in', () => { expect(ON).toBe(false); });
});
