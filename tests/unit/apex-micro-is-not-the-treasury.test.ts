// =============================================================================
// APEX MICRO IS NOT THE TREASURY, AND FOUNDRY IS NOT A SECOND ONE.
//
// The owner, 22 September 2026: Private Foundry "should connect directly,
// through appropriately authorized integrations, to the external platforms and
// financial systems needed to operate my portfolio". Apex Micro "does not need
// to become a financial hub, universal storefront, payment processor, or
// intermediary through which every portfolio transaction passes… Etsy processes
// Etsy purchases and pays out to my designated bank account. Stripe processes
// eligible direct purchases and pays out to the appropriate account. Foundry
// privately observes and reconciles those separate economic activities."
//
// FOUR PARTIES, AND KEEPING THEM APART IS THE WHOLE POINT. The legal owner and
// operator of the business; the public-facing Apex Micro identity; Private
// Foundry's delegated operating responsibilities; and the external financial
// accounts and payment channels. He asked that the distinction be preserved,
// and that nothing here read the simplification as permission to weaken the
// customer-obligation, financial-reconciliation or public-identity safeguards.
//
// So this suite holds two things at once: that the public site stays a business
// identity rather than growing a treasury, and that the private ledger can
// still tell one economic activity from three observations of it.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '3'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { record } from '../../src/services/economy/ledger.js';

const OWNER = 'tz_owner';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_tz', 'thomas@example.com', 'Owner']);
});

describe('the same money cannot be counted as two different arrivals', () => {
  it('records what the owner actually moved, which is the term that must stay', async () => {
    const r = await record({
      founderId: OWNER, kind: 'owner_contribution', amountCents: 5000,
      occurredAt: new Date(), provider: 'owner', providerRef: 'owner_contribution:1',
      claimQuality: 'measured', evidenceMode: 'real', because: 'seed money',
    });
    expect(r.duplicate).toBe(false);
  });

  it('refuses a marketplace payout dressed as the owner putting money in', async () => {
    // THE DOUBLE COUNT. `owner_contribution` is `affects_cash = 1`, needs no
    // source event, and `moneyHeld` adds the owner term with NO `affects_cash`
    // filter — deliberately, because it is the one term that records what he
    // actually moved. So an Etsy payout landing in his bank, recorded the
    // natural way somebody records money arriving, counts the same gross twice:
    // once as the charge Etsy reported, once as a contribution.
    await expect(record({
      founderId: OWNER, kind: 'owner_contribution', amountCents: 1242,
      occurredAt: new Date(), provider: 'etsy', providerRef: 'payout_20260922',
      claimQuality: 'measured', evidenceMode: 'real', because: 'Etsy paid out to the bank',
    })).rejects.toThrow(/owner_money_comes_from_the_owner/);
  });

  it('refuses the same thing for money going out', async () => {
    await expect(record({
      founderId: OWNER, kind: 'owner_distribution', amountCents: 1242,
      occurredAt: new Date(), provider: 'stripe', providerRef: 'po_1',
      claimQuality: 'measured', evidenceMode: 'real', because: 'Stripe payout',
    })).rejects.toThrow(/owner_money_comes_from_the_owner/);
  });

  it('refuses anything else claiming to be the owner moving money', async () => {
    await expect(record({
      founderId: OWNER, kind: 'operating_spend', amountCents: 400,
      occurredAt: new Date(), provider: 'owner', providerRef: 'spend_1',
      claimQuality: 'measured', evidenceMode: 'real', because: 'a cost',
    })).rejects.toThrow(/only_owner_money_is_owners/);
  });

  it('keeps the rule the one call site already obeyed, so a second one inherits it', () => {
    const src = readFileSync('src/routes/dashboard/money-place.ts', 'utf8');
    // The convention was held by a comment. It is a law now, which is what
    // makes it survive the writer nobody has written yet.
    expect(src).toContain("provider: 'owner'");
  });
});

describe('a payout belongs to a balance, never to a sale', () => {
  it('refuses a payout attributed to one fulfilment', async () => {
    // Migration 313 said so in the column's own comment — "a `payout` never
    // does, because a payout is about the balance rather than about any single
    // sale" — and nothing enforced it. Attributing one to a fulfilment makes
    // that unit count its own revenue twice.
    const f = (await query('SELECT id FROM experiment_fulfilments LIMIT 1')).rows[0] as
      Record<string, unknown> | undefined;
    await expect(record({
      founderId: OWNER, kind: 'payout', amountCents: 1242,
      occurredAt: new Date(), provider: 'stripe', providerRef: 'po_2',
      fulfilmentId: f ? String(f.id) : 'no-such-fulfilment',
      claimQuality: 'measured', evidenceMode: 'real', because: 'a payout',
    })).rejects.toThrow(/a_payout_is_not_a_sale/);
  });

  it('takes a payout that names neither', async () => {
    const r = await record({
      founderId: OWNER, kind: 'payout', amountCents: 1242,
      occurredAt: new Date(), provider: 'stripe', providerRef: 'po_3',
      claimQuality: 'measured', evidenceMode: 'real', because: 'a payout to the bank',
    });
    expect(r.duplicate).toBe(false);
  });
});

describe('the public site stays a business identity, not a treasury', () => {
  const site = readFileSync('src/services/public-workshop/site.ts', 'utf8');

  it('keeps the legal operator distinct from the public name', () => {
    // Four parties, and two of them appear on this page: the business people
    // deal with, and the person legally behind it.
    expect(site).toContain('legalOperator');
    expect(site).toContain("isn't a company and doesn't claim to be one");
  });

  it('sends a marketplace remedy to the marketplace, and keeps the promise here', () => {
    // The simplification is not permission to weaken the customer-obligation
    // safeguard: what moves with the channel is the ROUTE the money takes, not
    // the promise. Whitespace is normalised because the copy is wrapped in the
    // source and a line break is not a change of meaning.
    const flat = site.replace(/\s+/g, ' ');
    expect(flat).toContain('the promise is the same one');
    expect(flat).toContain('What differs is the route the money takes');
    expect(flat).toContain('The marketplace has its own policy; mine is not limited by it');
  });

  it('keeps the policies the limited role does not excuse', () => {
    // "Do not remove any necessary legal, contractual, tax, privacy,
    // customer-support, or financial accountability merely because Apex Micro's
    // website has a deliberately limited role."
    for (const page of ["pages.set('/refunds'", "pages.set('/privacy'", "pages.set('/terms'", "pages.set('/contact'"]) {
      expect(site, page).toContain(page);
    }
  });
});
