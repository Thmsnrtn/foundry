// =============================================================================
// FOUNDRY — Environment Validation Tests
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest';

describe('env validation', () => {
  it('test setup provides required env vars', () => {
    expect(process.env.TURSO_DATABASE_URL).toBeDefined();
    expect(process.env.CLERK_SECRET_KEY).toBeDefined();
    expect(process.env.ANTHROPIC_API_KEY).toBeDefined();
    expect(process.env.STRIPE_SECRET_KEY).toBeDefined();
    expect(process.env.NODE_ENV).toBe('test');
  });
});
