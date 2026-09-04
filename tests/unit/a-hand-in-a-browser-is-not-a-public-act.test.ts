process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { consequenceAllows } from '../../src/services/institution/consequence.js';
import {
  allowanceFor, recordMoneySpent, setAllowance,
} from '../../src/services/institution/standing-intent.js';

// =============================================================================
// A HAND IN A BROWSER IS NOT A PUBLIC ACT, AND A METER THAT COUNTS TOKENS IS
// NOT A METER FOR MONEY.
//
// Two holes that were harmless only because nothing could yet spend or click.
//
//   `act_in_a_browser` sat at the `public` rung and was waved through — and
//   pressing a button on a site is how one accepts terms, creates an account in
//   the institution's name, or authorises a payment. The rung was attached to
//   the capability; consequence belongs to the act.
//
//   `allowanceFor()` counted spend from `ai_daily_spend`, so an allowance
//   depleted when Foundry THOUGHT and never when it SPENT, while
//   `consequenceAllows` authorised the entire financial rung against what was
//   left of it. One counter for two quantities, measuring the cheaper one.
// =============================================================================

const OWNER = 'rung_owner';
const PRODUCT = 'rung_product';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_rung', 'owner@example.com', 'Owner']);
  await query(
    `INSERT INTO products (id, name, owner_id, status, reality)
     VALUES (?,'Asset',?,'active','real')`, [PRODUCT, OWNER]);
  // A browser tool bound to the browsing capability, and a spending one.
  await query(
    `INSERT INTO capability_providers
       (id, capability_key, provider, how, tool, cost_note, maturity, sort_order)
     VALUES ('cp_test_browser','act_in_a_browser','test','browser','test_browser',
             'none','declared',99)`, []);
  await query(
    `INSERT INTO capability_providers
       (id, capability_key, provider, how, tool, cost_note, maturity, sort_order)
     VALUES ('cp_test_domain','register_domain','test','api','test_register_domain',
             'none','declared',99)`, []);
});

describe('a browser act names itself, and the higher rung governs', () => {
  it('refuses a browser act that will not say what it is', async () => {
    const v = await consequenceAllows({
      productId: PRODUCT, tool: 'test_browser', paramsFingerprint: null });
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain('did not say which');
  });

  it('lets reading a page through, because reading is observing', async () => {
    const v = await consequenceAllows({
      productId: PRODUCT, tool: 'test_browser', paramsFingerprint: null,
      browserAct: 'read_only' });
    expect(v.allowed).toBe(true);
  });

  it('will not absorb accepting somebody\'s terms into ordinary authority', async () => {
    const v = await consequenceAllows({
      productId: PRODUCT, tool: 'test_browser', paramsFingerprint: null,
      browserAct: 'accept_terms' });
    expect(v.allowed).toBe(false);
    expect(v.rung).toBe('legal');
    // And no allowance can buy it: the legal rung is not absorbable.
    await setAllowance({ productId: PRODUCT, statement: 'up to $50 setting this up',
      amountCents: 5000, purpose: 'setup' });
    const again = await consequenceAllows({
      productId: PRODUCT, tool: 'test_browser', paramsFingerprint: null,
      browserAct: 'accept_terms' });
    expect(again.allowed).toBe(false);
  });

  it('refuses a kind of act nothing has classified', async () => {
    const v = await consequenceAllows({
      productId: PRODUCT, tool: 'test_browser', paramsFingerprint: null,
      browserAct: 'wire_the_money' });
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain('nothing says what kind of act');
  });
});

describe('an act that spends money says how much, against a meter that counts it', () => {
  it('refuses a spending act that never said what it would cost', async () => {
    const v = await consequenceAllows({
      productId: PRODUCT, tool: 'test_register_domain', paramsFingerprint: null });
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain('an act that spends your money has to say how much');
  });

  it('allows what the allowance covers', async () => {
    const v = await consequenceAllows({
      productId: PRODUCT, tool: 'test_register_domain', paramsFingerprint: null,
      estimatedCents: 1200 });
    expect(v.allowed).toBe(true);
  });

  it('refuses an act larger than what is left, rather than any act at all', async () => {
    const v = await consequenceAllows({
      productId: PRODUCT, tool: 'test_register_domain', paramsFingerprint: null,
      estimatedCents: 900_00 });
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain('is left of what you allowed');
  });

  it('depletes when real money leaves, not only when the model thinks', async () => {
    const before = await allowanceFor(PRODUCT);
    expect(before?.remainingCents).toBe(5000);
    await recordMoneySpent({ productId: PRODUCT, tool: 'test_register_domain',
      amountCents: 4200, source: 'settled' });
    const after = await allowanceFor(PRODUCT);
    expect(after?.spentCents).toBe(4200);
    expect(after?.remainingCents).toBe(800);
    // And the act that no longer fits is refused on the number, not on a guess.
    const v = await consequenceAllows({
      productId: PRODUCT, tool: 'test_register_domain', paramsFingerprint: null,
      estimatedCents: 1200 });
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain('$8.00 is left');
  });

  it('nets off a reversal rather than editing the ledger', async () => {
    await expect(query(
      'UPDATE asset_money_spent SET amount_cents = 0 WHERE product_id = ?', [PRODUCT]))
      .rejects.toThrow(/asset_money:append_only/);
    await recordMoneySpent({ productId: PRODUCT, tool: 'test_register_domain',
      amountCents: 4200, source: 'reversed' });
    expect((await allowanceFor(PRODUCT))?.remainingCents).toBe(5000);
  });
});

describe('the financial rung holds two different things', () => {
  it('does not hold up a refund for failing to price a budget it never touches', async () => {
    // `commerce` moves the COMPANY'S money with its customers and does not draw
    // on the allowance he set. Requiring an amount of it was the wrong scope,
    // and the suite said so by refusing a refund.
    await query(
      `INSERT INTO capability_providers
         (id, capability_key, provider, how, tool, cost_note, maturity, sort_order)
       VALUES ('cp_test_refund','refund','test','api','test_refund','none','declared',99)`,
      []);
    const v = await consequenceAllows({
      productId: PRODUCT, tool: 'test_refund', paramsFingerprint: null });
    expect(v.allowed).toBe(true);
    expect(v.rung).toBe('financial');
  });

  it('still refuses the one that spends his, until it says how much', async () => {
    const spends = (await query(
      `SELECT draws_on_allowance FROM capabilities WHERE capability_key = ?`,
      ['register_domain'])).rows[0] as Record<string, unknown>;
    expect(Number(spends.draws_on_allowance)).toBe(1);
    const gives = (await query(
      `SELECT draws_on_allowance FROM capabilities WHERE capability_key = ?`,
      ['refund'])).rows[0] as Record<string, unknown>;
    expect(Number(gives.draws_on_allowance)).toBe(0);
  });
});
