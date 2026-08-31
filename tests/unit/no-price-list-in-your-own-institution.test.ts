process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// NO PRICE LIST IN YOUR OWN INSTITUTION.
//
// Settings showed the owner of a permanent private deployment: "Tier: Free",
// "Current Plan: No Plan", three checkout buttons at $79/$199/$399, and — the
// worst line in the product — "You have access to 0 features."
//
// He owns the institution outright. Nothing there is for sale to him, and the
// sentence is not even true: posture already grants him everything.
//
// Suppressed by posture, not deleted. Stripe, checkout, the customer portal and
// every price stay exactly where they are, because a private institution
// operates businesses that bill THEIR customers, and one of those may one day
// be a commercial Foundry. A commercial deployment still renders all of it.
// =============================================================================

const OWNER = 'set_owner';
let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
    [OWNER, 'c_set', 'owner@example.com']);
  const mod = await import('../../src/routes/dashboard/settings.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder', { id: OWNER, email: 'owner@example.com' }); await next(); });
  for (const v of Object.values(mod)) {
    if (v && typeof v === 'object' && 'routes' in (v as object)) app.route('/', v as never);
  }
});
afterEach(() => { delete process.env.FOUNDRY_INSTANCE_POSTURE; });

const settings = async (): Promise<string> => (await app.request('/settings')).text();

describe('the owner is not sold access to what he owns', () => {
  it('shows no plan, price or feature count in a private institution', async () => {
    process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
    const body = await settings();
    expect(body).not.toContain('Current Plan');
    expect(body).not.toContain('You have access to');
    for (const price of ['$79', '$199', '$399']) expect(body, price).not.toContain(price);
  });

  it('still shows all of it on a commercial deployment', async () => {
    process.env.FOUNDRY_INSTANCE_POSTURE = 'commercial';
    const body = await settings();
    expect(body, 'suppressed for the owner, not deleted from the product')
      .toContain('Current Plan');
  });

  it('keeps checkout reachable in code either way', async () => {
    // The capability is preserved behind the posture, not removed: a commercial
    // Foundry would need every line of it.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(import.meta.dirname, '../../src/routes/dashboard/settings.ts'), 'utf8');
    expect(src).toContain("action=\"/checkout\"");
    expect(src).toContain('manage-subscription');
  });
});
