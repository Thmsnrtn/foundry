// =============================================================================
// THE RESERVE QUESTION COMES BACK AT THE TENTH SETTLED SALE.
//
// PENDING 26 asked the owner how much of a refund promise to hold in cash. The
// honest recommendation was to hold all of it "until there is something to
// measure, and to revisit it at the first ten settled sales" — because any
// smaller number chosen before then would be chosen out of the air. Nothing
// brought it back. Ten sales could pass and the reserve would go on reading
// as it did the day nothing had sold.
//
// So the reserve's own sentence says so, once ten sales have settled, with the
// refund count they carry. It decides nothing: the reserve stays all of it,
// and the promise to buyers is not touched.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '8'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  approveListing, recordListing, recordVenueOrder, recordVenueRefund, requestVenueRefund, seedProof2,
} from '../../src/services/venture/proof-2.js';
import { distributableSurplus } from '../../src/services/economy/projection.js';

const OWNER = 'rq_owner';
let X = '';
const sell = (n: number) => recordVenueOrder({ founderId: OWNER, experimentId: X,
  order: { orderRef: `80000000${String(n).padStart(2, '0')}`, paidAt: new Date().toISOString(), grossCents: 1400, feeCents: 158 } });

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_rq', 'rq@example.com', 'Owner']);
  X = (await seedProof2(OWNER)).experimentId;
  await approveListing({ founderId: OWNER, experimentId: X });
  await recordListing({ founderId: OWNER, experimentId: X, url: 'https://www.etsy.com/listing/9988776660/workbook' });
  for (let n = 1; n <= 9; n++) await sell(n);
});

describe('before ten sales have settled', () => {
  it('does not raise the question yet', async () => {
    const s = await distributableSurplus(OWNER);
    expect(s.refundReserve.because).not.toMatch(/ten sales/i);
  });
});

describe('at the tenth', () => {
  it('raises it, with the refunds they carry, and decides nothing', async () => {
    await sell(10);
    await requestVenueRefund({ founderId: OWNER, experimentId: X, orderRef: '8000000003' });
    await recordVenueRefund({ founderId: OWNER, experimentId: X, orderRef: '8000000003',
      refundedAt: new Date().toISOString(), amountCents: 1400 });
    const s = await distributableSurplus(OWNER);
    expect(s.refundReserve.because).toMatch(/ten sales have settled/i);
    expect(s.refundReserve.because).toMatch(/1 of 10 was refunded/);
    expect(s.refundReserve.because).toMatch(/yours to decide/);
    // Still all of it: raising the question changes nothing on its own.
    expect(s.refundReserve.cents).toBe(s.refundExposure.cents);
    expect(s.refundReserve.cents).toBe(9 * 1400);
  });
});
