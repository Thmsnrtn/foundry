// =============================================================================
// FOUNDRY — Environment Validation Tests
// =============================================================================

import { describe, it, expect } from 'vitest';

describe('env validation', () => {
  it('test setup provides the credentials suites rely on', () => {
    expect(process.env.TURSO_DATABASE_URL).toBeDefined();
    expect(process.env.CLERK_SECRET_KEY).toBeDefined();
    expect(process.env.STRIPE_SECRET_KEY).toBeDefined();
    expect(process.env.NODE_ENV).toBe('test');
  });

  it('deliberately provides NO model credential', () => {
    // This file sat under src/ where no runner included it, so it never
    // noticed that the global setup stopped installing a fake ANTHROPIC_API_KEY
    // — deliberately. A fake key made otherwise deterministic fallback tests
    // perform real network retries and occasionally time out, and a suite that
    // intends to exercise a model must stub both credential and transport
    // itself. Asserting its ABSENCE is what keeps that decision from being
    // quietly undone.
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(process.env.OPENROUTER_API_KEY).toBeUndefined();
  });
});
