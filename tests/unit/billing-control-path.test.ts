import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('billing credential ownership', () => {
  it('keeps Stripe SDK mutation out of the founder-facing settings route', () => {
    const source = readFileSync(resolve(__dirname, '../../src/routes/dashboard/settings.ts'), 'utf8');
    expect(source).toContain('createBillingPortalSession');
    expect(source).not.toMatch(/import\(['"]stripe['"]\)|new Stripe|billingPortal\.sessions\.create/);
  });
});
