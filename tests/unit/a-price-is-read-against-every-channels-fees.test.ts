// =============================================================================
// A PRICE IS READ AGAINST EVERY CHANNEL'S FEES (FQ, 9 October 2026).
//
// On a $9 file the channel and the card take a real share, and it differs by
// channel. So:
//   * each channel's published fee schedule is a dated, cited constant
//     (fee-floor.ts), never a number invented here; where a schedule leaves a
//     surcharge unsaid or dependent on the buyer, the listing shows a RANGE,
//     and where nothing is published the net is "not known";
//   * every product's listing shows, per channel, what is left after fees;
//   * THE FLOOR IS HIS (PENDING 44). The check reads his own row; with no row
//     it refuses every channel listing outright; below his floor it refuses
//     with the numbers; a floor written by anyone but him cannot exist (the
//     database refuses the row).
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '3'.repeat(64);
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

const F = await import('../../src/services/venture/fee-floor.js');
const S = await import('../../src/services/venture/storefront/price-floor.js');
const OWNER = 'f_floor';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clk_floor', 'owner@example.com', 'Owner']);
});

describe('the published schedules', () => {
  it('every channel card is dated and cited, and says whether it is the merchant of record', () => {
    for (const [k, c] of Object.entries(F.FEE_CARDS)) {
      expect(c.source, k).toMatch(/^https:\/\//);
      expect(c.readOn, k).toMatch(/^2026-\d\d-\d\d$/);
    }
    expect(F.FEE_CARDS.gumroad.merchantOfRecord).toBe(true);
    expect(F.FEE_CARDS.lemonsqueezy.merchantOfRecord).toBe(true);
    expect(F.FEE_CARDS.stripe.merchantOfRecord).toBe(false);
  });

  it('a $9 file: what each channel leaves, as the schedules say', () => {
    const net = S.netByChannel(900);
    // Stripe 2.9% + 30¢: ceil(26.1) + 30 = 57 → 843.
    expect(net.workshop).toMatchObject({ lowCents: 843, highCents: 843 });
    // Etsy 6.5% + 3% + 25¢ + 20¢ listing: ceil(85.5) + 45 = 131 → 769.
    expect(net.etsy).toMatchObject({ lowCents: 769, highCents: 769 });
    // Gumroad 10% + 50¢ = 140 → 760; with 2.9% + 30¢ processing that the page does not rule out: ceil(116.1) + 80 = 197 → 703.
    expect(net.gumroad).toMatchObject({ lowCents: 703, highCents: 760 });
    // Lemon Squeezy 5% + 50¢ = 95 → 805; +1.5% abroad, +1.5% PayPal: ceil(72) + 50 = 122 → 778.
    expect(net.lemonsqueezy).toMatchObject({ lowCents: 778, highCents: 805 });
    expect(net.gumroad.because).toMatch(/card processing/);
  });

  it('the listing line says the net per channel in words, with a range where the schedule leaves one', () => {
    const line = S.netLine(900);
    expect(line).toContain('Workshop page: $8.43');
    expect(line).toContain('Gumroad: $7.03–$7.60');
    expect(line).toContain('Lemon Squeezy: $7.78–$8.05');
  });

  it('a channel with no published schedule is "not known", never zero', () => {
    expect(S.netFor('nowhere' as never, 900)).toMatchObject({ lowCents: null, highCents: null, because: expect.stringMatching(/not known/) });
  });
});

describe('the floor is his', () => {
  it('with no floor set, every channel listing is refused, saying so', async () => {
    const r = await S.priceMeetsFloor(OWNER, 'gumroad', 900);
    expect(r).toMatchObject({ ok: false });
    expect((r as { because: string }).because).toMatch(/not set a lowest price.*PENDING 44/);
  });

  it('a floor row written by anyone but him is refused by the database', async () => {
    const { supersedeOriginationPolicy } = await import('../../src/services/venture/legal-surface.js');
    const r = await supersedeOriginationPolicy({ founderId: OWNER, requirement: 'price_floor', treatment: 'policy',
      value: JSON.stringify({ minCents: 100 }), why: 'the forge thought so', by: 'forge' });
    expect(r).toHaveProperty('refused');
    expect(await S.priceMeetsFloor(OWNER, 'gumroad', 900)).toMatchObject({ ok: false });
  });

  it('his floor in dollars: below it refused with the numbers, at or above it allowed', async () => {
    const set = await S.setPriceFloor(OWNER, { minCents: 700 }, 'no file under $7 while the fees are this size', `founder:${OWNER}`);
    expect(set).toHaveProperty('id');
    expect(await S.priceMeetsFloor(OWNER, 'gumroad', 600)).toMatchObject({ ok: false, because: expect.stringMatching(/\$6\.00.*\$7\.00/) });
    expect(await S.priceMeetsFloor(OWNER, 'gumroad', 700)).toMatchObject({ ok: true });
  });

  it('his floor as the share fees may take: judged at the TOP of the channel\'s range', async () => {
    await S.setPriceFloor(OWNER, { maxFeeShare: 0.2 }, 'fees may take a fifth at most', `founder:${OWNER}`);
    // Gumroad on $9: up to $1.97 = 21.9% → refused; Lemon Squeezy up to $1.22 = 13.6% → allowed.
    expect(await S.priceMeetsFloor(OWNER, 'gumroad', 900)).toMatchObject({ ok: false });
    expect(await S.priceMeetsFloor(OWNER, 'lemonsqueezy', 900)).toMatchObject({ ok: true });
  });

  it('per channel: his rule for one channel overrides his rule for all', async () => {
    await S.setPriceFloor(OWNER, { minCents: 500, channels: { etsy: { minCents: 1200 } } }, 'Etsy only above $12', `founder:${OWNER}`);
    expect(await S.priceMeetsFloor(OWNER, 'etsy', 900)).toMatchObject({ ok: false });
    expect(await S.priceMeetsFloor(OWNER, 'gumroad', 900)).toMatchObject({ ok: true });
  });

  it('a floor that is not a floor is refused before it is written', async () => {
    expect(await S.setPriceFloor(OWNER, {}, 'nothing', `founder:${OWNER}`)).toHaveProperty('refused');
    expect(await S.setPriceFloor(OWNER, { maxFeeShare: 1.5 }, 'too much', `founder:${OWNER}`)).toHaveProperty('refused');
    expect(await S.setPriceFloor(OWNER, { minCents: -1 }, 'negative', `founder:${OWNER}`)).toHaveProperty('refused');
  });
});
