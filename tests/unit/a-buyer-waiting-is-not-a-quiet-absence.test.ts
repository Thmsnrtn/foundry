// =============================================================================
// A BUYER WAITING IS NOT A QUIET ABSENCE.
//
// Two source findings from the Gate 1 review, both reproduced at HEAD:
//
//   · absence-test.ts counted a buyer owed something only the owner can give
//     as "waiting" and never as compromised, so the horizon read HOLDS — "all
//     of them would still be there when you got back" — while the property's
//     own wouldFixIt said "settle it before you go". A buyer is not a proposal
//     that waits harmlessly; the buyer waits too, on a provider's clock this
//     institution does not hold.
//   · winding-down.ts filed every dispute under "the buyer's bank", whatever
//     the channel. An Etsy buyer opens a case with Etsy, and the one who must
//     answer it is the owner, there.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'b'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'thomas@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  approveListing, recordListing, recordVenueOrder, requestVenueRefund, seedProof2,
} from '../../src/services/venture/proof-2.js';
import { absenceReading } from '../../src/services/institution/absence-test.js';
import { howThisWouldEnd } from '../../src/services/institution/winding-down.js';

const OWNER = 'aw_owner';
const LISTING = 'https://www.etsy.com/listing/9988776655/bid-decision-workbook';
let X = '';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_aw', 'thomas@example.com', 'Owner']);
  X = (await seedProof2(OWNER)).experimentId;
  await approveListing({ founderId: OWNER, experimentId: X });
  await recordListing({ founderId: OWNER, experimentId: X, url: LISTING });
  for (const ref of ['4000000001', '4000000002']) {
    await recordVenueOrder({ founderId: OWNER, experimentId: X,
      order: { orderRef: ref, paidAt: new Date().toISOString(), grossCents: 1400, feeCents: 158 } });
  }
});

const decisions = async () => (await absenceReading(OWNER, 30)).properties
  .find((p) => p.property === 'only_real_decisions')!;

describe('an owed venue refund makes the absence unsafe, not calm', () => {
  it('holds while nobody is owed anything', async () => {
    const p = await decisions();
    expect(p.evidence.join(' ')).not.toContain('a buyer is owed');
  });

  it('does not hold once a buyer asks for their money back on the venue', async () => {
    await requestVenueRefund({ founderId: OWNER, experimentId: X, orderRef: '4000000001' });
    const p = await decisions();
    expect(p.finding, 'a waiting buyer read as a decision that waits harmlessly').toBe('DOES_NOT_HOLD');
    expect(p.sentence).not.toContain('would still be there when you got back');
    expect(p.sentence).toMatch(/buyer/);
  });

  it('says it knows no deadline rather than inventing one', async () => {
    const p = await decisions();
    expect(p.evidence.join(' ')).toMatch(/no deadline is on record/i);
  });

  it('still lists it as something to settle before going', async () => {
    const p = await decisions();
    expect(p.wouldFixIt.join(' ')).toMatch(/before you go/);
  });

  it('with the shop reader failing too, neither property reads calm', async () => {
    await query('INSERT OR IGNORE INTO products (id,name,owner_id,status) VALUES (?,?,?,?)',
      ['p_aw', 'Apex Micro', OWNER, 'active']);
    await query(
      `INSERT INTO company_senses (id, product_id, sense_key, provider, mode, disclosure, last_error)
       VALUES ('cs_aw', 'p_aw', 'revenue', 'etsy', 'real', 'read only', 'Etsy answered 503')`);
    const truthful = (await absenceReading(OWNER, 30)).properties.find((p) => p.property === 'truthful')!;
    expect(truthful.finding, 'a failing shop reader read as a truthful absence').not.toBe('HOLDS');
    const r = await absenceReading(OWNER, 30);
    expect(r.verdict).not.toMatch(/all clear|nothing needs you/i);
    expect(r.properties.find((p) => p.property === 'only_real_decisions')!.finding).toBe('DOES_NOT_HOLD');
  });
});

describe('a dispute is answered where it was opened', () => {
  it('sends an Etsy case to the owner on Etsy, never to "the buyer\'s bank"', async () => {
    await query(`UPDATE experiment_fulfilments SET disputed_at = datetime('now') WHERE payment_ref = '4000000002'`);
    const w = await howThisWouldEnd(OWNER);
    const d = w.itCannotSettle.find((e) => /case|dispute|chargeback/i.test(e.because));
    expect(d, 'the dispute is missing from what a wind-down cannot settle').toBeDefined();
    expect(d!.whose).toBe('you');
    expect(d!.because).toMatch(/Etsy/);
    expect(JSON.stringify(w)).not.toContain('buyer\'s bank');
  });
});

// GATE 1, CASE 4: A VENUE ORDER'S FILE IS AVAILABLE BY THE VENUE'S RULE; NOBODY
// HERE SAW IT COLLECTED. It was recorded as a `delivery` — "what they paid for
// reached them" — at the payment's own time.
describe('what a venue order says about delivery', () => {
  it('records availability by the venue\'s rule, not an observed delivery', async () => {
    const r = (await query(
      `SELECT kind FROM business_outcome_events WHERE provider_event_ref = '4000000001:download-available'`))
      .rows[0] as Record<string, unknown>;
    expect(String(r.kind)).toBe('made_available');
  });

  it('says so when it describes the exchange', async () => {
    const { closureSentence } = await import('../../src/services/venture/outcome.js');
    const s = closureSentence({ cents: 1400, venue: 'Etsy', settled: true });
    expect(s).toMatch(/Etsy makes the file available on payment/);
    expect(s).toMatch(/download itself is not observed/);
    expect(s).not.toMatch(/received what they paid for/);
    expect(closureSentence({ cents: 500, venue: null, settled: true })).toMatch(/received what they paid for/);
  });
});
