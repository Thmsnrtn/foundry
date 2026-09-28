// =============================================================================
// WHO CHECKS THE BUYER'S MESSAGES, AND WHEN.
//
// The owner's handoff of 28 September, step 1: "If the venue cannot expose a
// buyer message to Foundry, the owner-facing obligation and seven-day absence
// reading must say exactly who checks it and when. Do not silently certify
// unattended care."
//
// Etsy does not let an app read a shop's messages. The absence reading named
// that only when a READ failed; for a live listing on a shop that read
// perfectly well, a seven-day absence read as fully covered while every buyer
// who wrote on Etsy waited unseen by anybody. So the owner says, once, how
// often he checks them and whether he does while away — his word, recorded as
// his, about the shop it was said of — and the absence reading holds only
// when what he said covers the absence.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'b'.repeat(64);
process.env.FOUNDRY_OWNER_EMAIL = 'care@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { approveListing, recordListing, seedProof2 } from '../../src/services/venture/proof-2.js';
import { absenceReading } from '../../src/services/institution/absence-test.js';

const OWNER = 'care_owner';
const OTHER = 'care_other';
let PRODUCT = '';

const decisions = async (days: number) => (await absenceReading(OWNER, days)).properties
  .find((p) => p.property === 'only_real_decisions')!;
const say = async (everyDays: number, whileAway: boolean, saidBy = `founder:${OWNER}`) => {
  const { sayHowMessagesAreChecked } = await import('../../src/services/venture/findability.js');
  return sayHowMessagesAreChecked({ productId: PRODUCT, provider: 'etsy', everyDays, whileAway, saidBy });
};

beforeAll(async () => {
  await runMigrations();
  for (const id of [OWNER, OTHER]) {
    await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [id, `clerk_${id}`, `${id}@example.com`, id]);
  }
  const X = (await seedProof2(OWNER)).experimentId;
  await approveListing({ founderId: OWNER, experimentId: X });
  PRODUCT = String(((await query('SELECT id FROM products WHERE from_experiment_id = ?', [X])).rows[0] as Record<string, unknown>).id);
  await query(`INSERT INTO company_senses (id, product_id, sense_key, provider, mode, disclosure, provider_account_ref, provider_account_label,
      identity_verified_at, identity_confirmed_at, identity_confirmed_by)
    VALUES ('care_cs',?,'revenue','etsy','real','read only','77770009','ApexMicro',datetime('now'),datetime('now'),?)`, [PRODUCT, `founder:${OWNER}`]);
  await recordListing({ founderId: OWNER, experimentId: X, url: 'https://www.etsy.com/listing/9988776663/workbook' });
});

describe('a live listing whose messages nothing here can read', () => {
  it('does not hold for a week when nobody has said who checks them', async () => {
    const p = await decisions(7);
    expect(p.finding).toBe('DOES_NOT_HOLD');
    expect(p.evidence.join(' ')).toMatch(/Etsy messages .* are not read here, and nobody has said who checks them/);
    expect(p.wouldFixIt.join(' ')).toMatch(/say how often you check Etsy messages/);
  });

  it('holds when he checks them every two days, including while away', async () => {
    expect('refused' in await say(2, true)).toBe(false);
    const p = await decisions(7);
    expect(p.finding).toBe('HOLDS');
    expect(p.evidence.join(' ')).toMatch(/you check Etsy messages .* every 2 days, including while away/);
  });

  it('does not hold when he checks them less often than the absence allows', async () => {
    await say(10, true);
    const p = await decisions(7);
    expect(p.finding).toBe('DOES_NOT_HOLD');
    expect(p.evidence.join(' ')).toMatch(/every 10 days/);
  });

  it('does not hold when he does not check them while away', async () => {
    await say(1, false);
    const p = await decisions(7);
    expect(p.finding).toBe('DOES_NOT_HOLD');
    expect(p.evidence.join(' ')).toMatch(/not while you are away/);
  });
});

describe('what he said is his, and about this shop', () => {
  it('nobody else can say it, and nothing is accepted outside a day to a month', async () => {
    expect('refused' in await say(2, true, `founder:${OTHER}`)).toBe(true);
    expect('refused' in await say(2, true, 'institution')).toBe(true);
    expect('refused' in await say(0, true)).toBe(true);
    expect('refused' in await say(31, true)).toBe(true);
  });

  it('is kept as said', async () => {
    await expect(query(`UPDATE venue_care_checks SET every_days = 1`)).rejects.toThrow(/said_is_said/);
  });

  it('does not carry to a different shop', async () => {
    await say(1, true);
    expect((await decisions(7)).finding).toBe('HOLDS');
    await query(`UPDATE company_senses SET disconnected_at = datetime('now'), disconnect_reason = 'another shop' WHERE id = 'care_cs'`);
    await query(`INSERT INTO company_senses (id, product_id, sense_key, provider, mode, disclosure, provider_account_ref, provider_account_label,
        identity_verified_at, identity_confirmed_at, identity_confirmed_by)
      VALUES ('care_cs2',?,'revenue','etsy','real','read only','88880009','OtherShop',datetime('now'),datetime('now'),?)`, [PRODUCT, `founder:${OWNER}`]);
    const p = await decisions(7);
    expect(p.finding).toBe('DOES_NOT_HOLD');
    expect(p.evidence.join(' ')).toMatch(/nobody has said who checks them/);
  });
});

describe('the asset\'s own record says it too', () => {
  it('names the arrangement, or its absence, in what is owed and in what is his', async () => {
    const { sayHowMessagesAreChecked } = await import('../../src/services/venture/findability.js');
    await sayHowMessagesAreChecked({ productId: PRODUCT, provider: 'etsy', everyDays: 3, whileAway: true, saidBy: `founder:${OWNER}` });
    const { operatingContractOf } = await import('../../src/services/venture/operating-contract.js');
    const c = (await operatingContractOf(PRODUCT, OWNER))!;
    expect(c.answers[4].answer).toMatch(/you check them every 3 days, including while away/);
    expect(c.answers[6].answer).toMatch(/checking Etsy messages every 3 days/);
  });
});
