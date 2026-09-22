// =============================================================================
// ETSY BECOMES SOMETHING HE CAN BE ASKED ABOUT.
//
// Migration 338 declared the three read scopes an Etsy connection may ask for.
// A reconstruction found that it had not made the connection ASKABLE:
// `whatItCannotSee` builds the owner's offer list by joining `senses` to
// `sense_providers`, and there had never been an Etsy row there. The scopes
// stood declared and bounded, and no surface could offer them — the button did
// not exist.
//
// This is the shape of defect this campaign has now named twice: a vocabulary
// complete for a state nothing could enter. One row closes it, and the row
// grants nothing, because an offer to ask is not an answer.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '7'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { whatItCannotSee, type SenseOffer } from '../../src/services/senses/index.js';
import { requiredScopes } from '../../src/services/senses/credentials.js';

const OWNER = 'eo_owner';
const REAL = 'eo_real';
const REFERENCE = 'eo_reference';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_eo', 'thomas@example.com', 'Owner']);
  await query(
    `INSERT INTO products (id,name,owner_id,status,reality) VALUES (?,?,?,'active','real')`,
    [REAL, 'Apex Micro', OWNER]);
  await query(
    `INSERT INTO products (id,name,owner_id,status,reality) VALUES (?,?,?,'active','reference')`,
    [REFERENCE, 'Rehearsal Co', OWNER]);
});

/** Every Etsy offer on the revenue gap for one company. */
async function etsyOffers(productId: string): Promise<SenseOffer[]> {
  const gap = (await whatItCannotSee(productId)).find((g) => g.key === 'revenue');
  return (gap?.offers ?? []).filter((o) => o.provider === 'etsy');
}

describe('the offer exists at all, which it did not', () => {
  it('appears among what a real company could connect', async () => {
    const etsy = await etsyOffers(REAL);
    expect(etsy, 'no Etsy offer means no button, whatever the scope table says').toHaveLength(1);
    expect(etsy[0].mode).toBe('real');
  });

  it('is not offered to a rehearsal company', async () => {
    // A reference company may only be offered reference providers, and there is
    // no Etsy sandbox that would exercise this against numbers that are not the
    // world's — so none is offered rather than one being invented.
    expect(await etsyOffers(REFERENCE)).toHaveLength(0);
  });
});

describe('what the owner is told he would be agreeing to', () => {
  it('asks for exactly the three read scopes, each with its reason', async () => {
    const scopes = await requiredScopes('etsy', 'revenue', 'real');
    expect(scopes.map((s) => s.scope).sort()).toEqual(['listings_r', 'shops_r', 'transactions_r']);
    for (const s of scopes) expect(s.because.length, s.scope).toBeGreaterThan(10);
  });

  it('says plainly that nothing beyond reading is handed over', async () => {
    const [etsy] = await etsyOffers(REAL);
    // The Stripe and GitHub rows beside it cannot say this — theirs read "a key
    // with write scope could move money". Here it is a description of four rows
    // elsewhere rather than a promise: `listings_w` is in no adapter, the scope
    // table is closed, and the acts that would use it have no tool.
    expect(etsy.handsOver).toContain('nothing beyond reading');
  });

  it('does not overstate what connecting would buy', async () => {
    // Etsy reports no shop statistics through its API, by its own deliberate
    // choice. An offer that implied otherwise would have the owner agreeing to
    // something on a false account of it.
    const [etsy] = await etsyOffers(REAL);
    expect(etsy.reads).toContain('orders');
    expect(etsy.reads).toMatch(/does not report shop statistics/i);
  });
});

describe('the offer grants nothing, and cannot be widened', () => {
  it('still refuses a fourth scope, because the table is constitutional', async () => {
    await expect(query(
      `INSERT INTO sense_provider_scopes (provider, sense_key, mode, scope, because)
       VALUES ('etsy','revenue','real','listings_w','to publish')`))
      .rejects.toThrow(/constitutional/);
  });

  it('refuses a second provider row written at runtime', async () => {
    await expect(query(
      `INSERT INTO sense_providers (provider, sense_key, mode, reads, hands_over)
       VALUES ('etsy','customers','real','buyers','everything')`))
      .rejects.toThrow(/constitutional/);
  });

  it('leaves every Etsy capability without a door to arrive at, the read included', async () => {
    // The read capability added alongside this offer carries no tool either.
    // `capability_providers.tool` means "the name at the outbound door" and
    // NULL means "never reaches the world on its own (a read, a draft, a
    // workspace step)". A read that invented a door would make the column mean
    // two things in two rows of one table.
    const rows = (await query(
      `SELECT id, tool FROM capability_providers WHERE provider = 'etsy'`))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const r of rows) expect(r.tool, String(r.id)).toBeNull();
  });

  it('classifies the read as something only he can connect, not as public', async () => {
    // `read_marketplace_listings` exists and is `public_observation` — a page
    // anybody may fetch with no account. Reusing it would have let a
    // credentialed read inherit a basis saying no credential is involved.
    const row = (await query(
      `SELECT basis, needs_credential, never_grants FROM capability_access
        WHERE capability_key = 'read_marketplace_account'`))
      .rows[0] as Record<string, unknown>;
    expect(String(row.basis)).toBe('owner_connected');
    expect(Number(row.needs_credential)).toBe(1);
    expect(String(row.never_grants)).toMatch(/publishing|withdrawing/);
  });

  it('is not in the family the readiness gate stands in the way of', async () => {
    // `qualificationStandsInTheWay` falls back to the capability's family and
    // gates `distribution`. Reading a shop puts nothing in front of anybody,
    // and it is exactly when a test is NOT ready that somebody most needs to
    // look at it.
    const row = (await query(
      `SELECT family, rung FROM capabilities WHERE capability_key = 'read_marketplace_account'`))
      .rows[0] as Record<string, unknown>;
    expect(String(row.family)).not.toBe('distribution');
    expect(String(row.rung)).toBe('observe');
  });
});
