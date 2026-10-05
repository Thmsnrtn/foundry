// =============================================================================
// LAW (Roadmap 2027 R26): FOUNDRY CAN SAY WHETHER IT CAN SELL ON ITS OWN TODAY,
// FROM WHAT IS TRUE IN PRODUCTION.
//
// The owner was being asked to screenshot things this machine already knows.
// Control now reads them: secrets by name (never a value), whether a payment
// event has really arrived, the places in flight across charters, approved
// tests that never reached a page, the owner's per-sale-minutes decision and
// the correspondence mode. "Can it sell?" is computed from those rows.
//
// The one claim that must not be cheap is the payment route: a configured
// secret proves nothing and a test-mode event proves the machinery, not the
// live route. Only a live-mode event in the last thirty days counts as done.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'c'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { canSellOnItsOwn, productionFacts } from '../../src/services/control/production-facts.js';
import { yourDecisions } from '../../src/services/control/decisions.js';

const OWNER = 'sell_owner';
const SECRET_VALUE = 'whsec_never_shown_anywhere_0123456789';
const event = (id: string, livemode: 0 | 1 | null, daysAgo: number) => query(
  `INSERT INTO stripe_webhook_events (event_id, event_type, processed_at, livemode) VALUES (?, 'payment_intent.succeeded', datetime('now', ?), ?)`,
  [id, `-${String(daysAgo)} days`, livemode]);
const stripeRow = async (env: NodeJS.ProcessEnv) => (await yourDecisions(OWNER, env)).find((d) => d.key === 'stripe_events')!;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'sell_clk', 'sell@example.com', 'Owner']);
});

describe('the payment route is done only when the provider has really reached production', () => {
  it('with no signing secret, nothing can hear a payment and that blocks selling', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const f = await productionFacts(OWNER, {});
    expect(f.paymentEvents.status).toBe('not_working');
    expect(canSellOnItsOwn(f).blockers.join(' ')).toMatch(/nothing can hear a payment/);
    expect((await stripeRow({})).state).toBe('open');
  });

  it('a secret alone is not done, and neither is a test-mode event or a live one older than thirty days', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET_VALUE;
    expect((await stripeRow({})).state).toBe('open');
    await event('evt_test', 0, 1);
    expect((await stripeRow({})).state).toBe('open');
    await event('evt_old_live', 1, 40);
    expect((await stripeRow({})).state).toBe('open');
  });

  it('a live-mode event in the last thirty days is done', async () => {
    await event('evt_live', 1, 2);
    const row = await stripeRow({});
    expect(row.state).toBe('done');
    expect(row.seen).toMatch(/the provider reached this deployment/);
  });
});

describe('the facts are read from rows, and no secret value is ever read out', () => {
  it('names each secret as set or not set, and the value appears nowhere', async () => {
    const f = await productionFacts(OWNER, { STRIPE_WEBHOOK_SECRET: SECRET_VALUE, STRIPE_SECRET_KEY: 'sk_live_also_secret' });
    expect(f.secrets.find((s) => s.name === 'STRIPE_WEBHOOK_SECRET')!.present).toBe(true);
    expect(f.secrets.find((s) => s.name === 'CLOUDFLARE_ANALYTICS_TOKEN')!.present).toBe(false);
    const said = JSON.stringify(f);
    expect(said).not.toContain(SECRET_VALUE);
    expect(said).not.toContain('sk_live_also_secret');
  });

  it('an approved Workshop test with no page is listed until it is placed', async () => {
    const { openMandate } = await import('../../src/services/venture/mandate.js');
    const m = await openMandate({ founderId: OWNER, statement: 'Small things for trades businesses', shape: null, evidenceMode: 'real' });
    if ('refused' in m) throw new Error(m.refused);
    await query(`INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
      VALUES ('sell_opp',?,?,'a brief','contractors','by hand','said so','one firm','[]','real')`, [m.id, OWNER]);
    await query(`INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test) VALUES ('sell_unk',?,'sell_opp','whether anyone pays',1,'offer one')`, [OWNER]);
    await query(`INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode)
      VALUES ('sell_x',?,'sell_opp','sell_unk','offer one','one pays','nobody pays',1000,'real')`, [OWNER]);
    const { decideExperiment } = await import('../../src/services/venture/validation.js');
    await decideExperiment({ experimentId: 'sell_x', decision: 'approved', by: `founder:${OWNER}`, via: 'a test' });
    const { recordMaterial } = await import('../../src/services/venture/hand.js');
    await recordMaterial({ founderId: OWNER, experimentId: 'sell_x', kind: 'offer_shape', title: 'shape', body: JSON.stringify({ venue: 'workshop' }), by: 'test' });
    expect((await productionFacts(OWNER, {})).unplaced.map((u) => u.experimentId)).toEqual(['sell_x']);
    let p = (await query(`SELECT id FROM products WHERE from_experiment_id = 'sell_x'`, [])).rows[0];
    if (!p) {
      await query(`INSERT INTO products (id, name, owner_id, status, reality, standing, from_experiment_id, from_opportunity_id) VALUES ('sell_p','A brief',?,'active','real','experimental','sell_x','sell_opp')`, [OWNER]);
      p = { id: 'sell_p' };
    }
    await query(`INSERT INTO experiment_exposures (id, founder_id, experiment_id, product_id, provider, exposure_ref, evidence_mode, placed_by) VALUES ('sell_exp',?,'sell_x',?,'stripe','plink_1','real','test')`, [OWNER, String(p.id)]);
    expect((await productionFacts(OWNER, {})).unplaced).toEqual([]);
  });
});

describe('can it sell on its own: blockers stop it, costs leave minutes with the owner', () => {
  it('without the owner\'s per-sale-minutes decision or a charter, it cannot', async () => {
    const r = canSellOnItsOwn(await productionFacts(OWNER, { STRIPE_SECRET_KEY: 'x', STRIPE_WEBHOOK_SECRET: SECRET_VALUE }));
    expect(r.yes).toBe(false);
    expect(r.blockers.join(' ')).toMatch(/allow offers that still take some of your minutes/);
    expect(r.blockers.join(' ')).toMatch(/no charter is signed/);
  });

  it('with the owner\'s own allowance, a live payment route and a charter with room, it can; the minutes left are named', async () => {
    const { supersedeOriginationPolicy } = await import('../../src/services/venture/legal-surface.js');
    await supersedeOriginationPolicy({ founderId: OWNER, requirement: 'front_loaded_attention', treatment: 'prefer', why: 'The owner allowed it (PENDING 32).', by: `founder:${OWNER}` });
    const { signCharter } = await import('../../src/services/institution/charter.js');
    await signCharter({ founderId: OWNER, testsTotalCents: 10_000, probesInFlight: 3, cognitionCentsPerDay: 300, days: 90, publicVoice: 'Apex Micro', statement: 'A quarter.' });
    const r = canSellOnItsOwn(await productionFacts(OWNER, { STRIPE_SECRET_KEY: 'x', STRIPE_WEBHOOK_SECRET: SECRET_VALUE }));
    expect(r).toMatchObject({ yes: true, blockers: [] });
    expect(r.costs.join(' ')).toMatch(/every refund and cancellation is yours/);
    expect(r.costs.join(' ')).toMatch(/every buyer email is yours/);
    const on = canSellOnItsOwn(await productionFacts(OWNER, { STRIPE_SECRET_KEY: 'x', STRIPE_WEBHOOK_SECRET: SECRET_VALUE, FOUNDRY_ENABLE_MONEY_TOOLS: 'true' }));
    expect(on.costs.join(' ')).not.toMatch(/refund and cancellation is yours/);
  });

  it('a forge row pretending to be the owner\'s cannot make it sell', async () => {
    await expect(query(`INSERT INTO origination_policy (id, founder_id, requirement, treatment, why, set_by) VALUES ('sell_forged', ?, 'front_loaded_attention', 'prefer', 'x', 'institution:forge')`, [OWNER]))
      .rejects.toThrow(/founder_row_is_the_owners/);
  });
});
