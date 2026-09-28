// =============================================================================
// A SALE NAMES WHO TOOK THE FEE, AND WHAT ITS MARGIN LEAVES OUT.
//
// Roadmap D4. The money page lists every sale with "Stripe took …", and the
// gross line reads "before Stripe took anything" — written when Stripe was the
// only way anything was paid. The first real venue is Etsy, so the first real
// sale would have shown Etsy's fee as Stripe's: the wrong company named on
// the one line the owner reads to check the margin.
//
// And the margin says what it subtracts and never what it does not: what it
// cost to be found beyond the provider's fees, and the owner's own time, which
// he now enters in minutes (D6) and which has no price here. Unknown inputs are
// named as unknown, never silently left out.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'fee@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { approveListing, recordListing, recordVenueOrder, seedProof2 } from '../../src/services/venture/proof-2.js';

const OWNER = 'fee_owner';
let X = '';
let app: Hono;
const page = async () => (await (await app.request('/foundry/money')).text())
  .replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ');

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_fee', 'fee@example.com', 'Owner']);
  X = (await seedProof2(OWNER)).experimentId;
  await approveListing({ founderId: OWNER, experimentId: X });
  await recordListing({ founderId: OWNER, experimentId: X, url: 'https://www.etsy.com/listing/9988776662/workbook' });
  await recordVenueOrder({ founderId: OWNER, experimentId: X,
    order: { orderRef: '8200000001', paidAt: new Date().toISOString(), grossCents: 1400, feeCents: 158 } });
  const { moneyRoutes } = await import('../../src/routes/dashboard/money-place.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'fee@example.com' } as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', moneyRoutes);
});

describe('who took the fee', () => {
  it('names Etsy on an Etsy sale, and never Stripe', async () => {
    const t = await page();
    expect(t).toMatch(/Etsy took \$1\.58/);
    expect(t).not.toMatch(/Stripe took/);
    expect(t).not.toMatch(/before Stripe took/);
  });
});

describe('what the margin leaves out', () => {
  it('names what it cost to be found, and his time as not entered', async () => {
    const t = await page();
    expect(t).toMatch(/Not counted in what was left/);
    expect(t).toMatch(/what it cost to be found/);
    expect(t).toMatch(/your own time.*not entered/i);
  });

  it('gives his time in minutes once he has entered some, with no price put on it', async () => {
    const { recordOwnerMinutes } = await import('../../src/services/venture/owner-minutes.js');
    await recordOwnerMinutes({ founderId: OWNER, experimentId: X, onDay: new Date().toISOString().slice(0, 10), minutes: 40, what: null });
    const t = await page();
    expect(t).toMatch(/your own time: 40 minutes entered/i);
    expect(t).toMatch(/no price is put on it/);
  });
});
