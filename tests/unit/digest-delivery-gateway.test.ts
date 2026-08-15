import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../../src/services/outbound/gateway.js', () => ({
  invoke,
  registerToolHandler: vi.fn(),
}));
vi.mock('../../src/services/integration/resend.js', () => ({}));

import { sendTriggerEmail } from '../../src/services/digest/delivery.js';

beforeEach(() => invoke.mockReset());

describe('digest delivery governed boundary', () => {
  it('supplies company, customer, and stable dedup facts without declaring its own classification', async () => {
    invoke.mockResolvedValue({ ok: true, invocation_id: 'i1', cached: false, result: { id: 'email' } });
    await sendTriggerEmail('p1', 'founder@example.com', 'stuck', 'Subject', '<p>Body</p>');
    const request = invoke.mock.calls[0][0];
    expect(request).toMatchObject({
      productId: 'p1', tool: 'send_email',
      customerExternalId: 'founder@example.com',
    });
    expect(request.dedupKey).toMatch(/^trigger:stuck:p1:\d{4}-\d{2}-\d{2}:/);
    expect(request).not.toHaveProperty('surface');
    expect(request).not.toHaveProperty('dataClass');
  });

  it('propagates a policy refusal instead of reporting delivery', async () => {
    invoke.mockResolvedValue({ ok: false, invocation_id: 'i2', phase: 'budget', reason: 'cap reached' });
    await expect(sendTriggerEmail('p1', 'founder@example.com', 'stuck', 'Subject', 'Body'))
      .rejects.toThrow('email refused at budget: cap reached');
  });
});
