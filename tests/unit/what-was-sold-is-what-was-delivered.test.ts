// =============================================================================
// WHAT WAS SOLD IS WHAT WAS DELIVERED, AND WHICH ONE IS ON RECORD.
//
// The owner's handoff of 28 September: "Bind the listing copy, preview,
// guide, file digest, compatibility, support promise, and sold-order version.
// A correction creates a new version and traces affected buyers; it does not
// replace the historical promise invisibly."
//
// The listing's files were read (B3), but an order did not record which file
// the listing held when it sold. A later change of file would leave no way to
// tell which buyers got the old one. So each venue order now keeps the files
// the listing held at the last reading at or before it was paid. Where no
// reading came before the sale, it says "not known" and infers nothing.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'e'.repeat(64);
process.env.FOUNDRY_OWNER_EMAIL = 'ver@example.com';

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { approveListing, recordListing, recordVenueOrder, seedProof2 } from '../../src/services/venture/proof-2.js';

const OWNER = 'ver_owner';
const LISTING = '9988776664';
let X = '';
let PRODUCT = '';
const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const reading = async (hoursAgo: number, files: Array<{ filename: string; sizeBytes: number }>) => query(
  `INSERT INTO venue_listing_readings (id, product_id, provider, listing_id, seen, price_cents, currency, files_json, observed_at)
   VALUES (?,?,'etsy',?,1,1400,'usd',?,datetime('now', ?))`,
  [nanoid(), PRODUCT, LISTING, JSON.stringify(files), `-${String(hoursAgo)} hours`]);
const order = (ref: string, hoursAgo: number) => recordVenueOrder({ founderId: OWNER, experimentId: X,
  order: { orderRef: ref, paidAt: ago(hoursAgo), grossCents: 1400, feeCents: 158 } });
const bound = async (ref: string) => (await query(
  `SELECT delivered_files_json, delivered_files_seen_at FROM experiment_fulfilments WHERE payment_ref = ?`, [ref]))
  .rows[0] as Record<string, unknown>;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_ver', 'ver@example.com', 'Owner']);
  X = (await seedProof2(OWNER)).experimentId;
  await approveListing({ founderId: OWNER, experimentId: X });
  PRODUCT = String(((await query('SELECT id FROM products WHERE from_experiment_id = ?', [X])).rows[0] as Record<string, unknown>).id);
  await recordListing({ founderId: OWNER, experimentId: X, url: `https://www.etsy.com/listing/${LISTING}/workbook` });
});

describe('an order binds the file the listing held when it sold', () => {
  it('says "not known" for a sale before any reading of the files', async () => {
    await order('8300000001', 10);
    const b = await bound('8300000001');
    expect(b.delivered_files_json).toBeNull();
    expect(b.delivered_files_seen_at).toBeNull();
  });

  it('binds the last reading at or before the payment', async () => {
    await reading(8, [{ filename: 'bid-decision-workbook.xlsx', sizeBytes: 48303 }]);
    await order('8300000002', 6);
    const b = await bound('8300000002');
    expect(JSON.parse(String(b.delivered_files_json))).toEqual([{ filename: 'bid-decision-workbook.xlsx', sizeBytes: 48303 }]);
    expect(b.delivered_files_seen_at).not.toBeNull();
  });

  it('keeps the earlier buyer\'s file when the listing\'s file later changes', async () => {
    await reading(4, [{ filename: 'bid-decision-workbook-v2.xlsx', sizeBytes: 49001 }]);
    await order('8300000003', 2);
    expect(JSON.parse(String((await bound('8300000002')).delivered_files_json))[0].sizeBytes).toBe(48303);
    expect(JSON.parse(String((await bound('8300000003')).delivered_files_json))[0].sizeBytes).toBe(49001);
  });

  it('does not rebind on a replay of the same order', async () => {
    await order('8300000002', 6);
    expect(JSON.parse(String((await bound('8300000002')).delivered_files_json))[0].sizeBytes).toBe(48303);
  });
});

describe('the money page says which file each buyer received', () => {
  it('names it, or says it is not known', async () => {
    const { moneyRoutes } = await import('../../src/routes/dashboard/money-place.js');
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'ver@example.com' } as never); c.set('csrfToken' as never, 't' as never); await next(); });
    app.route('/', moneyRoutes);
    const t = (await (await app.request('/foundry/money')).text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(t).toMatch(/delivered bid-decision-workbook\.xlsx \(48,303 bytes, as Etsy held it on \d{4}-\d{2}-\d{2}\)/);
    expect(t).toMatch(/delivered bid-decision-workbook-v2\.xlsx \(49,001 bytes/);
    expect(t).toMatch(/which file this buyer received is not known/);
  });
});
