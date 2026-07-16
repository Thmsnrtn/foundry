// =============================================================================
// Tests: Outbound webhook HMAC signature (entropy-pass finding, 2026-07-14)
// The X-Foundry-Signature header was sent EMPTY — a signature that proved
// nothing. It now carries a real HMAC-SHA256 a receiver can verify.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { signWebhookBody } from '../../src/services/distribution/outbound-webhooks.js';

describe('webhook signing', () => {
  it('produces a verifiable sha256= HMAC over the exact body', () => {
    const secret = 'whsec_founder_123';
    const body = JSON.stringify({ event: 'decision_needed', id: 'd_1' });
    const sig = signWebhookBody(secret, body);

    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    // A receiver recomputes the same HMAC and compares — this is that check.
    const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    expect(sig).toBe(expected);
  });

  it('is sensitive to body tampering and to the secret', () => {
    const body = '{"a":1}';
    expect(signWebhookBody('s1', body)).not.toBe(signWebhookBody('s1', '{"a":2}')); // body changed
    expect(signWebhookBody('s1', body)).not.toBe(signWebhookBody('s2', body));      // secret changed
  });
});
