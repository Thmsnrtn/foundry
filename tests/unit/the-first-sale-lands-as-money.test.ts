// =============================================================================
// LAW (Roadmap 2027 R25): THE FIRST STRIPE SALE LANDS AS MONEY, WHICHEVER WAY
// IT ARRIVES.
//
// A one-time sale reached the money ledger only through `charge.succeeded`.
// The intent's event opened the sale and what was owed, and said nothing about
// money; the provider poll, which recovers a sale whose webhook never came,
// replays exactly that intent, so in the outage it exists for the sale was
// recorded and its money was not. A sale with no charge row has no fee and no
// contribution: the first dollar would have been unreadable.
//
// Now the tagged intent states the charge it names, keyed on that charge, so
// the intent and the charge event are one charge row whichever comes first,
// and the fee is read from the charge. An untagged or foreign intent, or one
// with no charge yet, states nothing.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '5'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';

const feeReads: string[] = [];
vi.mock('../../src/services/economy/provider-stripe.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  stripeClient: () => ({ charges: { retrieve: async (id: string) => ({ id, balance_transaction: `txn_${id}` }) } }),
  retrieveBalanceTransaction: async (id: string) => { feeReads.push(id); return { fee: 117, net: 2783, currency: 'usd' }; },
}));

const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');
const { intakeStripeEconomics, moneyFactsFromStripeEvent } = await import('../../src/services/economy/stripe-economics.js');

let OWNER = '';
let MANDATE = '';

/** A sale opened by the settlement intake: an exposure, a payment outcome and what is owed. */
async function aSale(pi: string, ch: string): Promise<string> {
  const id = nanoid();
  await query(`INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
    VALUES (?,?,?,'a file','shops','by hand','somebody pays','nobody pays','[]','real')`, [`o_${id}`, MANDATE, OWNER]);
  await query(`INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test) VALUES (?,?,?,'will anyone pay',1,'offer one')`, [`u_${id}`, OWNER, `o_${id}`]);
  await query(`INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode)
    VALUES (?,?,?,?,'sell one','one pays','nobody pays',0,'real')`, [`x_${id}`, OWNER, `o_${id}`, `u_${id}`]);
  await query(`UPDATE venture_experiments SET decision = 'approved', decided_at = datetime('now'), decided_by = 'owner' WHERE id = ?`, [`x_${id}`]);
  await query(`INSERT INTO experiment_exposures (id, founder_id, experiment_id, provider, exposure_ref, evidence_mode, placed_by) VALUES (?,?,?,'stripe',?,'real','fixture')`,
    [`e_${id}`, OWNER, `x_${id}`, `plink_${id}`]);
  await query(`INSERT INTO business_outcome_events (id, founder_id, exposure_id, kind, amount_cents, observed_at, provider, provider_event_ref, evidence_mode)
    VALUES (?,?,?,'payment',2900,datetime('now'),'stripe',?,'real')`, [`b_${id}`, OWNER, `e_${id}`, pi]);
  await query(`INSERT INTO experiment_fulfilments (id, founder_id, experiment_id, exposure_id, payment_event_id, provider, payment_ref, charge_ref, amount_cents, currency, status)
    VALUES (?,?,?,?,?,'stripe',?,?,2900,'usd','owed')`, [id, OWNER, `x_${id}`, `e_${id}`, `b_${id}`, pi, ch]);
  return `x_${id}`;
}

const intent = (pi: string, ch: string | null, metadata: Record<string, string> | null, n = 1) => ({
  id: `evt_pi_${pi}_${String(n)}`, type: 'payment_intent.succeeded', created: 1_791_000_000,
  data: { object: { id: pi, object: 'payment_intent', amount: 2900, amount_received: 2900, currency: 'usd', latest_charge: ch, metadata } },
});
const charge = (ch: string, pi: string, metadata: Record<string, string>) => ({
  id: `evt_ch_${ch}`, type: 'charge.succeeded', created: 1_791_000_000,
  data: { object: { id: ch, object: 'charge', amount: 2900, currency: 'usd', payment_intent: pi, balance_transaction: `txn_${ch}`, metadata } },
});
const rows = async (kind: string) => (await query(`SELECT provider_ref FROM economic_events WHERE founder_id = ? AND kind = ? ORDER BY rowid`, [OWNER, kind])).rows.map((r) => String(r.provider_ref));

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => {
  OWNER = `sale_${nanoid(8)}`;
  feeReads.length = 0;
  await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)', [OWNER, `clerk_${OWNER}`, `${OWNER}@example.com`]);
  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const m = await openMandate({ founderId: OWNER, statement: 'Shops that build the thing', shape: null, evidenceMode: 'real' });
  if ('refused' in m) throw new Error(m.refused);
  MANDATE = m.id;
});

describe('the intent alone is enough', () => {
  it('a tagged intent records one charge, keyed on its charge, and its fee read from that charge', async () => {
    const pi = `pi_${nanoid(6)}`; const ch = `ch_${nanoid(6)}`;
    const x = await aSale(pi, ch);
    const r = await intakeStripeEconomics(intent(pi, ch, { app: 'foundry', experiment_id: x }));
    expect(r.recorded).toEqual([{ kind: 'charge', providerRef: ch, duplicate: false }]);
    expect(await rows('charge')).toEqual([ch]);
    expect(await rows('provider_fee')).toEqual([`txn_${ch}`]);
  });
});

describe('the intent and the charge event are one sale, whichever arrives first', () => {
  it('charge first, then the intent: one charge row, one fee', async () => {
    const pi = `pi_${nanoid(6)}`; const ch = `ch_${nanoid(6)}`;
    const x = await aSale(pi, ch);
    const meta = { app: 'foundry', experiment_id: x };
    await intakeStripeEconomics(charge(ch, pi, meta));
    const second = await intakeStripeEconomics(intent(pi, ch, meta));
    expect(second.recorded).toEqual([{ kind: 'charge', providerRef: ch, duplicate: true }]);
    expect(await rows('charge')).toEqual([ch]);
    expect(await rows('provider_fee')).toEqual([`txn_${ch}`]);
  });

  it('the intent first, then the charge, then the intent again (a poll replay): still one charge row and one fee', async () => {
    const pi = `pi_${nanoid(6)}`; const ch = `ch_${nanoid(6)}`;
    const x = await aSale(pi, ch);
    const meta = { app: 'foundry', experiment_id: x };
    await intakeStripeEconomics(intent(pi, ch, meta));
    await intakeStripeEconomics(charge(ch, pi, meta));
    await intakeStripeEconomics(intent(pi, ch, meta, 2));
    expect(await rows('charge')).toEqual([ch]);
    expect(await rows('provider_fee')).toEqual([`txn_${ch}`]);
  });
});

describe('an intent that is not a sale of ours states nothing', () => {
  it('untagged, another app\'s, or with no charge yet: no money fact at all', () => {
    expect(moneyFactsFromStripeEvent(intent('pi_a', 'ch_a', null))).toEqual([]);
    expect(moneyFactsFromStripeEvent(intent('pi_b', 'ch_b', { app: 'acreos', experiment_id: 'x' }))).toEqual([]);
    expect(moneyFactsFromStripeEvent(intent('pi_c', 'ch_c', { app: 'foundry' }))).toEqual([]);
    expect(moneyFactsFromStripeEvent(intent('pi_d', null, { app: 'foundry', experiment_id: 'x' }))).toEqual([]);
  });

  it('a land sale on the shared account, tagged nothing, writes nothing to Foundry\'s ledger', async () => {
    const r = await intakeStripeEconomics(intent('pi_land', 'ch_land', { kind: 'land_sale' }));
    expect(r).toEqual({ recorded: [], unread: [] });
    expect(await rows('charge')).toEqual([]);
  });

  it('a tagged intent whose sale Foundry never opened is left unread, not guessed at', async () => {
    const r = await intakeStripeEconomics(intent('pi_ghost', 'ch_ghost', { app: 'foundry', experiment_id: 'x_nobody' }));
    expect(r.recorded).toEqual([]);
    expect(r.unread).toEqual([{ providerRef: 'ch_ghost', reason: 'no settled sale of ours matches this charge' }]);
  });
});

describe('a checkout session is never money', () => {
  it('a completed session states no charge', () => {
    expect(moneyFactsFromStripeEvent({ id: 'evt_cs', type: 'checkout.session.completed', created: 1,
      data: { object: { id: 'cs_1', object: 'checkout.session', amount_total: 2900, payment_intent: 'pi_1', metadata: { app: 'foundry', experiment_id: 'x' } } } })).toEqual([]);
  });
});
