// =============================================================================
// STRIPE TAX IS HIS TO TURN ON (F2, 9 October 2026; PENDING 35).
//
// The Workshop's payment links are minted in code, so turning Stripe Tax on is
// a line of code — and whether to (0.5% a sale, and registrations only he can
// make) is his open decision. So the link carries `automatic_tax[enabled]`
// exactly when his own signed `stripe_tax` row says "on", and never otherwise;
// a row written by anyone else cannot exist. Beside it: the threshold alert,
// read from dated, cited thresholds and Foundry's own trailing sales.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '6'.repeat(64);
process.env.STRIPE_SECRET_KEY = 'sk_test_tax_fixture';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

const OWNER = 'f_tax';
const sentLinks: URLSearchParams[] = [];

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clk_tax', 'owner@example.com', 'Owner']);
  await query(`INSERT INTO products (id,name,owner_id,status,scp_status,reality) VALUES ('p_tax','Taxed',?,'active','active','real')`, [OWNER]);
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/prices?')) return new Response(JSON.stringify({ data: [{ id: 'price_fixture' }] }), { status: 200 });
    if (u.endsWith('/payment_links')) { sentLinks.push(new URLSearchParams(String(init?.body ?? ''))); return new Response(JSON.stringify({ id: 'plink_fixture', url: 'https://buy.stripe.com/fixture' }), { status: 200 }); }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
});

const params = {
  unit_amount: 900, currency: 'usd', price_lookup_key: 'tax_fixture', product_name: 'Taxed (version 1)',
  link_metadata: { app: 'foundry', experiment_id: 'exp_tax' }, payment_intent_metadata: { app: 'foundry', experiment_id: 'exp_tax' },
};

async function mint(): Promise<URLSearchParams> {
  const { createPaymentLinkHandler } = await import('../../src/services/integration/stripe-gateway.js');
  await createPaymentLinkHandler({ productId: 'p_tax', tool: 'stripe_create_payment_link', action: 'mint', params, dedupKey: `k_${String(sentLinks.length)}` } as never);
  return sentLinks[sentLinks.length - 1]!;
}

describe('the link carries Stripe Tax only on his word', () => {
  it('with no row of his: no automatic tax', async () => {
    expect((await mint()).get('automatic_tax[enabled]')).toBeNull();
  });
  it('a row signed by anyone else is refused by the database, and changes nothing', async () => {
    const { supersedeOriginationPolicy } = await import('../../src/services/venture/legal-surface.js');
    expect(await supersedeOriginationPolicy({ founderId: OWNER, requirement: 'stripe_tax', treatment: 'policy', value: 'on', why: 'the hand decided', by: 'hand' })).toHaveProperty('refused');
    expect((await mint()).get('automatic_tax[enabled]')).toBeNull();
  });
  it('his "on": the link asks Stripe to calculate and collect tax', async () => {
    const { supersedeOriginationPolicy } = await import('../../src/services/venture/legal-surface.js');
    await supersedeOriginationPolicy({ founderId: OWNER, requirement: 'stripe_tax', treatment: 'policy', value: 'on', why: 'collect tax on my own page', by: `founder:${OWNER}` });
    expect((await mint()).get('automatic_tax[enabled]')).toBe('true');
  });
});

describe('the threshold alert', () => {
  it('every threshold is dated and cited; the EU and UK thresholds for a seller outside them are zero', async () => {
    const { THRESHOLDS } = await import('../../src/services/venture/storefront/tax.js');
    for (const t of Object.values(THRESHOLDS)) { expect(t.source).toMatch(/https:\/\//); expect(t.readOn).toMatch(/^2026-/); }
    expect(THRESHOLDS.eu.cents).toBe(0);
    expect(THRESHOLDS.uk.cents).toBe(0);
    expect(THRESHOLDS.us.cents).toBe(10_000_000);
  });
  it('no sale: nothing owed; a sale: EU/UK exposure not known (the country is not recorded); near $100,000: approaching', async () => {
    const { taxThresholdAlert } = await import('../../src/services/venture/storefront/tax.js');
    expect((await taxThresholdAlert(OWNER))[0]!.level).toBe('none');
    const { taxAlertFrom } = await import('../../src/services/venture/storefront/tax.js');
    const a = taxAlertFrom({ grossCents: 8_100_000, sales: 900 });
    expect(a[0]!.level).toBe('not_known');
    expect(a[1]!).toMatchObject({ level: 'approaching', sentence: expect.stringMatching(/81\.0% of \$100,000.*per-state amounts are not known/) });
  });
});
