import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../../src/services/outbound/gateway.js', () => ({
  invoke,
  registerToolHandler: vi.fn(),
}));
vi.mock('../../src/services/integration/resend.js', () => ({}));

import { sendDigestEmail } from '../../src/services/digest/delivery.js';

beforeEach(() => invoke.mockReset());

describe('digest delivery governed boundary', () => {
  // THESE TWO RAN THROUGH `sendTriggerEmail`, WHICH IS RETIRED. It existed only
  // for the Commercial Foundry activation funnel — connect your GitHub, select
  // a repository — and went with it. The two invariants it was standing in for
  // are not about triggers at all: every outbound email goes through the
  // gateway, declares no classification of its own, and reports a refusal as a
  // refusal rather than as delivery. `sendDigestEmail` uses the same door, so
  // they are asserted there instead of deleted with the function.
  const digest = {
    digest_type: 'weekly', narrative: 'a week', competitive_context: null,
    stressor_report: null,
    risk_state: { state: 'green', reason: 'nothing is wrong' },
    mrr: { level_cents: 1000, net_new_cents: 0 },
    mrr_health: { value: null },
    metrics: { signups_7d: 1, active_users: 2, activation_rate: null },
  } as never;

  it('supplies company and customer facts without declaring its own classification', async () => {
    invoke.mockResolvedValue({ ok: true, invocation_id: 'i1', cached: false, result: { id: 'email' } });
    await sendDigestEmail('p1', 'founder@example.com', 'A company', digest);
    const request = invoke.mock.calls[0][0];
    expect(request).toMatchObject({
      productId: 'p1', tool: 'send_email',
      customerExternalId: 'founder@example.com',
    });
    // A dedup key that changes with the day and the content, so the same digest
    // cannot be sent twice and a different one is not mistaken for it.
    expect(request.dedupKey).toMatch(/^digest:weekly:p1:\d{4}-\d{2}-\d{2}:/);
    // THE INVARIANT THAT MATTERS MOST: the sender does not get to say how
    // sensitive its own message is, or which surface it counts as. Those are
    // the gateway's to decide, and a caller that could declare them could
    // declare its way past them.
    expect(request).not.toHaveProperty('surface');
    expect(request).not.toHaveProperty('dataClass');
  });

  it('propagates a policy refusal instead of reporting delivery', async () => {
    invoke.mockResolvedValue({ ok: false, invocation_id: 'i2', phase: 'budget', reason: 'cap reached' });
    await expect(sendDigestEmail('p1', 'founder@example.com', 'A company', digest))
      .rejects.toThrow('email refused at budget: cap reached');
  });
});
