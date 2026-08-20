process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, it, expect, beforeAll, vi } from 'vitest';

// =============================================================================
// WHAT THE ACT BRANCH DOES, WHEN SOMETHING LETS IT RUN.
//
// `customer_success` is capped at 'suggest' by the platform (`platform-cap.ts`)
// because it reaches third parties by the same post as outreach, and a send
// puts the founder's domain, reputation and liability behind the message.
// That cap is an owner-controlled ceiling, and it makes the department's act
// branch — consent gate, execution, declared success criteria, attribution
// trail — unreachable in production today.
//
// UNREACHABLE IS NOT UNTESTED, AND IT IS NOT DEAD. The cap can be lifted by the
// owner, and the branch is what would then run. So the ceiling is hypothesised
// HERE, in one file that says so in its name, and nowhere else: the real cap is
// pinned by `protective-wrapper.test.ts` and `success-department.test.ts`, both
// of which assert 'suggest' against the real module.
//
// The mock replaces the CEILING ONLY. The consent gate, the criteria and the
// attribution trail below are the real ones, and the first assertion is that
// consent still governs even with the ceiling out of the way — because a
// ceiling and a permission are different things and the whole defect this
// campaign keeps finding is one standing in for the other.
// =============================================================================

vi.mock('../../src/services/autopilot/platform-cap.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/services/autopilot/platform-cap.js')>();
  const lifted = (category: string) =>
    (category === 'customer_success' ? 'act' : real.platformCap(category));
  return {
    ...real,
    platformCap: lifted,
    effectiveMode: (configured: 'shadow' | 'suggest' | 'act', category: string) => {
      const rank = { shadow: 0, suggest: 1, act: 2 } as const;
      const cap = lifted(category) as 'shadow' | 'suggest' | 'act';
      return rank[configured] <= rank[cap] ? configured : cap;
    },
  };
});

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { setPolicy } from '../../src/services/autopilot/policy.js';
import { hasActConsent } from '../../src/services/autopilot/consent.js';
import { registerToolHandler } from '../../src/services/outbound/gateway.js';
import { SEND_EMAIL_POLICY } from '../../src/services/integration/resend.js';

// The department's send now goes through the ONE governed boundary rather than
// a draft-only stub that returned success. So a provider has to be standing
// there for the act path to complete — which is itself the point: without one,
// nothing is sent and nothing may say it was.
let dispatched = 0;
const provider = (ok: boolean) => registerToolHandler(
  'send_email',
  async () => { if (!ok) throw new Error('provider down'); dispatched += 1; return { message_id: 'm1' }; },
  SEND_EMAIL_POLICY,
);

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('lc_f','clk_lc','lc@t.co')", []);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES ('lc_p','LiftCo','lc_f','active')", []);
  await query(
    `INSERT INTO customers (id, product_id, owner_id, name, email, churn_risk, health_score, last_active_at)
     VALUES ('lc_c1','lc_p','lc_f','Risk','risk@cust.co',0.9,0.3,?)`,
    [new Date(Date.now() - 20 * 86_400_000).toISOString()],
  );
});

describe('with the ceiling hypothetically lifted', () => {
  it('still refuses to act without a live recorded consent', async () => {
    await query("INSERT INTO autopilot_policies (id, product_id, category, mode) VALUES ('lc_pol','lc_p','customer_success','act')", []);
    await query("UPDATE autonomy_consents SET revoked_at=CURRENT_TIMESTAMP WHERE product_id='lc_p' AND capability='customer_success'", []);
    expect(await hasActConsent('lc_p', 'customer_success')).toBe(false);

    const { runSuccessSweep } = await import('../../src/services/departments/success.js');
    const res = await runSuccessSweep('lc_p');
    expect(res.sent, 'a ceiling is not a permission').toBe(0);
    expect(res.proposed).toBe(1);
  });

  it('does not call a refused send a send', async () => {
    // The boundary refuses when the handler throws — no sender of record, a
    // paused company, a provider outage. This used to be counted as `sent`
    // regardless, with an attribution entry saying Foundry had written to the
    // customer on the founder's behalf. A refused effect is a proposal that did
    // not happen.
    await query("DELETE FROM action_executions WHERE product_id='lc_p'", []);
    await query("DELETE FROM audit_log WHERE product_id='lc_p'", []);
    provider(false);
    await setPolicy('lc_p', 'customer_success', 'suggest', 'lc_f');
    await setPolicy('lc_p', 'customer_success', 'act', 'lc_f');

    const { runSuccessSweep } = await import('../../src/services/departments/success.js');
    const res = await runSuccessSweep('lc_p');
    expect(res.sent, 'nothing reached anybody').toBe(0);
    expect(res.proposed).toBe(1);

    const attribution = await query(
      `SELECT id FROM audit_log WHERE product_id='lc_p' AND action_type='attribution:customer_success'`, [],
    );
    expect(attribution.rows, 'nothing acted, so nothing is attributed').toEqual([]);
  });

  it('acts under consent, and the act is attributable to it', async () => {
    await query("DELETE FROM action_executions WHERE product_id='lc_p'", []); // clear dedup
    await query("DELETE FROM audit_log WHERE product_id='lc_p'", []);
    dispatched = 0;
    provider(true);
    // A realistic transition INTO act from below is what records fresh consent.
    await setPolicy('lc_p', 'customer_success', 'suggest', 'lc_f');
    await setPolicy('lc_p', 'customer_success', 'act', 'lc_f');
    expect(await hasActConsent('lc_p', 'customer_success')).toBe(true);

    const { runSuccessSweep } = await import('../../src/services/departments/success.js');
    const res = await runSuccessSweep('lc_p');
    expect(res.sent).toBe(1);
    expect(dispatched, 'and something actually reached the provider').toBe(1);

    const attribution = (await query(
      `SELECT reasoning, input_context FROM audit_log
        WHERE product_id='lc_p' AND action_type='attribution:customer_success'`, [],
    )).rows as unknown as Array<Record<string, string>>;
    expect(attribution).toHaveLength(1);
    expect(String(attribution[0].reasoning))
      .toMatch(/on the founder's behalf under consent/);
    // The trail names the consent it acted under, not merely that one existed.
    expect(String(attribution[0].input_context)).toContain('consent_id');

    const exec = (await query(
      `SELECT status, approved_by FROM action_executions WHERE product_id='lc_p'`, [],
    )).rows[0] as Record<string, string>;
    expect(exec.status).toBe('completed');
    expect(exec.approved_by, 'the acting principal, not a role label')
      .toBe('autopilot:customer_success');
  });

  it('declares what success means before the consequences arrive', async () => {
    const criteria = (await query(
      `SELECT verify_criteria, verify_status, verify_after FROM action_executions
        WHERE product_id='lc_p'`, [],
    )).rows[0] as Record<string, string>;
    expect(String(criteria.verify_criteria)).toContain('customer_health_not_worse');
    expect(String(criteria.verify_criteria)).toContain('provider_accepted');
    expect(criteria.verify_status, 'declared before the outcome, not after').toBe('pending');
    expect(criteria.verify_after).toBeTruthy();
    // The health baseline is the customer's health AT THE TIME OF THE ACT. A
    // criterion that reads the value after the fact could never fail.
    const parsed = JSON.parse(String(criteria.verify_criteria)) as Array<Record<string, unknown>>;
    const health = parsed.find((c) => c.kind === 'customer_health_not_worse');
    expect(health?.baseline_health).toBe(0.3);
    expect(health?.customer_id).toBe('lc_c1');
  });
});
