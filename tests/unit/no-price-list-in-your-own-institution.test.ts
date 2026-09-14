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
// IT WAS SUPPRESSED BY POSTURE. NOW IT IS DELETED, AND THE REASON CHANGED.
//
// The original judgement was to hide it rather than remove it: Stripe,
// checkout, the customer portal and every price stayed, because a private
// institution operates businesses that bill THEIR customers and one of those
// might one day be a commercial Foundry. That reasoning depended on there
// being a commercial Foundry to sell. There is not. Its pages were deleted,
// its service modules were deleted, and the tables behind the features those
// three plans named — the investor layer, playbooks, cohorts, team mode,
// benchmarks — were dropped in migrations 309 and 311. A checkout preserved
// for a product whose schema is gone is not a preserved capability.
//
// `services/billing/stripe.ts` STAYS and is live: it is how an Apex Micro
// buyer pays and how they are refunded. What went is the SUBSCRIPTION surface —
// `POST /checkout`, `GET /checkout`, `/settings/manage-subscription`, the
// three price buttons and the tier vocabulary that described them.
//
// So the checks below hold the outcome rather than the mechanism: no plan, no
// price, no feature count, in either posture, because there is no longer a
// posture in which any of it is true.
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

  it('shows none of it on a commercial deployment either, because it is gone', async () => {
    // This asserted the opposite — that a commercial deployment still rendered
    // "Current Plan", so the suppression was a posture rather than a deletion.
    // The product those plans admitted you to no longer exists.
    process.env.FOUNDRY_INSTANCE_POSTURE = 'commercial';
    const body = await settings();
    expect(body).not.toContain('Current Plan');
    for (const price of ['$79', '$199', '$399']) expect(body, price).not.toContain(price);
  });

  it('keeps the billing that has customers, and none of the billing that does not', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const here = (rel: string) =>
      readFileSync(resolve(import.meta.dirname, '../../src', rel), 'utf8');

    // The subscription surface: gone, handlers and all.
    const src = here('routes/dashboard/settings.ts');
    expect(src).not.toContain('action="/checkout"');
    expect(src).not.toContain('manage-subscription');

    // The billing a real buyer touches: still here. Apex Micro charges a card
    // for a piece of work and refunds it on request, and that is a different
    // thing from a monthly plan.
    const stripe = here('services/billing/stripe.ts');
    expect(stripe).toMatch(/refund/i);
  });
});
