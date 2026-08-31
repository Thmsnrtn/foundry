process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  recordAgentCustomerSignal, updateHealthScore,
} from '../../src/services/customer/intelligence.js';

// =============================================================================
// FOUNDRY MAY CREATE PRESENTATION. IT MAY NOT FABRICATE EVIDENCE.
//
// `harbor.ts` maps `parsed.customer_signals` out of an LLM response into
// `CustomerSignal[]` — external_id, name, email, four health sub-scores — and
// the agent runner passed that to `upsertCustomer`, whose insert branch created
// a customer: an account name, an email address, a plan, an MRR figure, stage
// 'trial', health 50. Written into the same table, in the same shape, as a
// customer a real billing system reported through the scoped public API. The
// priority ranker, the strategy synthesis and the accuracy tracker then read
// those rows as the company's customers.
//
// A customer is a fact about the world. A model may JUDGE one and may not
// BRING ONE INTO EXISTENCE, and the difference has to be structural rather than
// a convention somebody remembers at the call site.
// =============================================================================

const P = 'inv_product';
const OWNER = 'inv_owner';

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email,tier) VALUES (?,'inv_c','o@example.com','growth')`, [OWNER]);
  await query(`INSERT INTO products (id,name,owner_id,status) VALUES (?,'Kettle Row',?,'active')`, [P, OWNER]);
});

beforeEach(async () => {
  await query('DELETE FROM customer_intelligence WHERE product_id = ?', [P]);
  await query('DELETE FROM agent_audit_log WHERE product_id = ?', [P]);
});

/** A customer a real system reported, which is the only way one arrives. */
const realCustomer = async (externalId: string) => {
  await query(
    `INSERT INTO customer_intelligence
       (id, product_id, external_customer_id, account_name, email, plan, mrr_cents, stage)
     VALUES (?, ?, ?, 'Kettle Row Bakery', 'accounts@bakery.example', 'pro', 42000, 'paying')`,
    [`ci_${externalId}`, P, externalId],
  );
};

const customers = async () => (await query(
  'SELECT * FROM customer_intelligence WHERE product_id = ?', [P],
)).rows as unknown as Array<Record<string, unknown>>;

describe('a customer an agent named that the company does not have', () => {
  it('is not created', async () => {
    const outcome = await recordAgentCustomerSignal(P, 'harbor', {
      external_id: 'cus_the_model_made_this_up',
      note: 'Churn risk — usage down 60% this month',
      health_sentiment_score: 12,
    });

    expect(outcome).toEqual({ refused: 'no_such_customer' });
    expect(await customers(), 'no customer row exists').toEqual([]);
  });

  it('is refused rather than dropped, where the founder reads it', async () => {
    await recordAgentCustomerSignal(P, 'harbor', { external_id: 'cus_invented', note: 'at risk' });

    const audit = (await query(
      `SELECT event_type, actor_id, target_id, metadata_json FROM agent_audit_log
        WHERE product_id = ? AND event_type = 'customer_signal.refused'`, [P],
    )).rows as unknown as Array<Record<string, unknown>>;

    expect(audit).toHaveLength(1);
    expect(audit[0].actor_id).toBe('harbor');
    expect(audit[0].target_id).toBe('cus_invented');
    expect(String(audit[0].metadata_json)).toContain('no_such_customer');
  });

  it('is refused when the agent named nothing at all', async () => {
    expect(await recordAgentCustomerSignal(P, 'harbor', { external_id: '  ', note: 'x' }))
      .toEqual({ refused: 'external_id_missing' });
    expect(await customers()).toEqual([]);
  });
});

describe('a customer the company really has', () => {
  it('takes the agent judgment, and the note says who wrote it', async () => {
    await realCustomer('cus_real');

    const outcome = await recordAgentCustomerSignal(P, 'harbor', {
      external_id: 'cus_real',
      note: 'Support sentiment fell after the March incident',
      health_sentiment_score: 20,
    });

    expect(outcome).toEqual({ recorded: true, customerId: 'ci_cus_real' });
    const [row] = await customers();
    expect(Number(row.support_sentiment_score)).toBe(20);
    expect(String(row.agent_notes)).toContain('March incident');
    expect(String(row.agent_notes), 'attributed to the agent that said it').toContain('harbor');
    // AND NOT RECORDED AS A CONTACT. This used to assert `last_contacted_by`
    // was stamped — the defect written down as an expectation. `addAgentNote`
    // sends nothing; a model forming a private opinion marked the customer as
    // having been written to, by a named agent, on a date, and the v1 API
    // serves that row to an integrator likely syncing it into a CRM.
    expect(row.last_contacted_by, 'a note is not a contact').toBeNull();
    expect(row.last_contacted_at, 'a note is not a contact').toBeNull();
  });

  it('keeps its identity and its money, which are not the agent to state', async () => {
    await realCustomer('cus_real');

    await recordAgentCustomerSignal(P, 'harbor', {
      external_id: 'cus_real',
      note: 'Looks like they upgraded',
      health_billing_score: 95,
    });

    const [row] = await customers();
    expect(row.account_name).toBe('Kettle Row Bakery');
    expect(row.email).toBe('accounts@bakery.example');
    expect(row.plan).toBe('pro');
    expect(Number(row.mrr_cents), 'a model does not restate revenue').toBe(42000);
    expect(row.stage).toBe('paying');
  });

  it('belongs to its own company', async () => {
    await realCustomer('cus_real');
    expect(await recordAgentCustomerSignal('some_other_product', 'harbor', {
      external_id: 'cus_real', note: 'x',
    })).toEqual({ refused: 'no_such_customer' });
  });
});

describe('the door itself', () => {
  it('is gone: nothing in the service can create a customer from a caller', () => {
    // The refusal above is a property of ONE function. What stops the next
    // caller is that the creating function no longer exists — the only insert
    // into this table left in `src/` is the scoped public API, where a real
    // outside system reports a real customer.
    const src = readFileSync('src/services/customer/intelligence.ts', 'utf8');
    expect(src).not.toMatch(/INSERT\s+INTO\s+customer_intelligence/i);
  });

  it('does not stop a health score being recomputed for a customer that exists', async () => {
    await realCustomer('cus_real');
    await updateHealthScore('ci_cus_real', { login_frequency_score: 10 });
    const [row] = await customers();
    expect(Number(row.login_frequency_score)).toBe(10);
  });
});
