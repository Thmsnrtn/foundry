// =============================================================================
// REHEARSAL C: THE OWNER IS AWAY WHILE A BUYER WAITS ON HIM.
//
// Integrated plan §9: "Thomas is away while a buyer needs a remedy.
// Deterministic deadlines, existing duties, retry and reconciliation continue
// as far as qualified capabilities permit. Suppress unsupported … 'all clear'
// claims. Stop unsafe new commitments before sacrificing existing customer
// care. State exactly where a human backstop is required."
//
// The pieces are proved one at a time elsewhere: the hand holds new offers
// (`the-first-real-experiment-runs-by-hand`), the absence reading will not
// read calm (`a-buyer-waiting-is-not-a-quiet-absence`), the Brief leads with
// the refund (`the-three-journeys-the-plan-names`). What none of them shows is
// TIME: that on day 1, day 7 and day 30 of his absence the buyer is still
// there, still his, still named with where to act, and never aged into
// silence. And that the wait ends only when the refund is actually recorded.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'away@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  approveListing, recordListing, recordVenueOrder, recordVenueRefund, requestVenueRefund, seedProof2,
} from '../../src/services/venture/proof-2.js';
import { absenceReading } from '../../src/services/institution/absence-test.js';
import { buyersWaitingOnHim } from '../../src/services/venture/obligations.js';

const OWNER = 'away_owner';
const DAY = 86_400_000;
const LEFT = new Date();
let X = '';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_away', 'away@example.com', 'Owner']);
  X = (await seedProof2(OWNER)).experimentId;
  await approveListing({ founderId: OWNER, experimentId: X });
  await recordListing({ founderId: OWNER, experimentId: X, url: 'https://www.etsy.com/listing/9988776657/bid-decision-workbook' });
  await recordVenueOrder({ founderId: OWNER, experimentId: X,
    order: { orderRef: '6000000001', paidAt: LEFT.toISOString(), grossCents: 1400, feeCents: 158 } });
  // The day he leaves, the buyer asks for their money back on Etsy.
  await requestVenueRefund({ founderId: OWNER, experimentId: X, orderRef: '6000000001' });
});

describe('while he is away, the buyer does not age into silence', () => {
  for (const d of [1, 7, 30]) {
    it(`on day ${String(d)}, the buyer is still his, named with where to act`, async () => {
      const now = new Date(LEFT.getTime() + d * DAY);
      const waiting = await buyersWaitingOnHim(OWNER, now);
      expect(waiting).toHaveLength(1);
      expect(waiting[0].sentence).toMatch(/Etsy/);
      expect(waiting[0].sentence).toMatch(/6000000001/);
    });

    it(`on day ${String(d)}, no reading of his absence says all clear`, async () => {
      const now = new Date(LEFT.getTime() + d * DAY);
      const r = await absenceReading(OWNER, 14, now);
      expect(r.properties.find((p) => p.property === 'only_real_decisions')!.finding).toBe('DOES_NOT_HOLD');
      expect(r.verdict).not.toMatch(/all clear|nothing needs you/i);
    });
  }

  it('invents no deadline it does not have', async () => {
    const r = await absenceReading(OWNER, 14, new Date(LEFT.getTime() + 7 * DAY));
    expect(r.properties.find((p) => p.property === 'only_real_decisions')!.evidence.join(' '))
      .toMatch(/no deadline is on record/i);
  });
});

describe('the wait ends only when the refund is actually recorded', () => {
  it('clears once he records the refund, and not before', async () => {
    const now = new Date(LEFT.getTime() + 8 * DAY);
    expect(await buyersWaitingOnHim(OWNER, now)).toHaveLength(1);
    // A refund is recorded when it happened, which cannot be in the future:
    // the clock in the readers is simulated, the one in the record is not.
    await recordVenueRefund({ founderId: OWNER, experimentId: X, orderRef: '6000000001',
      refundedAt: new Date().toISOString(), amountCents: 1400 });
    expect(await buyersWaitingOnHim(OWNER, new Date(now.getTime() + 60_000))).toHaveLength(0);
    const r = await absenceReading(OWNER, 14, new Date(now.getTime() + 60_000));
    expect(r.properties.find((p) => p.property === 'only_real_decisions')!.evidence.join(' '))
      .not.toMatch(/a buyer is owed/);
  });
});
