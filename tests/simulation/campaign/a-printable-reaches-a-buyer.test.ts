// =============================================================================
// A PRINTABLE REACHES A BUYER — Foundry makes a file and a stranger buys it
// (Stage 2, C2). A sibling of from-nothing-to-a-sale that is NOT opt-in.
//
// The REAL institution on the repo's shape-faithful provider stubs:
//   * a forge design, sealed inside the owner's charter, reaches the real
//     forge pass (`forgePass`), which makes the thing (`shapeAndMake`) and
//     lets it in (`allowExperiment`) as the charter's principal;
//   * the model is SCRIPTED, deterministically (vi.mock of the client): the
//     composition answers with a printable offer, the writer with a real
//     fill-in file (tests/fixtures/printable-home-maintenance.ts, labelled a
//     fixture), the honesty check and four stranger personas with what a
//     capable model would say of it;
//   * headless Chromium really prints it (skipped, like every browser gate,
//     only where no browser exists — the CI runner has one);
//   * the hand's routines place the payment link and publish the page;
//   * a buyer pays through the REAL `/webhooks/stripe` route of the app in
//     src/index.ts with a correct Stripe signature, and the provider replays
//     the event three times;
//   * the hand delivers: the Resend stub records one email carrying a signed
//     link, and fetching that link through the app returns the PDF whose hash
//     is the hash of the file that was checked;
//   * exactly one fulfilment, one delivery.
// And a refusal world in the same pass: a design whose file carries an
// invented statistic is refused by the hands, with the reason on the owner's
// own view of the test.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.NODE_ENV = 'test';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);
process.env.CLOUDFLARE_API_TOKEN = 'cfat_test_token';
process.env.CLOUDFLARE_ACCOUNT_ID = 'acct_test';
process.env.FOUNDRY_ENABLE_MONEY_TOOLS = 'true';
process.env.OPENROUTER_API_KEY = 'sk-or-scripted';

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { query } from '../../../src/db/client.js';
import { providerStubs } from '../../helpers/provider-stubs.js';
import { HANDS, OWNER, advanceDays, giveTheWorkshopEars, runMorning, seedProductionShape } from '../../helpers/world.js';
import { stripeSignature } from './campaign-helpers.js';
import { PRINTABLE_CONTENT_HONEST, PRINTABLE_CONTENT_WITH_A_STATISTIC, PRINTABLE_OFFER, fixtureLabel } from '../../fixtures/printable-home-maintenance.js';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 240_000 });
const CHROMIUM = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
].find((p) => existsSync(p));
if (CHROMIUM) process.env.FOUNDRY_CHROMIUM_PATH = CHROMIUM;
const world = CHROMIUM ? describe : describe.skip;

const { state, fetch: fetchStub } = providerStubs();
vi.stubGlobal('fetch', fetchStub);
afterAll(() => { vi.unstubAllGlobals(); });

// ── The scripted model: what a capable model answers to each call ────────────
const HONEST = 'printable_honest';
const STATISTIC = 'printable_statistic';
const contentFor: Record<string, unknown> = {};
const PANEL_ANSWERS = [
  { verdict: 'yes', max_price_dollars: 12, why: 'I would print this once and use it all year; it is cheaper than my time making one.' },
  { verdict: 'yes', max_price_dollars: 10, why: 'Every page is a page I would fill in, nothing is padding.' },
  { verdict: 'maybe', max_price_dollars: 9, why: 'Useful, though I could make a simpler one myself.' },
  { verdict: 'yes', max_price_dollars: 15, why: 'The service record and contacts pages are what I keep losing.' },
];
const modelCalls: string[] = [];
const say = (o: unknown) => ({ content: JSON.stringify(o), tokensUsed: 1, costUsd: 0 });
vi.mock('../../../src/services/ai/client.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  callSonnet: vi.fn(async (system: string, user: string) => {
    if (system.startsWith('You shape the offer')) { modelCalls.push('compose'); return say(PRINTABLE_OFFER); }
    if (system.startsWith('You write the pages of a printable')) {
      modelCalls.push('write');
      const which = Object.keys(contentFor).find((k) => user.includes(k));
      return say(which ? contentFor[which] : PRINTABLE_CONTENT_HONEST);
    }
    if (system.startsWith('You check a printable file')) { modelCalls.push('check'); return say({ invented: [], regulated_advice: false, regulated_why: null }); }
    if (system.startsWith('You are one of the people') || system.startsWith('You are a skeptic')) {
      const n = modelCalls.filter((c) => c === 'persona').length % PANEL_ANSWERS.length;
      modelCalls.push('persona');
      return say(PANEL_ANSWERS[n]);
    }
    modelCalls.push('other');
    return say({ abstain: 'nothing to read' });
  }),
  callOpus: vi.fn(async () => say({ abstain: 'nothing to read' })),
}));

const SECRET = () => String(process.env.STRIPE_WEBHOOK_SECRET);
const buyer = 'reader@homeowner.example';
let app: Hono;
let X = ''; // the honest printable
let R = ''; // the one with an invented statistic
const one = async (sql: string, params: unknown[] = []) => (await query(sql, params)).rows[0] as Record<string, unknown>;
const n = async (sql: string, params: unknown[] = []) => Number((await one(sql, params)).n);

/** A forge design for a printable test, sealed inside the charter, as the forge leaves one. */
async function aSealedPrintableDesign(id: string, opportunity: string, mandateId: string, marker: string): Promise<void> {
  await query(
    `INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
     VALUES (?,?,?,?,'people who look after a house','house upkeep lives in their heads','people asked for a printable log','nobody pays for a log','[]','real')`,
    [opportunity, mandateId, OWNER, `a printable home maintenance log (${marker})`]);
  await query(`INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test) VALUES (?,?,?,?,1,'sell one on the Workshop page')`,
    [`${id}_unk`, OWNER, opportunity, `whether anybody pays for a printable house log (${marker})`]);
  await query(
    `INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode)
     VALUES (?,?,?,?,?,'one pays','nobody pays',1000,'real')`, [id, OWNER, opportunity, `${id}_unk`, `sell a printable house log on the Workshop page (${marker})`]);
  for (const lens of ['market_reality', 'experimental_design', 'commercial_operations', 'risk_ethics_compliance', 'economics_portfolio']) {
    await query(`INSERT INTO probe_lens_findings (id, experiment_id, founder_id, lens, finding, grounds_json, risk, recommends, because, recorded_by) VALUES (?,?,?,?,'f','["x"]','low','run','b','forge')`,
      [`${id}_${lens}`, id, OWNER, lens]);
  }
  const { recordDesign, sealDesign } = await import('../../../src/services/venture/probe-design.js');
  await recordDesign({
    founderId: OWNER, experimentId: id, decides: `whether a stranger pays for a printable house log from the page (${marker})`, decidesBecause: 'only money settles it',
    exchange: 'upfront_price', exchangeBecause: 'one file, sold once', canProve: 'one pays', cannotProve: 'that they used it',
    ratherThanWaiting: 'reading will not settle it', distribution: 'the Workshop\'s own page; nobody is written to', ifItSucceeds: 'a second file',
    recommendation: 'run', recommendationBecause: 'cheap and bounded', designedBy: 'forge',
    interpretations: [{ observation: 'nobody pays', reading: 'not worth it' }, { observation: 'nobody pays', reading: 'nobody found the page' }],
    costs: [{ dimension: 'cash', level: 'low', grounds: 'a payment link' }, { dimension: 'reputation', level: 'low', grounds: 'a page under the Workshop\'s name' }, { dimension: 'participant_burden', level: 'none', grounds: 'nobody is written to' }],
    stopConditions: [{ kind: 'complaints', threshold: 2, because: 'a pattern' }, { kind: 'refunds', threshold: 3, because: 'enough' }],
  });
  await sealDesign(id);
}

beforeAll(async () => {
  if (!CHROMIUM) return;
  await seedProductionShape({ unsettled: true, undecided: true, charter: true });
  state.domains.push({ id: 'dom_w', name: 'apexmicro.ai', status: 'verified', records: [] });
  const { standUpWorkshop } = await import('../../../src/services/public-workshop/infrastructure.js');
  await standUpWorkshop(OWNER, fetchStub as unknown as typeof fetch);
  await giveTheWorkshopEars(OWNER);
  // THE OWNER'S ACTS THIS WORLD ASSUMES, each his own row: offers that still
  // take minutes per sale (PENDING 32) and Foundry making printables (PENDING 38).
  const { supersedeOriginationPolicy } = await import('../../../src/services/venture/legal-surface.js');
  for (const [requirement, treatment, value] of [['front_loaded_attention', 'prefer', null], ['make_printable_pdf', 'policy', 'yes']] as const) {
    const r = await supersedeOriginationPolicy({ founderId: OWNER, requirement, treatment, value, why: `the owner's act this world assumes (${requirement})`, by: `founder:${OWNER}` });
    if ('refused' in r) throw new Error(r.refused);
  }
  const { currentMandate, openMandate } = await import('../../../src/services/venture/mandate.js');
  const m = (await currentMandate(OWNER)) ?? await openMandate({ founderId: OWNER, statement: 'Printable files people keep at home', shape: null, evidenceMode: 'real' });
  if ('refused' in m) throw new Error(m.refused);
  X = 'printable_x';
  R = 'printable_r';
  contentFor[HONEST] = PRINTABLE_CONTENT_HONEST;
  contentFor[STATISTIC] = PRINTABLE_CONTENT_WITH_A_STATISTIC;
  await aSealedPrintableDesign(X, 'printable_opp_x', m.id, HONEST);
  await aSealedPrintableDesign(R, 'printable_opp_r', m.id, STATISTIC);
  app = (await import('../../../src/index.js')).default as unknown as Hono;
});

world('a printable made by the hands reaches a buyer', () => {
  it('the fixture is labelled as one', () => {
    expect(fixtureLabel).toMatch(/^TEST FIXTURE/);
  });

  it('the forge pass makes the file, it passes every gate, and the charter lets it in', async () => {
    const { forgePass } = await import('../../../src/services/venture/forge-deliberation.js');
    const pass = await forgePass(OWNER);
    expect(pass.allowed).toContain(X);
    const { materialOf, deliverableGate } = await import('../../../src/services/venture/hand.js');
    const { printableOf, printablePlanOf } = await import('../../../src/services/venture/products/printable.js');
    const goods = (await materialOf(X, 'deliverable'))!;
    const file = printableOf(goods)!;
    expect(file.version).toBe(1);
    expect(file.pages).toBe(9);
    expect(createHash('sha256').update(Buffer.from(file.pdfBase64, 'base64')).digest('hex')).toBe(file.sha256);
    expect(await deliverableGate(X, goods, new Date())).toEqual({ ok: true, failures: [] });
    const plan = printablePlanOf((await materialOf(X, 'offer_shape'))!.body)!;
    expect(plan).toMatchObject({ version: 1, sha256: file.sha256, held: null });
    expect(plan.panel.outcome).toBe('ship');
    // Every gate that asks a model was asked: the writer, the honesty check, four strangers.
    expect(modelCalls.filter((c) => c === 'persona').length).toBe(4);
    expect(modelCalls).toContain('check');
    expect(String((await one('SELECT decision FROM venture_experiments WHERE id = ?', [X])).decision)).toBe('approved');
  });

  it('the file with an invented statistic is refused by the hands, and the owner sees why', async () => {
    const refusal = await one(`SELECT because FROM forge_refusals WHERE experiment_id = ? AND stage = 'make' ORDER BY refused_at DESC LIMIT 1`, [R]);
    expect(String(refusal.because)).toMatch(/nobody can stand behind: a statistic: ".*43%/);
    const { materialOf } = await import('../../../src/services/venture/hand.js');
    expect(await materialOf(R, 'deliverable')).toBeNull();
    const { getExperimentView } = await import('../../../src/services/founder/experiment-view.js');
    const v = (await getExperimentView(OWNER, R))!;
    expect(v.stateDetail).toMatch(/43%/);
    expect(v.stateDetail).toMatch(/the hands refused to make it/i);
  });

  it('the hand places the payment link and publishes the page, with the version on both', async () => {
    await advanceDays(1);
    const ran = await runMorning(HANDS);
    expect(ran.filter((r) => !r.ok)).toEqual([]);
    const { exposureOf } = await import('../../../src/services/venture/outcome.js');
    expect((await exposureOf(X))?.provider).toBe('stripe');
    expect(state.products.some((p) => p.name === 'Home Maintenance Log (version 1)')).toBe(true);
    const { publicIdentityOf } = await import('../../../src/services/public-workshop/identity.js');
    const id = (await publicIdentityOf(X))!;
    expect(id.copy.what).toMatch(/Version 1/);
    const pages = [...state.cf.kv.values()].flatMap((store) => [...store.values()]);
    const page = pages.find((html) => html.includes('The Home Maintenance Log') && html.includes('Version 1'));
    expect(page, 'the published page carries the file and its version').toBeTruthy();
    expect(page).toContain('$9');
  });

  let fileSha = '';
  it('a buyer pays through the real webhook, replayed three times; one fulfilment', async () => {
    const link = state.paymentLinks.find((l) => l.metadata.experiment_id === X || l.payment_intent_data?.metadata.experiment_id === X)!;
    expect(link).toBeTruthy();
    state.buyers.set('pi_print_1', buyer);
    state.charges.set('ch_print_1', { amount: 900, amount_refunded: 0, metadata: { app: 'foundry', experiment_id: X, primitive: 'sale' } });
    const payload = JSON.stringify({ id: 'evt_print_1', object: 'event', type: 'payment_intent.succeeded', created: Math.floor(Date.now() / 1000), livemode: false,
      data: { object: { id: 'pi_print_1', object: 'payment_intent', amount: 900, amount_received: 900, currency: 'usd', receipt_email: buyer, latest_charge: 'ch_print_1',
        metadata: { ...(link.payment_intent_data?.metadata ?? {}), app: 'foundry', experiment_id: X, payment_link: link.id } } } });
    const post = () => app.request('/webhooks/stripe', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': stripeSignature(payload, SECRET()) }, body: payload });
    expect((await post()).status).toBe(200);
    for (let i = 0; i < 3; i++) expect((await post()).status).toBe(200);
    expect(await n('SELECT COUNT(*) AS n FROM experiment_fulfilments WHERE experiment_id = ?', [X])).toBe(1);
  });

  it('the hand delivers once: an email with a signed link, and the link returns the file that was checked', async () => {
    await runMorning(HANDS);
    await runMorning(HANDS); // a second pass, as the hourly schedule would, sends nothing again
    const toBuyer = state.sends.filter((s) => s.to.includes(buyer));
    expect(toBuyer).toHaveLength(1);
    const mail = toBuyer[0]!;
    expect(mail.subject).toBe('The Home Maintenance Log');
    const href = /\/share\/download\/[^\s)"]+/.exec(mail.text ?? '')?.[0];
    expect(href, 'the delivery carries a download link').toBeTruthy();
    expect(mail.text).toMatch(/\/share\/refund\//);
    const r = await app.request(href!);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/pdf');
    const bytes = Buffer.from(await r.arrayBuffer());
    const { materialOf } = await import('../../../src/services/venture/hand.js');
    const { printableOf, pdfPageCount } = await import('../../../src/services/venture/products/printable.js');
    const file = printableOf(await materialOf(X, 'deliverable'))!;
    fileSha = createHash('sha256').update(bytes).digest('hex');
    expect(fileSha).toBe(file.sha256);
    expect(pdfPageCount(bytes)).toBe(9);
    if (existsSync('/usr/bin/pdfinfo')) {
      const dir = mkdtempSync(join(tmpdir(), 'bought-'));
      writeFileSync(join(dir, 'bought.pdf'), bytes);
      expect(execFileSync('pdfinfo', [join(dir, 'bought.pdf')]).toString()).toMatch(/Pages:\s+9\b/);
    }
    // A link with its expiry moved is not a link.
    const forged = href!.replace(/\/(\d+)\//, (_a, d: string) => `/${String(Number(d) + 1)}/`);
    expect((await app.request(forged)).status).toBe(404);
    // One fulfilment, sent; which file the buyer received is on it.
    const f = await one('SELECT status, delivered_files_json FROM experiment_fulfilments WHERE experiment_id = ?', [X]);
    expect(['sent', 'delivered']).toContain(String(f.status));
    expect(JSON.parse(String(f.delivered_files_json))[0]).toMatchObject({ sha256: file.sha256, version: 1 });
    expect(await n(`SELECT COUNT(*) AS n FROM outbound_actions WHERE experiment_id = ? AND experiment_act = 'delivery'`, [X])).toBe(1);
  });

  it('the page\'s promise stays true: the refund link returns the money, and the file is then not served', async () => {
    const mail = state.sends.find((s) => s.to.includes(buyer))!;
    const refund = /\/share\/refund\/[^\s)"]+/.exec(mail.text ?? '')![0];
    expect((await app.request(refund, { method: 'POST' })).status).toBe(200);
    expect(state.refunds.length).toBe(1);
    const href = /\/share\/download\/[^\s)"]+/.exec(mail.text ?? '')![0];
    await runMorning(HANDS);
    expect((await app.request(href)).status).toBe(404);
    expect(await n('SELECT COUNT(*) AS n FROM experiment_fulfilments WHERE experiment_id = ?', [X])).toBe(1);
  });
});
