process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '6'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { isoWeek, theWeek, worthSending } from '../../src/services/week/sets.js';
import { readMandate, stateMandate } from '../../src/services/mandate/statements.js';
import { decideChannel, styleCeiling } from '../../src/services/ux/interruption.js';

// =============================================================================
// THE WEEK IN FIVE SETS (Roadmap 2027 R5, 30 September 2026; STRATEGY S60).
//
// One email a week to the owner — earned and settled; owed to buyers; can
// buyers find it; stopped on purpose; the one decision — composed on the
// server from the owner's own rows, sent only when the week changed and is
// not empty, and not at all while the owner has asked for quiet. It replaces
// the daily fleet-letter notification and a Monday digest that needed a
// subscription tier nobody has. A check-in style now caps how loudly
// anything reaches the owner, and Urgent is never capped. And coming back
// reads the experimental asset, which is the only asset that exists.
// =============================================================================

const OWNER = 'f_week';
// The real clock: the rows refuse a payment observed in the future.
const NOW = new Date();
const dayOf = (d: Date): string => d.toISOString().slice(0, 10);
const ago = (days: number): string => new Date(NOW.getTime() - days * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
let productId = '';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clk_week', 'owner@example.com', 'Owner']);
  // AN EXPERIMENTAL ASSET EXISTS ONLY BECAUSE A TEST MADE IT: the rows refuse
  // one without the test, so the fixture builds the chain in that order.
  await query(`INSERT INTO venture_mandates (id, founder_id, statement, evidence_mode) VALUES ('wk_m',?,'find something worth selling','real')`, [OWNER]);
  await query(`INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, evidence_mode)
     VALUES ('wk_o','wk_m',?,'a workbook','contractors','bids','it might','nobody pays','real')`, [OWNER]);
  await query(`INSERT INTO market_unknowns (id, founder_id, opportunity_id, question) VALUES ('wk_u',?,'wk_o','will anybody pay')`, [OWNER]);
  await query(`INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, evidence_mode, cost_cents)
     VALUES ('wk_x',?,'wk_o','wk_u','list it on Etsy','somebody buys','nobody buys','real',0)`, [OWNER]);
  await query(`UPDATE venture_experiments SET decision = 'approved', decided_at = datetime('now','-5 day'), decided_by = ? WHERE id = 'wk_x'`, [`founder:${OWNER}`]);
  productId = `p_${nanoid(6)}`;
  await query(`INSERT INTO products (id,name,owner_id,status,scp_status,reality,standing,from_experiment_id) VALUES (?,?,?,'active','active','real','experimental','wk_x')`,
    [productId, 'Bid Decision Workbook', OWNER]);
});

/**
 * A SALE, AS THE LEDGER WILL ACCEPT ONE: the test's placement on the venue, the
 * provider's own payment event, then the charge that stands on it. A charge
 * with nothing behind it is refused by the rows (`charge_needs_source`).
 */
let saleSeq = 0;
async function aSale(founderId: string, experimentId: string, cents: number, provider: string, at: string): Promise<void> {
  const n = ++saleSeq;
  await query(`INSERT INTO experiment_exposures (id, experiment_id, founder_id, provider, exposure_ref, placed_at, placed_by, evidence_mode)
     VALUES (?,?,?,?,?,datetime(?, '-1 day'),'institution:hand','real')`, [`wk_e${n}`, experimentId, founderId, provider, `ref_${n}`, at]);
  await query(`INSERT INTO business_outcome_events (id, founder_id, exposure_id, kind, amount_cents, currency, observed_at,
       provider, provider_event_ref, evidence_mode, counterparty, arrived_via)
     VALUES (?,?,?,'payment',?,'usd',?,?,?,'real','unmatched_external','payment_link')`, [`wk_ev${n}`, founderId, `wk_e${n}`, cents, at, provider, `pe_${n}`]);
  await query(`INSERT INTO economic_events (id, founder_id, kind, amount_cents, currency, occurred_at, provider, provider_ref,
       source_event_id, claim_quality, evidence_mode, because)
     VALUES (?,?,'charge',?,'usd',?,?,?,?,'measured','real','the provider said so')`, [`wk_c${n}`, founderId, cents, at, provider, `ch_${n}`, `wk_ev${n}`]);
}

describe('an empty week', () => {
  it('is quiet, and a quiet week is not sent', async () => {
    const w = await theWeek(OWNER, NOW);
    expect(w).toMatchObject({ earned: [], owed: [], visible: [], stopped: [], decision: null, quiet: true });
    expect(await worthSending(OWNER, NOW)).toMatchObject({ send: false, why: 'quiet' });
  });
});

describe('a week with something in it', () => {
  it('reads each set from the owner\'s own rows', async () => {
    await query(`INSERT INTO venue_findability (id,founder_id,product_id,provider,findable,said_by,said_at) VALUES (?,?,?,?,0,?,?)`,
      [nanoid(), OWNER, productId, 'etsy', `founder:${OWNER}`, ago(3)]);
    await aSale(OWNER, 'wk_x', 1400, 'etsy', ago(2));
    await stateMandate(OWNER, readMandate('No SaaS for now', NOW)!, 'direct', NOW);

    const w = await theWeek(OWNER, NOW);
    expect(w.since).toBe(dayOf(new Date(NOW.getTime() - 7 * 86_400_000)));
    expect(w.earned).toEqual(['1 buyer paid $14.00 on etsy']);
    expect(w.visible).toEqual([`Bid Decision Workbook on Etsy: you said it is hidden (${ago(3).slice(0, 10)})`]);
    expect(w.stopped.some((l) => l.startsWith('you asked: "No SaaS for now"'))).toBe(true);
    expect(w.quiet).toBe(false);
  });

  it('never reads another owner\'s rows', async () => {
    await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', ['f_other', 'clk_o', 'o@example.com', 'O']);
    await query(`INSERT INTO venture_mandates (id, founder_id, statement, evidence_mode) VALUES ('wk_m2','f_other','theirs','real')`);
    await query(`INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, evidence_mode)
       VALUES ('wk_o2','wk_m2','f_other','x','y','z','w','v','real')`);
    await query(`INSERT INTO market_unknowns (id, founder_id, opportunity_id, question) VALUES ('wk_u2','f_other','wk_o2','q')`);
    await query(`INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, evidence_mode, cost_cents)
       VALUES ('wk_x2','f_other','wk_o2','wk_u2','sell','buys','no','real',0)`);
    await query(`UPDATE venture_experiments SET decision = 'approved', decided_at = datetime('now','-5 day'), decided_by = 'founder:f_other' WHERE id = 'wk_x2'`);
    await aSale('f_other', 'wk_x2', 99900, 'stripe', ago(2));
    expect((await theWeek(OWNER, NOW)).earned).toEqual(['1 buyer paid $14.00 on etsy']);
  });

  it('is sent when it differs from last week, and not when it says the same again', async () => {
    expect(await worthSending(OWNER, NOW)).toMatchObject({ send: true, why: 'changed' });
    // A week later, with no new sale: the standing facts (hidden, no SaaS) are
    // the same as the week before only if nothing moved in either window.
    const later = new Date(NOW.getTime() + 14 * 86_400_000);
    const a = await theWeek(OWNER, later);
    const b = await theWeek(OWNER, new Date(later.getTime() - 7 * 86_400_000));
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(await worthSending(OWNER, later)).toMatchObject({ send: false, why: 'unchanged' });
  });

  it('keys the email on the week, so it goes at most once a week', () => {
    expect(isoWeek(new Date('2026-10-05T08:00:00Z'))).toBe('2026-W41');
    expect(isoWeek(new Date('2026-10-11T23:00:00Z'))).toBe('2026-W41');
    expect(isoWeek(new Date('2026-10-12T00:00:00Z'))).toBe('2026-W42');
  });
});

describe('the email', () => {
  it('is one of exactly two account notices, and its words come from the server', async () => {
    const { NOTICE_KINDS } = await import('../../src/services/billing/account-notice.js');
    expect([...NOTICE_KINDS]).toEqual(['institution_stopped', 'the_week']);
  });

  it('replaces the daily letter notification and the Monday digest, adding no job', async () => {
    const { JOB_REGISTRY } = await import('../../src/jobs/index.js');
    expect(JOB_REGISTRY).toHaveProperty('the_week');
    expect(JOB_REGISTRY).not.toHaveProperty('fleet_letter_notify');
    expect(JOB_REGISTRY).not.toHaveProperty('digest_generate');
    expect(JOB_REGISTRY.the_week!.schedule).toBe('30 7 * * 1');
  });
});

describe('how the owner said they want to hear', () => {
  it('caps delivery at the letter while quiet, occasional or away, and sets no cap when hands-on', async () => {
    expect(await styleCeiling(OWNER, NOW)).toBeNull();
    await stateMandate(OWNER, readMandate("I'll be away for a week", NOW)!, 'direct', NOW);
    expect(await styleCeiling(OWNER, NOW)).toBe('letter');
    await stateMandate(OWNER, readMandate('Hands-on', NOW)!, 'direct', NOW);
    expect(await styleCeiling(OWNER, NOW)).toBeNull();
    await stateMandate(OWNER, readMandate('Quiet CEO mode', NOW)!, 'direct', NOW);
    expect(await styleCeiling(OWNER, NOW)).toBe('letter');
  });

  it('only ever lowers: the style never raises a channel the owner capped lower', () => {
    expect(decideChannel('action_needed', 'steady', { max_channel: 'log' } as never)).toBe('log');
    expect(decideChannel('action_needed', 'steady', { max_channel: 'letter' } as never)).toBe('letter');
  });
});

describe('coming back', () => {
  it('reads the experimental asset, which is the only asset that exists', async () => {
    const { proposeAct, setBoundary } = await import('../../src/services/institution/standing-intent.js');
    await setBoundary({ productId, subject: 'set_prices', mode: 'ask_first', statement: 'Ask me before changing prices' });
    await proposeAct({ productId, subject: 'set_prices', actionType: null, params: { price: 19 },
      summary: 'Raise the price to $19', why: 'test', expectedEffect: 'more per sale', risk: 'fewer sales',
      consequence: 'low', proposedBy: 'institution:test' });
    const { whileYouWereAway } = await import('../../src/services/founder/a-week-away.js');
    const letter = await whileYouWereAway(OWNER, 7);
    expect(letter.needsYou.some((l) => l.includes('Raise the price to $19'))).toBe(true);
    expect(letter.changed.some((l) => l.includes('Ask me before changing prices'))).toBe(true);
  });
});
