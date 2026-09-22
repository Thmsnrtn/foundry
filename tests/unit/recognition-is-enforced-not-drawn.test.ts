// =============================================================================
// RECOGNITION IS ENFORCED, NOT DRAWN.
//
// The owner, 22 September 2026: "The visible confirmation interaction must
// reflect an authority boundary that is independently enforced by the backend.
// Verify that direct API requests, queued operations, retries, background
// workers, and previously scheduled work cannot bypass the relevant
// restrictions. A connection that has not been recognised must not perform
// consequential operations simply because its credentials are technically
// valid."
//
// WHAT WAS ACTUALLY WRONG. There was already a condition named "the shop it
// would act on is confirmed", and it was `met` the moment a credential
// existed — on the strength of a comment claiming "a connected Etsy account
// named its own shop", which a connected account may not have done and which
// in any case is Etsy's statement rather than his. A condition whose NAME said
// confirmed and whose EVIDENCE said connected.
//
// So nothing new is added here. The condition now asks for what its name has
// always meant, and because `qualificationStandsInTheWay` — which the outbound
// door calls at `gateway.ts:249` — refuses on any blocking condition, the
// boundary holds for every origin at once. There is no second gate to keep in
// step, and no way to reach the world that goes around this one.
//
// AND THE THING IT MUST NOT BLOCK. A delivery, a refund and a withdrawal all
// return null from that gate before it reaches any of this, because somebody
// who has already paid is owed their thing whatever has since gone wrong with
// the machinery. That is the owner's standing rule and this file proves it
// survives the new clause.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '8'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { qualificationOf, qualificationStandsInTheWay } from '../../src/services/venture/qualification.js';

process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'rec@example.com';

const OWNER = 'f_rec';
let X = '';
let P = '';
const SHOP = 'the shop it would act on is confirmed';

const clauseOf = async (): Promise<{ verdict: string; because: string }> => {
  const r = await qualificationOf(X);
  const c = r.conditions.find((x) => x.name === SHOP);
  expect(c, 'the shop condition vanished').toBeTruthy();
  return { verdict: c!.verdict, because: c!.because };
};

const blocks = async (): Promise<boolean> =>
  (await qualificationOf(X)).blocking.includes(SHOP);

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_rec', 'rec@example.com', 'Owner']);
  // THE CANONICAL SEED, not a hand-rolled row. Guessing the experiment schema
  // is how a fixture ends up testing a state the system cannot hold — and the
  // first attempt at this file did exactly that.
  const { seedProof2, approveListing } = await import('../../src/services/venture/proof-2.js');
  const seeded = await seedProof2(OWNER);
  X = seeded.experimentId;
  await approveListing({ founderId: OWNER, experimentId: X });
  // RESOLVED EXACTLY AS `qualificationOf` RESOLVES IT — `products.from_experiment_id`
  // — rather than by a shape I assumed. The reader and the fixture have to be
  // looking at the same row or the test proves nothing about the reader.
  const found = (await query(
    'SELECT id FROM products WHERE from_experiment_id = ? AND deleted_at IS NULL',
    [X])).rows[0] as Record<string, unknown> | undefined;
  if (found) {
    P = String(found.id);
  } else {
    P = 'p_rec';
    await query(
      'INSERT INTO products (id,name,owner_id,status,from_experiment_id) VALUES (?,?,?,?,?)',
      [P, 'Apex Micro', OWNER, 'active', X]);
  }
});

describe('the condition asks for what its name has always meant', () => {
  it('is not satisfied by having no connection at all', async () => {
    const c = await clauseOf();
    expect(c.verdict).toBe('waits_for_you');
    expect(c.because).toContain('no Etsy account is connected');
    expect(await blocks()).toBe(true);
  });

  it('is not satisfied by a live credential alone', async () => {
    // THE DEFECT THIS FILE EXISTS FOR. A credential existed and the condition
    // read `met`, so a marketplace act could proceed against a shop nothing
    // had ever named.
    const r = (await query(
      "SELECT sense_key, mode FROM sense_providers WHERE provider = 'etsy' LIMIT 1"))
      .rows[0] as Record<string, unknown>;
    await query(
      `INSERT INTO company_senses (id, product_id, sense_key, provider, mode, disclosure)
       VALUES (?,?,?,?,?,?)`,
      ['cs_rec', P, String(r.sense_key), 'etsy', String(r.mode), 'I would read the shop.']);
    await query(
      `INSERT INTO sense_credentials (id, company_sense_id, product_id, provider,
         granted_scopes_json, secret_json)
       VALUES (?,?,?,?,?,?)`,
      ['sc_rec', 'cs_rec', P, 'etsy', JSON.stringify(['shops_r']), 'iv:cipher:tag']);

    const c = await clauseOf();
    expect(c.verdict).toBe('waits_for_you');
    expect(c.because).toContain('has not yet told me which shop it opens');
    expect(await blocks()).toBe(true);
  });

  it('is not satisfied by Etsy naming the shop, because that is not his word', async () => {
    await query(
      `UPDATE company_senses SET provider_account_ref = ?, provider_account_label = ?,
              identity_verified_at = datetime('now') WHERE id = 'cs_rec'`,
      ['12345678', 'ApexMicro']);
    const c = await clauseOf();
    expect(c.verdict).toBe('waits_for_you');
    expect(c.because).toContain('you have not said ApexMicro is your shop');
    // The sentence names the failure mode rather than gesturing at policy.
    expect(c.because).toContain('would look exactly like this from here');
    expect(await blocks()).toBe(true);
  });

});

describe('the boundary is at the door, so no origin goes around it', () => {
  // `qualificationStandsInTheWay` is what `gateway.ts:249` calls before any
  // consequential effect. A route, a queued job, a retry, a scheduled pass and
  // an agent all reach the world through that one function, so proving the
  // refusal here proves it for all of them at once.
  //
  // RUN IN LIFECYCLE ORDER rather than by toggling state. The first attempt
  // disconnected and reconnected a sense to move it in and out of recognition,
  // and `company_sense:already_disconnected` refused — correctly, because
  // disconnection is one-way and reconnecting is a new row. A test that has to
  // reverse a deliberately irreversible transition is testing something the
  // system does not do.
  it('does not even reach readiness for a marketplace write, because nothing can attempt one', async () => {
    // A FINDING RATHER THAN A PASSING ASSERTION, and it is the stronger of the
    // two layers. `qualificationStandsInTheWay` falls back to the capability
    // FAMILY when no act names the crossing, and resolves it by `p.tool = ?`.
    // Every Etsy write provider carries `tool = NULL`, so there is no row, the
    // gate returns null — and the act was already impossible one layer out,
    // because the outbound door cannot resolve a tool that is not bound.
    //
    // So the recognition clause is NOT currently exercised on the
    // marketplace-write path. It is unreachable behind a harder guarantee.
    // That is safe today and it is worth writing down: the day a tool is bound
    // to `list_on_marketplace`, this clause becomes load-bearing for the first
    // time, and it will already have been proven by the offer case below.
    const bound = (await query(
      `SELECT p.id, p.tool FROM capability_providers p
        WHERE p.capability_key = 'list_on_marketplace'`))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(bound.length).toBeGreaterThan(0);
    for (const r of bound) expect(r.tool, String(r.id)).toBeNull();

    const stood = await qualificationStandsInTheWay({
      experimentId: X, tool: 'post_listing', kind: null,
    });
    expect(stood).toBeNull();
  });

  it('refuses an offer while the shop is unrecognised', async () => {
    const stood = await qualificationStandsInTheWay({
      experimentId: X, tool: 'send_email', kind: 'offer',
    });
    expect(stood).not.toBeNull();
    expect(stood!.blocking).toContain(SHOP);
  });

  it('never stands in the way of what a customer is already owed', async () => {
    // The owner's standing rule: "Preserve existing customer obligations even
    // when new spending, outreach, publication, or experiment authority is
    // withdrawn." A recognition clause that refused a refund would be that rule
    // exactly inverted.
    for (const kind of ['delivery', 'refund', 'withdrawal'] as const) {
      const stood = await qualificationStandsInTheWay({
        experimentId: X, tool: 'send_email', kind,
      });
      expect(stood, kind).toBeNull();
    }
  });
});

describe('his recognition is what clears it', () => {
  it('is satisfied once he has recognised it, and names both halves', async () => {
    await query(
      `UPDATE company_senses SET identity_confirmed_at = datetime('now'),
              identity_confirmed_by = 'founder:f_rec' WHERE id = 'cs_rec'`);
    const c = await clauseOf();
    expect(c.verdict).toBe('met');
    expect(c.because).toContain('Etsy named ApexMicro and you confirmed it is yours');
    expect(await blocks()).toBe(false);
  });

  it('and this one condition no longer stands in the way at the door', async () => {
    const stood = await qualificationStandsInTheWay({
      experimentId: X, tool: 'post_listing', kind: null,
    });
    // Other conditions may still block — a listing that is not live, a venue
    // that has never been read. What must be gone is this one.
    expect(stood?.blocking ?? []).not.toContain(SHOP);
  });
});

describe('a replacement connection inherits nothing', () => {
  it('starts unrecognised even when it reaches the very same shop', async () => {
    // "A new connection must not inherit recognition or operational authority
    // merely because its provider-reported identity resembles a previous
    // connection." Structural rather than checked: recognition is a column on
    // the connection row, and a reconnection is a new row.
    await query(
      `UPDATE company_senses SET disconnected_at = datetime('now'),
              disconnect_reason = 'he decided it was the wrong shop' WHERE id = 'cs_rec'`);
    const r = (await query(
      "SELECT sense_key, mode FROM sense_providers WHERE provider = 'etsy' LIMIT 1"))
      .rows[0] as Record<string, unknown>;
    await query(
      `INSERT INTO company_senses (id, product_id, sense_key, provider, mode, disclosure)
       VALUES (?,?,?,?,?,?)`,
      ['cs_rec2', P, String(r.sense_key), 'etsy', String(r.mode), 'I would read the shop.']);
    await query(
      `INSERT INTO sense_credentials (id, company_sense_id, product_id, provider,
         granted_scopes_json, secret_json)
       VALUES (?,?,?,?,?,?)`,
      ['sc_rec2', 'cs_rec2', P, 'etsy', JSON.stringify(['shops_r']), 'iv:cipher:tag']);
    // The SAME shop id and name as the connection he rejected.
    await query(
      `UPDATE company_senses SET provider_account_ref = ?, provider_account_label = ?,
              identity_verified_at = datetime('now') WHERE id = 'cs_rec2'`,
      ['12345678', 'ApexMicro']);

    const c = await clauseOf();
    expect(c.verdict).toBe('waits_for_you');
    expect(c.because).toContain('you have not said ApexMicro is your shop');
    expect(await blocks()).toBe(true);
  });

  it('keeps the rejected connection as history, with its recognition intact', async () => {
    // "Retain its historical evidence without allowing that history to confer
    // authority on the replacement." Both halves, in one row.
    const old = (await query(
      `SELECT identity_confirmed_at, identity_confirmed_by, disconnect_reason
         FROM company_senses WHERE id = 'cs_rec'`)).rows[0] as Record<string, unknown>;
    expect(old.identity_confirmed_at).toBeTruthy();
    expect(String(old.identity_confirmed_by)).toBe('founder:f_rec');
    expect(String(old.disconnect_reason)).toContain('wrong shop');
  });

  it('and the door refuses the replacement until he recognises it too', async () => {
    // Through the path that actually reaches readiness — an offer, which the
    // gate keys on by act kind rather than by resolving a tool.
    const stood = await qualificationStandsInTheWay({
      experimentId: X, tool: 'send_email', kind: 'offer',
    });
    expect(stood).not.toBeNull();
    expect(stood!.blocking).toContain(SHOP);
    expect(stood!.refusal).toContain('the test is not ready for this');
  });
});
