// =============================================================================
// THE DEPLOYMENT'S THINKING CEILING GROWS WITH REAL REVENUE, AND NOTHING ELSE
// MOVES (F1, 9 October 2026).
//
// The deployment's founder and global caps were fixed numbers
// (AI_DAILY_COST_CEILING_*), so a Foundry that began to earn would think no
// more than one that earned nothing. Now each is the GREATER of its floor and a
// stated share of trailing REAL net revenue a day:
//   * no revenue → the floors, exactly as before;
//   * revenue counts only `evidence_mode = 'real'`: a sandbox or reference
//     charge raises nothing;
//   * a read that fails → the floors (fail closed: an error never widens);
//   * THE OWNER'S CHARTER STILL BINDS: the cap handed to the door is the lower
//     of the scaled cap and the rate he signed, so revenue can never buy
//     thinking he did not allow (CONSTITUTION: seeing revenue never grants
//     permission; the charter is his).
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.AI_DAILY_COST_CEILING_CENTS = '500';
process.env.AI_DAILY_COST_CEILING_FOUNDER_CENTS = '500';
process.env.AI_DAILY_COST_CEILING_GLOBAL_CENTS = '500';
process.env.AI_CEILING_REVENUE_SHARE = '0.10';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { query } from '../../src/db/client.js';
import { OWNER, seedProductionShape } from '../helpers/world.js';

const C = await import('../../src/services/deployment/ai-ceilings.js');

beforeAll(async () => { await seedProductionShape(); }, 180_000);

/** A real exposure on the seeded (real, approved) experiment. */
async function exposure(): Promise<string> {
  const exp = String(((await query(`SELECT id FROM venture_experiments WHERE founder_id = ? ORDER BY rowid LIMIT 1`, [OWNER])).rows[0] as Record<string, unknown>).id);
  await query(`INSERT OR IGNORE INTO experiment_exposures (id, founder_id, experiment_id, provider, exposure_ref, evidence_mode, placed_by)
    VALUES ('expo_real',?,?,'stripe','plink_real','real','test fixture')`, [OWNER, exp]);
  return 'expo_real';
}

/** A charge as the Stripe intake writes it: it points at the outcome event that recorded it, in its own world. */
async function charge(cents: number, mode: 'real' | 'sandbox' | 'reference', ref: string, kind: 'charge' | 'refund' = 'charge'): Promise<void> {
  const expo = (): Promise<string> => exposure();
  const { record } = await import('../../src/services/economy/ledger.js');
  let source: string | null = null;
  if (kind === 'charge') {
    source = `boe_${ref}`;
    await query(`INSERT INTO business_outcome_events (id, founder_id, exposure_id, kind, amount_cents, observed_at, provider, provider_event_ref, evidence_mode)
      VALUES (?,?,?,'payment',?,datetime('now'),'stripe',?,?)`, [source, OWNER, await expo(), cents, `pi_${ref}`, mode]);
  }
  await record({ founderId: OWNER, kind, amountCents: cents, occurredAt: new Date(), provider: 'stripe', providerRef: ref, sourceEventId: source, evidenceMode: mode, because: 'test' });
}

describe('the arithmetic', () => {
  it('is the greater of the floor and the share of trailing revenue a day', () => {
    expect(C.ceilingFromRevenue(500, 0, 30, 0.1)).toBe(500);
    expect(C.ceilingFromRevenue(500, 300_000, 30, 0.1)).toBe(1000);
    expect(C.ceilingFromRevenue(500, -50_000, 30, 0.1)).toBe(500);
    expect(C.ceilingFromRevenue(500, 300_000, 30, Number.NaN)).toBe(500);
  });
  it('the share is stated, bounded, and a nonsense share means floors only', () => {
    expect(C.revenueShareOf('0.10')).toBe(0.1);
    expect(C.revenueShareOf('7')).toBe(C.MAX_REVENUE_SHARE);
    expect(C.revenueShareOf('-1')).toBe(0);
    expect(C.revenueShareOf('lots')).toBe(0);
  });
});

describe('the ceilings the door reads', () => {
  it('with no revenue they are the floors', async () => {
    const c = await C.deploymentCeilings();
    expect(c).toMatchObject({ founder: 500, global: 500, product: 500 });
    // He signs a generous rate; the deployment floor binds below it.
    const { signCharter } = await import('../../src/services/institution/charter.js');
    await signCharter({ founderId: OWNER, days: 30, testsTotalCents: 5000, probesInFlight: 1, cognitionCentsPerDay: 5000, publicVoice: 'the Workshop', statement: 'a test charter' });
    const { thinkingCapFor } = await import('../../src/services/institution/spending.js');
    expect(await thinkingCapFor(OWNER)).toBe(500);
  });

  it('money in another world moves nothing', async () => {
    // A sandbox or reference refund (no outcome event needed) would LOWER a sum
    // that read every world; it must not touch the real one. Read after the
    // real charge below, where a leak would show as a lower cap.
    await charge(300_000, 'sandbox', 're_sandbox', 'refund');
    await charge(300_000, 'reference', 're_reference', 'refund');
    expect((await C.deploymentCeilings()).founder).toBe(500);
  });

  it('real net revenue raises the founder and global caps by the stated share; the product cap stays its floor', async () => {
    await charge(320_000, 'real', 'ch_real');
    await charge(20_000, 'real', 'ch_real_r', 'refund');
    // (320,000 − 20,000) × 10% / 30 days = 1,000 cents a day.
    const c = await C.deploymentCeilings();
    expect(c).toMatchObject({ founder: 1000, global: 1000, product: 500 });
    expect(c.because).toMatch(/10% of \$3,000\.00/);
  });

  it('a read that fails gives the floors: an error never widens', async () => {
    const c = await C.deploymentCeilings(async () => { throw new Error('the ledger is unreadable'); });
    expect(c).toMatchObject({ founder: 500, global: 500 });
    expect(c.because).toMatch(/could not be read/);
  });

  it('the owner\'s charter still binds: revenue raised the deployment cap, never his signed rate', async () => {
    const { thinkingCapFor } = await import('../../src/services/institution/spending.js');
    const { signCharter } = await import('../../src/services/institution/charter.js');
    // Under his 5,000 the scaled deployment cap (1,000) now binds, where the floor (500) bound before revenue.
    expect(await thinkingCapFor(OWNER)).toBe(1000);
    // AND THE DOOR RESERVES AGAINST THE SAME CAPS: the reservation row records them.
    process.env.OPENROUTER_API_KEY = 'sk-or-test-never-sent';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'r', model: 'm',
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 })));
    try {
      const { callSonnet } = await import('../../src/services/ai/client.js');
      const { companySpend } = await import('../../src/services/ai/what-it-is-for.js');
      const company = String(((await query(`SELECT id FROM products WHERE owner_id = ? AND reality = 'real' ORDER BY created_at LIMIT 1`, [OWNER])).rows[0] as Record<string, unknown>).id);
      await callSonnet('s', 'u', 10, companySpend(company, 'a signal'));
      const row = (await query(`SELECT global_cap_cents, founder_cap_cents, product_cap_cents FROM ai_spend_reservations ORDER BY rowid DESC LIMIT 1`)).rows[0] as Record<string, unknown>;
      expect(row).toMatchObject({ global_cap_cents: 1000, founder_cap_cents: 1000, product_cap_cents: 500 });
    } finally {
      vi.unstubAllGlobals();
      delete process.env.OPENROUTER_API_KEY;
    }
    await signCharter({ founderId: OWNER, days: 30, testsTotalCents: 5000, probesInFlight: 1, cognitionCentsPerDay: 300, publicVoice: 'the Workshop', statement: 'a test charter' });
    expect(await thinkingCapFor(OWNER)).toBe(300);
  });
});
