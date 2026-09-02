process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { whatSituation } from '../../src/services/founder/what-situation.js';
import {
  advanceReferenceWorld, establishReferenceCompany,
} from '../../src/services/reference/world.js';

// =============================================================================
// WHAT SITUATION IS THIS?
//
// The owner's rule for the company page: "A revenue collapse should dominate
// twelve healthy metrics. A quiet healthy company should look quiet." A page
// that renders every dataset in a fixed order cannot do that.
//
// He named eight situations to prove before a real company is connected, so
// that AcreOS does not have to teach the product what a populated company
// looks like. This file is those eight, each produced by running the actual
// reference world or the actual sense system — never by writing the answer into
// a fixture and reading it back.
// =============================================================================

const OWNER = 'ws_owner';

async function reference(scenarioKey: string): Promise<string> {
  const made = await establishReferenceCompany({ scenarioKey, ownerId: OWNER });
  if (!made) throw new Error(`no scenario ${scenarioKey}`);
  await advanceReferenceWorld(made.productId);
  return made.productId;
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_ws', 'owner@example.com', 'Owner']);
});

describe('the eight situations', () => {
  it('1. a healthy company looks quiet, and saying so is a result', async () => {
    const id = await reference('steady_and_unremarkable');
    const read = await whatSituation(id);
    expect(read.situation).toBe('steady');
    expect(read.demandsAttention).toBe(false);
    expect(read.headline).toContain('has moved much since a month ago');
  });

  it('2. revenue falling dominates everything else', async () => {
    const id = await reference('revenue_quietly_falling');
    const read = await whatSituation(id);
    expect(read.situation).toBe('revenue_falling');
    expect(read.demandsAttention).toBe(true);
    expect(read.headline).toContain('Revenue is falling');
    expect(read.because.join(' ')).toMatch(/new revenue is down about \d+%/);
  });

  it('3. growth that is not converting, which looks like success', async () => {
    // The hardest to see and the most expensive to miss: every number the
    // marketing side watches is green and none of it is turning into money.
    const id = await reference('growth_that_is_not_converting');
    const read = await whatSituation(id);
    expect(read.situation).toBe('growth_not_converting');
    expect(read.demandsAttention).toBe(true);
    expect(read.headline).toContain('More people are arriving');
    expect(read.headline).toContain('revenue has not moved');
  });

  it('4. customers leaving faster, under revenue that holds', async () => {
    const id = await reference('customers_leaving_faster');
    const read = await whatSituation(id);
    expect(read.situation).toBe('churning');
    expect(read.demandsAttention).toBe(true);
    expect(read.headline).toContain('leaving faster');
  });

  it('5. payments failing — a quantity only the company knows it has', async () => {
    // Nothing in the institution knows what a failed payment IS. The company
    // declared the quantity and the institution reasoned about its direction,
    // which is what keeps this from being a SaaS dashboard.
    const id = await reference('payments_quietly_failing');
    const declared = (await query(
      'SELECT channel_key, label FROM company_observation_channels WHERE product_id = ?',
      [id])).rows[0] as Record<string, unknown>;
    expect(String(declared.channel_key)).toBe('failed_payments_7d');

    // It takes two readings for a direction to exist, as it does for any other
    // quantity: the first is a baseline, not a movement.
    await advanceReferenceWorld(id);
    const read = await whatSituation(id);
    expect(read.situation).toBe('payments_failing');
    expect(read.headline).toContain('payments that failed this week');
    expect(read.headline).toContain('money you have already earned');
  });

  it('6. a sense that broke is said before anything derived from it', async () => {
    // Presenting stale numbers with a confident face is the failure here.
    const id = await reference('steady_and_unremarkable');
    const { noteSenseObserved } = await import('../../src/services/senses/index.js');
    await noteSenseObserved(id, 'reference_world', 'the provider stopped answering');
    const read = await whatSituation(id);
    expect(read.situation).toBe('blind');
    expect(read.demandsAttention).toBe(true);
    expect(read.headline).toContain('stopped being able to see');
    expect(read.because.join(' ')).toContain('stopped answering');
  });

  it('7. two sources disagreeing is its own answer, not an average', async () => {
    // Averaging two numbers that contradict each other produces a third nobody
    // reported and hides the fact he needs: that neither can be relied on.
    const id = await reference('customers_leaving_faster');
    for (const [eid, origin, direction] of [
      ['ws_c1', 'stripe', 'rose'], ['ws_c2', 'the_billing_export', 'fell'],
    ] as const) {
      await query(
        `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
         VALUES (?,?,'reference_metric_ingest',?,'low',?,'x')`,
        [eid, id, `reference_metric:active_users:${direction}`, JSON.stringify({
          origin, field: 'active_users', direction, observed_value: 5, previous_value: 4 })]);
    }
    const read = await whatSituation(id);
    expect(read.situation).toBe('conflicting');
    expect(read.headline).toContain('disagree about the same thing');
    expect(read.because.join(' ')).toContain('active_users');
  });

  it('8. a new company is not a broken one', async () => {
    // One needs a connection. The other needs looking at. A page that called
    // both "healthy" would be wrong about both.
    const NEW = 'ws_new';
    await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,'Brand New',?,'active')",
      [NEW, OWNER]);
    const read = await whatSituation(NEW);
    expect(read.situation).toBe('unknown');
    expect(read.demandsAttention).toBe(false);
    expect(read.headline).toContain('cannot see anything about this company yet');

    // Connected but silent is a THIRD state, and it says so rather than
    // pretending the connection is an answer.
    const { connectSense } = await import('../../src/services/senses/index.js');
    await connectSense({ productId: NEW, companyName: 'Brand New',
      senseKey: 'revenue', provider: 'stripe', mode: 'real' });
    const connected = await whatSituation(NEW);
    expect(connected.situation).toBe('unknown');
    expect(connected.headline).toContain('Nothing has reported yet');
  });
});

describe('going quiet', () => {
  it('says how long it has been, rather than showing month-old numbers as today', async () => {
    const STALE = 'ws_stale';
    await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,'Quiet Co',?,'active')",
      [STALE, OWNER]);
    for (const [id, back] of [['ws_s1', '-70 day'], ['ws_s2', '-40 day']] as const) {
      await query(
        `INSERT INTO metric_snapshots (id,product_id,snapshot_date,new_mrr_cents)
         VALUES (?,?,date('now',?),100000)`, [id, STALE, back]);
    }
    const read = await whatSituation(STALE);
    expect(read.situation).toBe('blind');
    expect(read.demandsAttention).toBe(true);
    expect(read.headline).toMatch(/Nothing has reported on this company for \d+ days/);
  });
});
