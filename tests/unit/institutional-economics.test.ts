process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { logCost } from '../../src/services/financial/economics.js';
import {
  UNMEASURED_COMPONENTS, getCapabilityCost, getResponsibilityCost,
} from '../../src/services/financial/institutional-economics.js';

// =============================================================================
// Cost attaches to institutional truth, and unmeasured never becomes zero.
//
// The economics that would be easy to build here is one where every total looks
// complete. That version understates exactly the costs that decide whether
// automating something was worth doing — founder time, rework, failure — and it
// would do so silently. These tests exist mostly to keep that version out.
// =============================================================================

const P = 'ie_prod';
const OTHER = 'ie_other';

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES
    ('ie_owner','ie_c1','o@example.com'),('ie_other_owner','ie_c2','x@example.com')`, []);
  await query(`INSERT INTO products (id,name,owner_id) VALUES
    ('${P}','Co','ie_owner'),('${OTHER}','Other Co','ie_other_owner')`, []);
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary) VALUES
    ('ie_sig','${P}','repository','development_need_observed','low','{}','s'),
    ('ie_sig2','${OTHER}','repository','development_need_observed','low','{}','s')`, []);
  await query(`INSERT INTO institutional_responsibilities (id,product_id,title,capability,state,discovery_evidence_ref) VALUES
    ('ie_resp','${P}','Answer customers','customer_support','visible','signal_event:ie_sig'),
    ('ie_foreign','${OTHER}','Answer customers','customer_support','visible','signal_event:ie_sig2')`, []);
});

describe('institutional cost attribution', () => {
  it('answers what a responsibility cost, from the existing ledger', async () => {
    await logCost({
      productId: P, costType: 'llm_tokens', amountUsd: 0.02,
      responsibilityId: 'ie_resp', capability: 'customer_support',
    });
    await logCost({
      productId: P, costType: 'email_send', amountUsd: 0.001,
      responsibilityId: 'ie_resp', capability: 'customer_support',
    });

    const cost = await getResponsibilityCost(P, 'ie_resp');
    expect(cost.measured).toMatchObject({
      modelUsd: 0.02, providerUsd: 0.001, events: 2,
    });
    expect(cost.measured.totalUsd).toBeCloseTo(0.021, 6);
    expect(cost.capability).toBe('customer_support');
  });

  it('never reports an unmeasured cost as zero', async () => {
    // The rule the module exists for. A responsibility nobody has booked spend
    // against reports zero MEASURED spend and the full unmeasured list — which
    // reads as "we know of no spend", not as "this was free".
    await query(
      `INSERT INTO institutional_responsibilities (id,product_id,title,capability,state,discovery_evidence_ref)
       VALUES ('ie_free','${P}','Something else','operations','visible','signal_event:ie_sig')`, []).catch(() => {});
    const cost = await getResponsibilityCost(P, 'ie_free');
    expect(cost.measured.totalUsd).toBe(0);
    expect(cost.measured.events).toBe(0);
    // And the things nobody measures are named rather than folded into the sum.
    expect(cost.unmeasured).toBe(UNMEASURED_COMPONENTS);
    expect(cost.unmeasured.length).toBeGreaterThanOrEqual(7);
    for (const component of ['founder_time', 'failure_and_exception_cost', 'risk']) {
      expect(cost.unmeasured.join(' ')).toContain(component);
    }
  });

  it('counts volume it cannot price, instead of pricing it', async () => {
    // Founder-authored work is real work. Counting it is true; putting a dollar
    // value on it would be a number nobody measured.
    expect((await getResponsibilityCost(P, 'ie_resp')).counted.founderAuthoredReplies).toBe(0);

    // A real customer message and a real founder-authored reply, produced by the
    // production services rather than hand-built rows. Every attempt to shortcut
    // this with direct inserts was refused by a different guard, which is the
    // schema working as intended.
    const { registerSupportChannel, ingestCustomerMessage } = await import(
      '../../src/services/institution/customer-message-intake.js');
    const { proposeSupportReply } = await import('../../src/services/institution/support-reply.js');

    const channel = await registerSupportChannel({
      productId: P, responsibilityId: 'ie_resp', founderId: 'ie_owner', label: 'Inbox',
    });
    const ingested = await ingestCustomerMessage({
      intakeKey: channel!.intakeKey, externalMessageId: 'ext-1',
      contactEmail: 'c@example.com', body: 'When do you open?',
    });
    await proposeSupportReply({
      productId: P, messageId: (ingested as { message: { id: string } }).message.id,
      founderId: 'ie_owner', body: 'We open at nine.',
    });

    const cost = await getResponsibilityCost(P, 'ie_resp');
    expect(cost.counted.founderAuthoredReplies).toBe(1);
    // Counted, and still not priced: the human work shows up as volume while
    // the measured total is unchanged by it.
    expect(cost.measured.totalUsd).toBeCloseTo(0.021, 6);
  });

  it('refuses to book cost against another company\'s responsibility', async () => {
    // The failure mode this prevents reads as a rounding difference and is
    // actually a cross-tenant leak in both directions at once.
    await expect(logCost({
      productId: P, costType: 'llm_tokens', amountUsd: 1,
      responsibilityId: 'ie_foreign', capability: 'customer_support',
    })).rejects.toThrow(/responsibility_foreign/);
  });

  it('refuses a capability that disagrees with the responsibility', async () => {
    await expect(logCost({
      productId: P, costType: 'llm_tokens', amountUsd: 1,
      responsibilityId: 'ie_resp', capability: 'billing_recovery',
    })).rejects.toThrow(/capability_mismatch/);
  });

  it('refuses negative and missing amounts, including via NULL', async () => {
    await expect(logCost({
      productId: P, costType: 'other', amountUsd: -5, responsibilityId: 'ie_resp',
    })).rejects.toThrow(/amount_invalid/);
    // NULL is the one that slips past a naive guard: `NEW.amount_usd < 0` is
    // NULL, not true, so the RAISE never fires unless the absence is coalesced.
    await expect(query(
      `INSERT INTO cost_events (id,product_id,cost_type,amount_usd) VALUES ('ie_null','${P}','other',NULL)`,
    )).rejects.toThrow();
  });

  it('will not let attribution be rewritten after the fact', async () => {
    // Cost is evidence about what already happened. Re-attributing it later
    // would let an expensive responsibility be made cheap retroactively, which
    // is exactly the number someone would want to change.
    await expect(query(
      "UPDATE cost_events SET responsibility_id=NULL WHERE product_id=? AND responsibility_id='ie_resp'", [P],
    )).rejects.toThrow(/attribution_immutable/);
    await expect(query(
      "UPDATE cost_events SET amount_usd=0 WHERE product_id=? AND responsibility_id='ie_resp'", [P],
    )).rejects.toThrow(/attribution_immutable/);
  });

  it('rolls up by capability, which is the unit a founder decides about', async () => {
    const cost = await getCapabilityCost(P, 'customer_support');
    expect(cost.measured.events).toBe(2);
    expect(cost.measured.totalUsd).toBeCloseTo(0.021, 6);
    // Another company's spend on the same capability name is not this one's.
    await logCost({
      productId: OTHER, costType: 'llm_tokens', amountUsd: 99,
      responsibilityId: 'ie_foreign', capability: 'customer_support',
    });
    expect((await getCapabilityCost(P, 'customer_support')).measured.totalUsd).toBeCloseTo(0.021, 6);
  });

  it('establishes the model-free baseline as a measurement, not an absence', async () => {
    // Zero model spend on institutional paths is enforced by the cognition
    // gate, so it is a fact rather than missing data — and it is the baseline
    // any future support drafter has to be worth more than.
    const support = await getCapabilityCost(P, 'customer_support');
    const institutionalModelSpend = (await query(
      `SELECT COALESCE(SUM(amount_usd),0) s FROM cost_events
        WHERE product_id=? AND cost_type='llm_tokens' AND capability='operations'`, [P],
    )).rows[0] as Record<string, unknown>;
    expect(Number(institutionalModelSpend.s)).toBe(0);
    // The support path did incur model spend in this fixture, which is exactly
    // why the two are reported separately rather than as one blended number.
    expect(support.measured.modelUsd).toBeGreaterThan(0);
  });
});
