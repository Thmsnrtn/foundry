// =============================================================================
// THE DELIBERATION IS RECORDED BEFORE THE ANSWER, OR IT IS NOT EVIDENCE.
//
//   the vocabularies are constitutional → a design cannot arrive sealed, be
//   written after the decision, or be edited once the owner has decided → an
//   unavailable exchange, a kill, a defer and a missing cost each stand in the
//   way of allowing → Proof 1 reconsidered from first principles, and what it
//   admits it cannot tell apart → the short version the owner meets, and the
//   long one behind it → what the world said, and which exchange it said it
//   under → stop conditions stop the sending and not the settling → success
//   past the cap stops new offers → a stranger's answer on the page becomes
//   evidence, a refusal and, next time, silence → all of it goes when he does.
//
// Nobody real is contacted; every provider is stubbed at the network edge.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '3'.repeat(64);
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_testsecret';
process.env.RESEND_API_KEY = 're_test_key';
process.env.CLOUDFLARE_API_TOKEN = 'cfat_test_token';
process.env.CLOUDFLARE_ACCOUNT_ID = 'acct_test';
process.env.FOUNDRY_ENABLE_MONEY_TOOLS = 'true';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'thomas@example.com';
process.env.APP_URL = 'http://localhost:8080';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import '../../src/services/integration/resend.js';
import '../../src/services/integration/stripe-gateway.js';
import '../../src/services/integration/cloudflare-gateway.js';
import { providerStubs } from '../helpers/provider-stubs.js';
import { PROOF1_SLUG, findProof1, reframeProof1UnderTheWorkshop, seedProof1 } from '../../src/services/venture/proof-1.js';
import { reconsiderProof1 } from '../../src/services/venture/proof-1-deliberation.js';
import {
  DesignRefused, designOf, designStandsInTheWay, exchanges, overFulfilmentCap, readStopConditions,
  recordDesign, stopConditionsMet, theShortVersion,
} from '../../src/services/venture/probe-design.js';
import { exchangeOf } from '../../src/services/venture/probe-design-context.js';
import { allowExperiment, approveRemaining, HandRefused, runHand } from '../../src/services/venture/hand.js';
import { establishPublicWorkshop, setPostalAddress } from '../../src/services/public-workshop/settings.js';
import { connectWorkshopSending, standUpWorkshop } from '../../src/services/public-workshop/infrastructure.js';
import { continuationsFor, continuationsOf, isSuppressed, recordContinuation, syncOptOutsFromStore } from '../../src/services/public-workshop/suppression.js';
import { contactFrequencyRefusal } from '../../src/services/public-workshop/suppression.js';
import { exposureOf, recordBusinessOutcome, whatTheWorldSaid } from '../../src/services/venture/outcome.js';
import { whyOf } from '../../src/services/founder/why.js';
import { WORKER_SOURCE } from '../../src/services/public-workshop/worker-source.js';

vi.setConfig({ testTimeout: 180_000 });
const OWNER = 'd_owner'; const FOUNDRY = 'd_foundry';
const NOW = new Date('2026-09-08T00:00:00Z');
const { state, fetch: fetchStub } = providerStubs();
let app: Hono;
let currentFounder: Record<string, unknown> = { id: OWNER, email: 'thomas@example.com', preferences: {} };
let X = '';
const page = async (path: string) => { const r = await app.request(path); return { status: r.status, text: await r.text() }; };
const one = async (sql: string, params: unknown[] = []) => (await query(sql, params)).rows[0] as Record<string, unknown>;
const rowsOf = async (sql: string, params: unknown[] = []) => (await query(sql, params)).rows as unknown as Array<Record<string, unknown>>;

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchStub);
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)`, [OWNER, 'd_clk', 'thomas@example.com', 'Thomas Norton']);
  await query(`INSERT INTO products (id,name,owner_id,status,operating_budget_monthly_usd) VALUES (?,'Foundry',?,'active',50)`, [FOUNDRY, OWNER]);
  await query(`INSERT INTO system_identities (identity_key,product_id,established_reason) VALUES ('foundry',?,'deliberation')`, [FOUNDRY]);
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, currentFounder as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', letterRoutes);
  await seedProof1(OWNER);
  await establishPublicWorkshop({ founderId: OWNER });
  await standUpWorkshop(OWNER);
  X = (await reframeProof1UnderTheWorkshop(OWNER)).successor;
});
afterAll(() => { vi.unstubAllGlobals(); });

describe('the vocabularies are the institution\'s, not a service\'s', () => {
  it('exchanges, cost dimensions, stop kinds and continuation kinds are constitutional; only availability may change', async () => {
    const x = await exchanges();
    expect(x.map((e) => e.exchange)).toEqual(['upfront_price', 'value_first', 'sample_then_paid', 'deposit_then_valuation',
      'subscription', 'usage', 'license', 'free_with_role']);
    // Exactly one is something the institution can actually run today, and it says so.
    expect(x.filter((e) => e.available).map((e) => e.exchange)).toEqual(['upfront_price']);
    for (const e of x) { expect(e.reveals.length).toBeGreaterThan(10); expect(e.confounds.length).toBeGreaterThan(10); }
    await expect(query(`DELETE FROM probe_exchanges WHERE exchange = 'usage'`)).rejects.toThrow();
    await expect(query(`INSERT INTO probe_exchanges (exchange, what_it_is, reveals, confounds, sort_order) VALUES ('barter','a','b','c',99)`)).rejects.toThrow();
    await expect(query(`UPDATE probe_exchanges SET reveals = 'something else' WHERE exchange = 'usage'`)).rejects.toThrow();
    await query(`UPDATE probe_exchanges SET available = 0 WHERE exchange = 'upfront_price'`);
    await query(`UPDATE probe_exchanges SET available = 1 WHERE exchange = 'upfront_price'`);
    await expect(query(`DELETE FROM probe_cost_dimensions WHERE dimension = 'reputation'`)).rejects.toThrow();
    await expect(query(`DELETE FROM continuation_kinds WHERE kind = 'never'`)).rejects.toThrow();
    // The reason the vocabulary is closed: nothing may invent a permission.
    expect((await rowsOf('SELECT kind FROM continuation_kinds WHERE permits_more = 1 ORDER BY sort_order')).map((r) => String(r.kind)))
      .toEqual(['more_like_this', 'only_unusual', 'would_pay_regularly', 'will_explain']);
    // Two commercial observations the world can now make, and did not have words for.
    expect((await rowsOf(`SELECT kind FROM business_outcome_event_kinds WHERE kind IN ('declined_value','continuation_requested')`))).toHaveLength(2);
  });
});

describe('the thinking comes before the decision, and cannot be improved afterwards', () => {
  it('a design cannot arrive sealed, cannot be written twice, and cannot be written for a decided test', async () => {
    await expect(query(`INSERT INTO probe_designs (experiment_id, founder_id, decides, decides_because, exchange, exchange_because,
      can_prove, cannot_prove, rather_than_waiting, distribution, if_it_succeeds, recommendation, recommendation_because, designed_by, sealed_at)
      VALUES (?,?,'a','b','upfront_price','c','d','e','f','g','h','run','i','test',datetime('now'))`, [X, OWNER]))
      .rejects.toThrow(/cannot_arrive_sealed/);
    const declined = await one('SELECT id FROM venture_experiments WHERE founder_id = ? AND decision IS NOT NULL LIMIT 1', [OWNER]);
    await expect(recordDesign({
      founderId: OWNER, experimentId: String(declined.id), decides: 'a', decidesBecause: 'b', exchange: 'upfront_price',
      exchangeBecause: 'c', canProve: 'd', cannotProve: 'e', ratherThanWaiting: 'f', distribution: 'g', ifItSucceeds: 'h',
      recommendation: 'run', recommendationBecause: 'i', designedBy: 'test',
    })).rejects.toThrow(/after_the_decision/);
  });

  it('nothing may be allowed without a deliberation; the refusal names what is missing', async () => {
    expect(await designStandsInTheWay(X)).toEqual(['no deliberation is recorded for this test; the thinking comes before the decision']);
    await approveRemaining({ founderId: OWNER, experimentId: X });
    await expect(allowExperiment({ founderId: OWNER, experimentId: X, by: 'owner' }))
      .rejects.toThrow(HandRefused);
    await expect(allowExperiment({ founderId: OWNER, experimentId: X, by: 'owner' }))
      .rejects.toThrow(/the thinking comes before the decision/);
  });
});

describe('Proof 1, reconsidered from first principles before anyone is written to', () => {
  it('names the uncertainty, the exchange it chose and the ones it refused, what it cannot prove, and what it cannot tell apart', async () => {
    const { design: d, alreadyRecorded } = await reconsiderProof1(OWNER);
    expect(alreadyRecorded).toBe(false);
    expect((await reconsiderProof1(OWNER)).alreadyRecorded).toBe(true);

    // The uncertainty is about the labour, not the data, and says why desk research cannot settle it.
    expect(d.decides).toContain('screening labour');
    expect(d.decides).toContain('not access to the bid data');
    expect(d.decidesBecause).toContain('COMMBUYS is open to anybody and costs nothing');

    // Pay-after-value was weighed on its merits and refused with a reason, not skipped.
    const weighed = d.alternatives.map((a) => a.exchange);
    expect(weighed).toContain('value_first');
    expect(weighed).toContain('subscription');
    expect(weighed).not.toContain(d.exchange.exchange);
    expect(d.alternatives.find((a) => a.exchange === 'value_first')!.notChosenBecause).toContain('almost nobody pays a stranger for something already in hand');
    expect(d.alternatives.find((a) => a.exchange === 'free_with_role')!.notChosenBecause).toContain('distrusts most');
    await expect(query(`INSERT INTO probe_alternatives (id, experiment_id, founder_id, exchange, not_chosen_because) VALUES ('pa1',?,?,'upfront_price','x')`, [X, OWNER]))
      .rejects.toThrow(/probe_alternative:is_the_chosen_one/);

    // What it can and cannot prove are different sentences, and the second is the honest one.
    expect(d.canProve).toContain('at least one Massachusetts millwork shop');
    expect(d.cannotProve).toContain('cannot establish a market');
    expect(d.cannotProve).toContain('a buyer from a well-wisher');

    // TWO READINGS OF THE SAME NULL RESULT THAT THIS PROBE CANNOT SEPARATE.
    const blind = d.interpretations.filter((i) => i.distinguishedBy === null);
    expect(blind.map((i) => i.reading)).toEqual(expect.arrayContaining([
      expect.stringContaining('not worth $29'),
      expect.stringContaining('not a thing these shops transact through'),
    ]));
    // And one it can separate, because the page now asks.
    expect(d.interpretations.find((i) => i.distinguishedBy?.includes('continuation answer'))).toBeDefined();

    // The true cost is stated across every dimension it spends, and the cheap ones say why they are cheap.
    const cost = Object.fromEntries(d.costs.map((c) => [c.dimension, c.level]));
    expect(cost).toMatchObject({ cash: 'low', owner_attention: 'material', reputation: 'material', infrastructure: 'none', opportunity_cost: 'material' });
    expect(d.costs.find((c) => c.dimension === 'infrastructure')!.grounds).toContain('shared by every experiment after this one');
    expect(d.costs.find((c) => c.dimension === 'opportunity_cost')!.grounds).toContain('ugliest distribution');
    expect(d.distribution).toContain('dirtiest distribution this institution recognises');

    // Success is answered with a ceiling, and expansion with a refusal to widen.
    expect(d.fulfilmentCap).toBe(10);
    expect(d.ifItSucceeds).toContain('Nothing widens');
    expect(d.ifItSucceeds).toContain('a new probe with its own rights question');
    expect(d.ifItSucceeds).toContain('not a larger version of something that has worked once');

    // Every stop condition is reached long before the $100 ceiling is.
    expect(d.stopConditions.map((s) => `${s.kind}:${s.threshold}`))
      .toEqual(['complaints:1', 'bounces:3', 'opt_outs:2', 'declined_value:3', 'unfulfillable:1']);
    expect(d.recommendation).toBe('run');
    expect(d.sealedAt).toBeNull();
    expect(await designStandsInTheWay(X)).toEqual([]);
  });

  it('the owner meets a short version, and the long one is one link away', async () => {
    const short = (await theShortVersion(X))!;
    expect(short.headline).toBe('I think this is worth running.');
    expect(short.sealed).toBe(false);
    expect(short.lines.length).toBeLessThanOrEqual(7);
    // The pair it cannot separate, not one of them quoted as if it were a finding.
    expect(short.lines.join(' ')).toContain('I cannot tell “the screening work is not worth $29 to shops of this size” from “a cold email from an unknown sender is not a thing these shops transact through');
    expect(short.lines[0]).toContain('It settles: Whether the screening labour');
    expect(short.lines.join(' ')).toContain('What it really costs you');
    expect(short.lines.join(' ')).toContain('It stops itself at 1 complaint, 3 messages that did not arrive, 2 people asking not to be contacted, 3 people saying it was not useful, or 1 purchase that could not be delivered.');
    // The summary is a summary: the first sentence of a stored reason, never a paraphrase.
    expect(short.lines.join(' ')).toContain('because money moved before delivery is the only observation in which a stranger\'s action is unambiguous.');
    expect(short.lines.join(' ')).not.toContain('That is why the identity work came first');
    expect(short.lines.join(' ')).toContain('I stop taking new work at 10');
    // On his page, above everything, with the record behind it.
    const shown = await page(`/foundry/experiments/${X}`);
    expect(shown.text).toContain('I think this is worth running.');
    expect(shown.text).toContain('It seals when you decide.');
    expect(shown.text).toContain(`/foundry/why/experiment/${X}`);
  });

  it('"Show your work" is no longer a reconstruction: it reads the trace written before the answer', async () => {
    const why = (await whyOf(OWNER, 'experiment', X))!;
    // The slot the code itself said was empty because nothing wrote it.
    expect(why.otherRecordedPaths.length).toBeGreaterThan(5);
    expect(why.otherRecordedPaths.join(' ')).toContain('Not chosen — the thing is delivered first');
    expect(why.uncertainty.join(' ')).toContain('I could not tell apart, from this test alone');
    expect(why.uncertainty.join(' ')).toContain('What it cannot prove');
    expect(why.cost.join(' ')).toContain('reputation');
    expect(why.authority.join(' ')).toContain('not yet sealed');
    expect(why.authority.join(' ')).toContain('Stops at 1');
    expect(why.because.join(' ')).toContain('What it decides');
    expect(why.technical.some(([k, v]) => k === 'probe_designs.exchange' && v === 'upfront_price')).toBe(true);
  });

  it('the deliberation seals when he decides, and refuses every later improvement', async () => {
    state.nextDomainStatus = 'verified';
    await connectWorkshopSending(OWNER);
    await setPostalAddress(OWNER, 'PO Box 123, Example, MA 01000');
    await allowExperiment({ founderId: OWNER, experimentId: X, by: 'owner' });
    const d = (await designOf(X))!;
    expect(d.sealedAt).not.toBeNull();
    await expect(query(`UPDATE probe_designs SET recommendation_because = 'and I always said so' WHERE experiment_id = ?`, [X]))
      .rejects.toThrow(/is_sealed/);
    await expect(query(`INSERT INTO probe_interpretations (id, experiment_id, founder_id, observation, reading) VALUES ('pi_late',?,?,'o','r')`, [X, OWNER]))
      .rejects.toThrow(/is_sealed/);
    expect((await theShortVersion(X))!.sealed).toBe(true);
    expect((await page(`/foundry/experiments/${X}`)).text).toContain('cannot be edited to match the result');
  });
});

describe('the world answers, and the answer carries the exchange it was given under', () => {
  it('every commercial observation records which exchange produced it', async () => {
    await runHand({ now: NOW, offersPerTick: 2 });
    expect(await exchangeOf(X)).toBe('upfront_price');
    const x = (await exposureOf(X))!;
    await recordBusinessOutcome({ exposureId: x.id, kind: 'checkout_started', observedAt: NOW, provider: 'stripe', providerRef: 'cs_d1', exchange: await exchangeOf(X) });
    expect((await one(`SELECT exchange FROM business_outcome_events WHERE provider_event_ref = 'cs_d1'`)).exchange).toBe('upfront_price');
    expect((await whatTheWorldSaid(x.id)).every((e) => e.exchange === 'upfront_price')).toBe(true);
    // An exchange the institution has no word for is not an exchange.
    await expect(query(`INSERT INTO business_outcome_events (id, founder_id, exposure_id, kind, observed_at, provider, provider_event_ref, evidence_mode, exchange) VALUES ('boe_bad',?,?,'checkout_started',datetime('now'),'stripe','cs_bad','real','haggling')`, [OWNER, x.id]))
      .rejects.toThrow();
  });
});

describe('it stops itself before the budget stops it, and success is not a reason to promise more', () => {
  it('more owed than the institution said it could carry stops new offers, and says so in the owner\'s words', async () => {
    expect(await overFulfilmentCap(X)).toEqual({ over: false });
    const xId = (await exposureOf(X))!.id;
    for (let i = 0; i < 10; i += 1) {
      const ev = `boe_cap_${i}`;
      await query(`INSERT INTO business_outcome_events (id, founder_id, exposure_id, kind, amount_cents, currency, observed_at, provider, provider_event_ref, evidence_mode, exchange) VALUES (?,?,?,'payment',2900,'usd',datetime('now'),'stripe',?,'real','upfront_price')`, [ev, OWNER, xId, `pi_cap_${i}`]);
      await query(`INSERT INTO experiment_fulfilments (id, founder_id, experiment_id, exposure_id, payment_event_id, provider, payment_ref, amount_cents, currency, status) VALUES (?,?,?,?,?,'stripe',?,2900,'usd','owed')`,
        [`ef_cap_${i}`, OWNER, X, xId, ev, `pi_cap_${i}`]);
    }
    expect(await overFulfilmentCap(X)).toMatchObject({ over: true, owed: 10, cap: 10 });
    const report = await runHand({ now: NOW, offersPerTick: 5 });
    expect(report[0]!.offersSent).toBe(0);
    expect(report[0]!.exceptions.join(' ')).toContain('10 purchases owed against a cap of 10');
    // Owed is not unfulfillable: ten sales waiting for the next pass are the
    // system working, and the stop condition that means "could not deliver"
    // stays quiet.
    expect((await readStopConditions(X)).find((c) => c.kind === 'unfulfillable')!.met).toBe(false);
    await query(`DELETE FROM experiment_fulfilments WHERE id LIKE 'ef_cap_%'`);
    await query(`DELETE FROM business_outcome_events WHERE id LIKE 'boe_cap_%'`);
  });
});

  it('a stop condition ends new offers and leaves what is owed untouched', async () => {
    const before = (await readStopConditions(X)).find((s) => s.kind === 'opt_outs')!;
    expect(before).toMatchObject({ count: 0, threshold: 2, met: false });
    const { suppress } = await import('../../src/services/public-workshop/suppression.js');
    await suppress({ founderId: OWNER, email: 'a@example.com', reason: 'they_asked', source: 'page_opt_out', experimentId: X });
    await suppress({ founderId: OWNER, email: 'b@example.com', reason: 'they_asked', source: 'page_opt_out', experimentId: X });
    const met = await stopConditionsMet(X);
    expect(met.stop).toBe(true);
    expect(met.because.join(' ')).toContain('2 of 2');
    // Triggered once, and recorded where the owner can read it.
    await stopConditionsMet(X);
    const triggered = await rowsOf(`SELECT kind, triggered_detail FROM probe_stop_conditions WHERE experiment_id = ? AND triggered_at IS NOT NULL`, [X]);
    expect(triggered).toHaveLength(1);
    expect(String(triggered[0]!.triggered_detail)).toContain('2 of 2');
    const sentBefore = Number((await one(`SELECT COUNT(*) n FROM outbound_actions WHERE experiment_id = ? AND experiment_act = 'offer'`, [X])).n);
    const report = await runHand({ now: NOW, offersPerTick: 5 });
    expect(report[0]!.offersSent).toBe(0);
    expect(report[0]!.exceptions.join(' ')).toContain('Two people asking not to be written to');
    expect(Number((await one(`SELECT COUNT(*) n FROM outbound_actions WHERE experiment_id = ? AND experiment_act = 'offer'`, [X])).n)).toBe(sentBefore);
    // Left standing: a stop condition the world has met is not un-met by tidying up.
  });
describe('a stranger says what they want next, and the Workshop keeps the answer and obeys it', () => {
  it('the public page asks, the Worker accepts only the six answers, and nothing tracks whether it was read', async () => {
    const { renderSite } = await import('../../src/services/public-workshop/site.js');
    const { projectRegistry, workshopFacts } = await import('../../src/services/public-workshop/projection.js');
    const { publicWorkshopOf } = await import('../../src/services/public-workshop/settings.js');
    const site = renderSite(workshopFacts((await publicWorkshopOf(OWNER))!), await projectRegistry(OWNER));
    const experiment = site.get(`/experiments/${PROOF1_SLUG}`)!;
    expect(experiment).toContain('What would you like next?');
    expect(experiment).toContain('No tracking of any kind is used to tell whether you read this.');
    expect(site.has('/thank-you')).toBe(true);
    expect(WORKER_SOURCE).toContain('/continue');
    for (const k of ['never', 'nothing', 'more_like_this', 'only_unusual', 'would_pay_regularly', 'will_explain']) {
      expect(WORKER_SOURCE).toContain(k);
    }
  });

  it('an answer becomes evidence under the exchange it was given, and "nothing further" is a commercial observation', async () => {
    const x = (await exposureOf(X))!;
    const store = state.cf.kv.get(state.cf.namespaces[0]!.id)!;
    store.set('continue:k1', JSON.stringify({ email: 'shop@example.com', wants: 'more_like_this', said: 'the bid numbers saved me a morning', slug: PROOF1_SLUG }));
    store.set('continue:k2', JSON.stringify({ email: 'other@example.com', wants: 'nothing', slug: PROOF1_SLUG }));
    const synced = await syncOptOutsFromStore(OWNER);
    expect(synced.continuations).toBe(2);
    expect(store.has('continue:k1')).toBe(false);
    const evidence = await rowsOf(`SELECT provider_event_ref, kind, exchange, arrived_via FROM business_outcome_events WHERE exposure_id = ? AND provider_event_ref LIKE 'continue:%' ORDER BY provider_event_ref`, [x.id]);
    expect(evidence).toHaveLength(2);
    expect(evidence[0]).toMatchObject({ provider_event_ref: 'continue:k1', kind: 'continuation_requested', exchange: 'upfront_price', arrived_via: 'experiment_page' });
    expect(evidence[1]).toMatchObject({ provider_event_ref: 'continue:k2', kind: 'declined_value', exchange: 'upfront_price' });
    // Their words are kept as theirs, never folded into the kind.
    expect((await continuationsOf(OWNER, 'shop@example.com'))[0]).toMatchObject({ wants: 'more_like_this', permitsMore: true, said: 'the bid numbers saved me a morning' });
    expect((await continuationsFor(OWNER)).map((c) => c.email)).toEqual(expect.arrayContaining(['shop@example.com', 'other@example.com']));
    // And the owner reads them where the Workshop's other lists are.
    const shown = await page('/foundry/public-workshop');
    expect(shown.text).toContain('What people asked for');
    expect(shown.text).toContain('the bid numbers saved me a morning');
    expect(shown.text).toContain('more like this');
    // "Nothing further" is not a complaint and is not on the do-not-contact list —
    // but a later experiment writing to them anyway would be keeping the answer and ignoring it.
    expect((await isSuppressed(OWNER, 'other@example.com')).suppressed).toBe(false);
    expect(await contactFrequencyRefusal({ founderId: OWNER, email: 'other@example.com', experimentId: 'some_other_experiment' }))
      .toContain('they answered "nothing"');
    expect(await contactFrequencyRefusal({ founderId: OWNER, email: 'shop@example.com', experimentId: 'some_other_experiment' })).toBeNull();
  });

  it('"never" is a no to the whole Workshop, recorded once and enforced everywhere', async () => {
    await recordContinuation({ founderId: OWNER, email: 'gone@example.com', experimentId: X, wants: 'never', said: 'please stop' });
    expect((await isSuppressed(OWNER, 'gone@example.com')).suppressed).toBe(true);
    expect((await recordContinuation({ founderId: OWNER, email: 'gone@example.com', experimentId: X, wants: 'never' })).recorded).toBe(false);
    expect((await recordContinuation({ founderId: OWNER, email: 'not-an-address', wants: 'never' })).recorded).toBe(false);
    await expect(query(`INSERT INTO workshop_continuations (id, founder_id, email, wants) VALUES ('wc_x',?,'z@example.com','maybe_later')`, [OWNER]))
      .rejects.toThrow();
    await expect(query(`UPDATE workshop_continuations SET wants = 'more_like_this' WHERE email = 'gone@example.com'`))
      .rejects.toThrow(/append_only/);
  });
});

describe('the deliberation is his, and goes when he does', () => {
  it('erasing the owner removes every row of it, and the erasure knows about all six tables', async () => {
    const { FOUNDER_SCOPED_REASONS } = await import('../../src/services/privacy/consent.js');
    for (const t of ['probe_designs', 'probe_interpretations', 'probe_alternatives', 'probe_costs', 'probe_stop_conditions', 'workshop_continuations']) {
      expect(FOUNDER_SCOPED_REASONS[t]).toBeTruthy();
    }
    // Append-only does not mean a person's data outlives their right to have it removed.
    await expect(query(`DELETE FROM workshop_continuations WHERE founder_id = ?`, [OWNER])).rejects.toThrow(/append_only/);
    await query(`UPDATE products SET erasure_scheduled_at = datetime('now') WHERE owner_id = ?`, [OWNER]);
    await query(`DELETE FROM workshop_continuations WHERE founder_id = ?`, [OWNER]);
    expect(await rowsOf('SELECT id FROM workshop_continuations WHERE founder_id = ?', [OWNER])).toHaveLength(0);
    await query(`UPDATE products SET erasure_scheduled_at = NULL WHERE owner_id = ?`, [OWNER]);
  });
});

void DesignRefused;
