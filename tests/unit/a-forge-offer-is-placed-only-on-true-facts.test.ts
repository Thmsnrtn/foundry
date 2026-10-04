// =============================================================================
// LAW (Roadmap 2027 R23): A FORGE-MADE OFFER IS PLACED ONLY THROUGH THE OWNER'S
// OWN DECISION AND TRUE FACTS, AND NOTHING IS CARVED OR MINTED THAT PLACEMENT
// WOULD REFUSE.
//
// Every offer the forge makes says, truthfully, that it is not yet attention
// spent once: a refund is the owner's while the money switch is off, a buyer's
// email is theirs while correspondence is off. The first-proof policy requires
// it, so placement refused — but only at placeExposure, after the test had
// been decided, a charter slot carved and a live payment link minted. Three
// such tests filled the charter and launched nothing.
//
// Now the refusal comes first, through the one reading the final gate uses.
// The fact is never written true by code; only the owner, from their own
// session, may make the requirement a preference, and the database refuses a
// founder row set by any other principal. The choice reaches every future
// offer, so Control shows it again when the conditions it was made under
// change. A weekly brief is refused until a week after the first can be made.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'f'.repeat(64);
process.env.FOUNDRY_OWNER_EMAIL = 'fla@example.com';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_testsecret';

import { readFileSync } from 'fs';
import { globSync } from 'glob';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { providerStubs } from '../helpers/provider-stubs.js';
import { legalPictureOf, originationPolicyFor, policyVerdictsFor, supersedeOriginationPolicy, structuralFactsOf } from '../../src/services/venture/legal-surface.js';
import { frontLoadedAttentionChoice, yourDecisions } from '../../src/services/control/decisions.js';
import { briefFacts, subscriptionFacts } from '../../src/services/venture/products/offer-composition.js';

const OWNER = 'fla_owner';
const X = 'fla_x';
let ASSET = 'fla_asset';
const { state, fetch: fetchStub } = providerStubs();
let app: Hono;
let currentFounder: Record<string, unknown> = { id: OWNER, email: 'fla@example.com' };
const tap = (allow: 'yes' | 'no') => app.request('https://f.test/foundry/controls/front-loaded-attention', {
  method: 'POST', body: new URLSearchParams({ allow }), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
const attentionRow = async () => (await originationPolicyFor(OWNER)).find((p) => p.requirement === 'front_loaded_attention')!;

const PLAN = {
  shape: { sells: 'a brief', claimsMade: 'a shortlist', collects: 'an email', deliversBy: 'email', sellsTo: 'anyone who finds the page', chargesHow: 'one-time, $19' },
  lighter: 'nothing lighter settles it', venue: 'workshop', kind: 'data_brief',
  facts: briefFacts(), price: { amountCents: 1900, currency: 'usd' }, offerSubject: 'A brief',
};

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchStub);
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'fla_clk', 'fla@example.com', 'Owner']);
  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const m = await openMandate({ founderId: OWNER, statement: 'Small things for trades businesses', shape: null, evidenceMode: 'real' });
  if ('refused' in m) throw new Error(m.refused);
  await query(
    `INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode, lighter_architecture)
     VALUES ('fla_opp',?,?,'a brief','contractors','by hand','said so','one firm','[]','real','nothing lighter settles it')`, [m.id, OWNER]);
  await query(
    `INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test)
     VALUES ('fla_unk',?,'fla_opp','whether anyone pays',1,'offer one')`, [OWNER]);
  await query(
    `INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode)
     VALUES (?,?,'fla_opp','fla_unk','offer one on the page','one pays','nobody pays',1000,'real')`, [X, OWNER]);
  // A test let in before R23: decided, its asset made, its facts stated as the
  // hand states them — and never placed, because placement refuses.
  const { decideExperiment } = await import('../../src/services/venture/validation.js');
  await decideExperiment({ experimentId: X, decision: 'approved', by: `founder:${OWNER}`, via: 'a test let in before R23' });
  const made = (await query('SELECT id FROM products WHERE from_experiment_id = ?', [X])).rows[0];
  if (made) ASSET = String(made.id);
  else await query(`INSERT INTO products (id, name, owner_id, status, reality, standing, from_experiment_id, from_opportunity_id) VALUES (?,'A brief',?,'active','real','experimental',?,'fla_opp')`, [ASSET, OWNER, X]);
  const { recordMaterial } = await import('../../src/services/venture/hand.js');
  await recordMaterial({ founderId: OWNER, experimentId: X, kind: 'offer_shape', title: 'shape', body: JSON.stringify(PLAN), by: 'test' });
  await recordMaterial({ founderId: OWNER, experimentId: X, kind: 'offer_template', title: 'A brief', body: 'Pay here: {{link}}', by: 'test' });
  await query(`INSERT INTO offer_shapes (id, founder_id, product_id, sells, claims_made, collects, delivers_by, sells_to, charges_how, stated_by)
    VALUES ('fla_shape',?,?,'a brief','a shortlist','an email','email','anyone','one-time','test')`, [OWNER, ASSET]).catch(() => undefined);
  for (const [fact, f] of Object.entries(briefFacts())) {
    await query(`INSERT INTO structural_facts (id, founder_id, subject_kind, subject_id, fact, present, basis, grounds, enforced_by, recognised_by, evidence_mode)
      VALUES (?,?,'company',?,?,?,?,?,?,'test','real')`, [`fla_${fact}`, OWNER, ASSET, fact, f.present, f.basis ?? 'assumed', f.grounds, f.enforcedBy ?? null]);
  }
  const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, currentFounder as never); await next(); });
  app.route('/', foundryShellRoutes);
});
afterAll(() => { vi.unstubAllGlobals(); });

describe('one reading of the policy', () => {
  const require = [{ requirement: 'front_loaded_attention', treatment: 'require', why: 'once at birth', setBy: 'proof_program' }];
  const prefer = [{ ...require[0]!, treatment: 'prefer', setBy: `founder:${OWNER}` }];
  const fact = (present: boolean | null, basis = 'assumed') => [{ present, basis, grounds: 'g', answersRequirement: 'front_loaded_attention', satisfiedWhen: 1 }];

  it('a required fact that is false blocks; the same fact under the owner\'s "prefer" is still read as violated, and blocks nothing', () => {
    expect(policyVerdictsFor({ policy: require, facts: fact(false), shaped: true }).inTheWay).toHaveLength(1);
    const p = policyVerdictsFor({ policy: prefer, facts: fact(false), shaped: true });
    expect(p.inTheWay).toEqual([]);
    expect(p.verdicts[0]).toMatchObject({ verdict: 'violated', treatment: 'prefer' });
  });

  it('a required fact met only by an assumption blocks once shaped; an unknown one blocks once shaped and not before', () => {
    expect(policyVerdictsFor({ policy: require, facts: fact(true), shaped: true }).inTheWay[0]).toMatch(/assumed rather than checked/);
    expect(policyVerdictsFor({ policy: require, facts: fact(true, 'observed'), shaped: true }).inTheWay).toEqual([]);
    expect(policyVerdictsFor({ policy: require, facts: fact(null), shaped: true }).inTheWay[0]).toMatch(/still unknown/);
    expect(policyVerdictsFor({ policy: require, facts: fact(null), shaped: false }).inTheWay).toEqual([]);
  });

  it('the asset\'s legal picture gives exactly the verdicts the pure reading gives for its facts', async () => {
    const picture = await legalPictureOf({ founderId: OWNER, opportunityId: ASSET, world: 'real', subjectKind: 'company' });
    const facts = await structuralFactsOf('company', ASSET);
    const pure = policyVerdictsFor({ policy: await originationPolicyFor(OWNER), facts, shaped: true });
    expect(picture.policy).toEqual(pure.verdicts);
    for (const s of pure.inTheWay) expect(picture.inTheWay).toContain(s);
  });
});

describe('by default nothing that placement would refuse is decided, carved or minted', () => {
  it('readiness names the refusal in placement\'s own words', async () => {
    const { readiness } = await import('../../src/services/venture/hand.js');
    const r = await readiness(X);
    expect(r.ok).toBe(false);
    expect(r.missing.some((m) => m.startsWith('placing it would be refused: the first-proof policy requires front loaded attention'))).toBe(true);
  });

  it('a test let in before this, still unplaced, is refused before any payment link is found or made', async () => {
    const { ensureExposure, prepareExposure } = await import('../../src/services/venture/hand.js');
    const callsBefore = state.calls.length;
    const r = await ensureExposure(X);
    expect('refused' in r ? r.refused : '').toMatch(/legal picture stands in the way: .*front loaded attention/);
    const p = await prepareExposure(X);
    expect('refused' in p ? p.refused : '').toMatch(/front loaded attention/);
    expect(state.paymentLinks).toEqual([]);
    expect(state.calls.slice(callsBefore).filter((c) => /payment_links|\/v1\/prices|\/v1\/products/.test(c))).toEqual([]);
    expect((await query('SELECT COUNT(*) AS n FROM experiment_exposures WHERE experiment_id = ?', [X])).rows[0]!.n).toBe(0);
  });

  it('a weekly brief is refused until a week after the first can be made, whatever else is allowed', async () => {
    const { recurringCannotBeMade } = await import('../../src/services/venture/hand.js');
    const weekly = { ...PLAN, facts: subscriptionFacts(), price: { amountCents: 500, currency: 'usd', recurring: { interval: 'week' } } };
    expect(await recurringCannotBeMade(X, weekly as never)).toMatch(/a week after the first cannot be made yet/);
    expect(await recurringCannotBeMade(X, PLAN as never)).toBeNull();
  });
});

describe('nothing writes the fact true, and nobody but the owner lifts the requirement', () => {
  it('the forge\'s offers say the fact is false and assumed, with grounds that name the minutes left', () => {
    for (const facts of [briefFacts(), subscriptionFacts()]) {
      expect(facts.front_loaded_attention).toMatchObject({ present: 0, basis: 'assumed' });
      expect(facts.front_loaded_attention!.grounds).toMatch(/refund/);
      expect(facts.front_loaded_attention!.grounds).toMatch(/buyer email/);
    }
    expect(briefFacts().cross_border_selling!.grounds).not.toMatch(/written to once/);
  });

  it('no code the forge runs writes it present or checked; only the two hand-carried proofs say so of themselves', () => {
    const claimsIt = globSync('src/**/*.ts', { nodir: true }).filter((f) =>
      /front_loaded_attention:\s*\{\s*present:\s*1/.test(readFileSync(f, 'utf8')));
    expect(claimsIt.sort()).toEqual(['src/services/venture/proof-1.ts', 'src/services/venture/proof-2.ts']);
    const writers = globSync('src/**/*.ts', { nodir: true }).filter((f) =>
      /UPDATE structural_facts SET present/.test(readFileSync(f, 'utf8')));
    expect(writers).toEqual([]);
  });

  it('the database refuses an owner\'s row written by any other principal, and the service passes that on', async () => {
    await expect(query(`INSERT INTO origination_policy (id, founder_id, requirement, treatment, why, set_by) VALUES ('fla_forged', ?, 'front_loaded_attention', 'prefer', 'the forge thinks so', 'charter:c1')`, [OWNER]))
      .rejects.toThrow(/origination_policy:founder_row_is_the_owners/);
    const r = await supersedeOriginationPolicy({ founderId: OWNER, requirement: 'front_loaded_attention', treatment: 'prefer', why: 'the forge thinks so', by: 'institution:forge' });
    expect('refused' in r ? r.refused : '').toMatch(/founder_row_is_the_owners/);
    expect((await attentionRow()).ownersOwn).toBe(false);
  });

  it('the route, without the owner\'s session, writes nothing', async () => {
    currentFounder = { id: OWNER, email: 'someone-else@example.com' };
    expect((await tap('yes')).status).toBe(403);
    currentFounder = { id: OWNER, email: 'fla@example.com' };
    expect((await attentionRow()).treatment).toBe('require');
    const d = (await yourDecisions(OWNER, {})).find((x) => x.key === 'front_loaded_attention')!;
    expect(d.state).toBe('open');
    expect(d.unblocks).toMatch(/every future offer of any kind/);
    expect(d.seen).toMatch(/every refund and cancellation is yours/);
  });
});

describe('the owner allows it, from their own session', () => {
  it('writes "prefer" as their act, with the conditions it was decided under; the fact is untouched', async () => {
    const r = await tap('yes');
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toMatch(/attention=allowed/);
    const row = await attentionRow();
    expect(row).toMatchObject({ treatment: 'prefer', setBy: `founder:${OWNER}`, ownersOwn: true });
    expect(row.why).toMatch(/\[decided when the money switch was off and correspondence was off\]/);
    const live = (await structuralFactsOf('company', ASSET)).find((f) => f.fact === 'front_loaded_attention')!;
    expect(live).toMatchObject({ present: false, basis: 'assumed' });
    const picture = await legalPictureOf({ founderId: OWNER, opportunityId: ASSET, world: 'real', subjectKind: 'company' });
    expect(picture.policy.find((p) => p.requirement === 'front_loaded_attention')).toMatchObject({ verdict: 'violated', treatment: 'prefer' });
    expect(picture.inTheWay.join(' ')).not.toMatch(/front loaded attention/);
    const { readiness } = await import('../../src/services/venture/hand.js');
    expect((await readiness(X)).missing.some((m) => m.startsWith('placing it would be refused'))).toBe(false);
    expect((await yourDecisions(OWNER, {})).find((x) => x.key === 'front_loaded_attention')!.state).toBe('done');
  });

  it('is shown again when the money switch or correspondence differs from when it was decided', async () => {
    const changed = await frontLoadedAttentionChoice(OWNER, { FOUNDRY_ENABLE_MONEY_TOOLS: 'true' });
    expect(changed).toMatchObject({ decided: true, allowed: true, conditionsChanged: true });
    const d = (await yourDecisions(OWNER, { FOUNDRY_ENABLE_MONEY_TOOLS: 'true' })).find((x) => x.key === 'front_loaded_attention')!;
    expect(d.state).toBe('open');
    expect(d.seen).toMatch(/they differ now/);
    expect(d.seen).toMatch(/refunds and cancellations are Foundry's/);
  });

  it('"refuse them again" restores the refusal, and every earlier row stays on record', async () => {
    expect((await tap('no')).headers.get('location')).toMatch(/attention=required_again/);
    expect((await attentionRow()).treatment).toBe('require');
    const { readiness } = await import('../../src/services/venture/hand.js');
    expect((await readiness(X)).missing.some((m) => m.startsWith('placing it would be refused'))).toBe(true);
    const all = (await query(`SELECT treatment, set_by, superseded_at FROM origination_policy WHERE requirement = 'front_loaded_attention' ORDER BY set_at, rowid`, [])).rows;
    expect(all.map((r) => String(r.treatment))).toEqual(['require', 'prefer', 'require']);
    expect(all.filter((r) => r.superseded_at === null)).toHaveLength(2); // the default and his current row
  });
});

describe('only what may be sold is sold, and nobody\'s words are republished', () => {
  it('a paid brief may not be made from the jobs board, the app store or reviews, each refused with its reason', async () => {
    const { sourcesRefusedForSale, makeBrief, PAID_BRIEF_SOURCES } = await import('../../src/services/venture/products/registry.js');
    expect([...PAID_BRIEF_SOURCES]).toEqual(['community', 'directory']);
    expect(sourcesRefusedForSale(['community', 'directory'])).toEqual([]);
    const refused = sourcesRefusedForSale(['job_posting', 'app_store', 'review']);
    expect(refused).toHaveLength(3);
    expect(refused.join(' ')).toMatch(/terms do not allow/);
    const r = await makeBrief({ founderId: OWNER, experimentId: X, plan: PLAN as never,
      spec: { kind: 'data_brief', title: 't', terms: 'x', sourceTypes: ['job_posting'], coverage: 'c', limit: 5 } });
    expect('refused' in r ? r.refused : '').toMatch(/may not be made from job posting/);
  });

  it('a brief made before this from a refused source is held back by readiness, not sold', async () => {
    const { recordMaterial, readiness } = await import('../../src/services/venture/hand.js');
    await recordMaterial({ founderId: OWNER, experimentId: X, kind: 'offer_shape', title: 'shape',
      body: JSON.stringify({ ...PLAN, spec: { kind: 'data_brief', title: 't', terms: 'x', sourceTypes: ['job_posting', 'community'], coverage: 'c', limit: 5 } }), by: 'test' });
    expect((await readiness(X)).missing.some((m) => /^it may not be sold: job posting/.test(m))).toBe(true);
    await recordMaterial({ founderId: OWNER, experimentId: X, kind: 'offer_shape', title: 'shape', body: JSON.stringify(PLAN), by: 'test' });
  });

  it('a discussion or a review is named by where it is and linked, never quoted or titled in the stranger\'s words', async () => {
    const { renderBrief, neutralLabel } = await import('../../src/services/venture/products/registry.js');
    const said = 'We track every contractor bid in a spreadsheet by hand and it costs us a day a week';
    const items = [
      { id: 'i1', label: said, url: 'https://news.ycombinator.com/item?id=1', datedAt: '2026-09-01', said, sourceType: 'community', source: 's' },
      { id: 'i2', label: 'Terrible app, lost my bids', url: 'https://apps.apple.com/us/app/x/id1', datedAt: '2026-09-02', said: 'Terrible app, lost my bids', sourceType: 'review', source: 's' },
      { id: 'i3', label: 'northline/bid-tracker', url: 'https://github.com/northline/bid-tracker', datedAt: '2026-09-03', said: 'A bid tracker', sourceType: 'directory', source: 's' },
    ];
    const body = renderBrief({ kind: 'data_brief', title: 't', terms: 'x', sourceTypes: ['community', 'directory'], coverage: 'c', limit: 5 },
      { items, retrievals: [], pulledAt: new Date('2026-09-04') }, 'Apex Micro');
    expect(body).not.toContain(said.slice(0, 40));
    expect(body).not.toContain('Terrible app');
    expect(body).toContain('A public discussion on news.ycombinator.com');
    expect(body).toContain('A review on apps.apple.com');
    expect(body).toContain('https://news.ycombinator.com/item?id=1');
    expect(body).toContain('northline/bid-tracker');
    expect(neutralLabel(items[2]!)).toBe('northline/bid-tracker');
  });
});
