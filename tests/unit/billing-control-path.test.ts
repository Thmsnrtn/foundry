import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The founder-facing settings route never held a Stripe credential or mutated
// Stripe itself; it called the billing module. Since Private S7b1 (29 September
// 2026) there is no billing module — nobody pays for access to the owner's own
// institution — so the route holds no billing at all, and must not grow any.
describe('billing credential ownership', () => {
  it('keeps Stripe out of the founder-facing settings route entirely', () => {
    const source = readFileSync(resolve(__dirname, '../../src/routes/dashboard/settings.ts'), 'utf8');
    expect(source).not.toMatch(/services\/billing\/stripe|createBillingPortalSession|createCheckoutSession/);
    expect(source).not.toMatch(/import\(['"]stripe['"]\)|new Stripe|billingPortal\.sessions\.create/);
  });
});
