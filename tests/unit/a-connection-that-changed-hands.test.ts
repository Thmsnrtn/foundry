// =============================================================================
// A CONNECTION THAT CHANGED HANDS.
//
// The owner, 22 September 2026, on the two halves of the same question:
//
//   "Build the recovery pass for connections established before the
//   owner-recognition model was introduced… Do not automatically interpret an
//   existing credential, successful historical operation, matching account
//   name, or historical connection record as evidence of owner recognition."
//
//   "If the provider subsequently reports a materially different account
//   identity… Foundry must not silently continue operating under the previous
//   recognition… Do not convert every identity-read failure into an assertion
//   that the account has changed."
//
// WHY THESE ARE ONE FILE. They are the same probe, read twice: once when there
// is nothing recorded and once when there is. Proving them apart would let the
// two answers about whose account this is drift, which is the defect rather
// than the test.
//
// AND THE FIVE DISTINCTIONS, WHICH ARE WHERE THIS COULD GO WRONG QUIETLY:
// a rename, a refresh, a replacement grant, a changed account, and a provider
// that did not answer. Four of those must cost the owner nothing. Exactly one
// is worth stopping his business over, and a file that did not separate them
// would be proving a system that cries wolf or one that never cries at all.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '9'.repeat(64);
process.env.FOUNDRY_OWNER_EMAIL = 'hands@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { encryptCredentialPayload } from '../../src/services/encryption.js';
import { registerSenseProvider, senseProvider, SenseProviderError } from '../../src/services/senses/providers/contract.js';
import { recoverIdentities, disputeOn } from '../../src/services/senses/identity-pass.js';
import { connectorsFor } from '../../src/services/senses/journey.js';

const F = 'f_hands', P = 'p_hands', S = 'cs_hands', C = 'sc_hands';

/** What the stubbed provider will say when asked who this is. */
let answer: { ok: boolean; detail: string } | 'throw' = { ok: true, detail: 'ApexMicro (12345678)' };

const sense = async (): Promise<Record<string, unknown>> => (await query(
  `SELECT provider_account_ref, provider_account_label, identity_verified_at,
          identity_confirmed_at, identity_disputed_at, identity_disputed_ref,
          identity_disputed_detail, last_error
     FROM company_senses WHERE id = ?`, [S])).rows[0] as Record<string, unknown>;

const etsy = async (): Promise<Awaited<ReturnType<typeof connectorsFor>>[number]> =>
  (await connectorsFor(P)).find((x) => x.provider === 'etsy')!;

const run = async (): Promise<string> =>
  (await recoverIdentities({ productId: P })).findings[0].outcome;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
    [F, 'c_hands', 'hands@example.com']);
  await query('INSERT INTO products (id,name,owner_id,status) VALUES (?,?,?,?)',
    [P, 'Apex Micro', F, 'active']);

  // THE REAL REGISTRY, WITH ONE ADAPTER REPLACED. `senseProvider` first, so the
  // module's own lazy load runs before the stub goes in and cannot overwrite
  // it afterwards. Registering against 'etsy' rather than inventing a provider
  // because `company_sense:not_a_declared_provider` refuses a triple the
  // institution has not declared — which is the right refusal, and means a
  // fixture cannot test a state the system could not hold.
  const real = await senseProvider('etsy');
  expect(real, 'etsy has no adapter to stand in for').toBeTruthy();
  registerSenseProvider({
    provider: 'etsy',
    authorizeUrl: real!.authorizeUrl.bind(real),
    exchange: real!.exchange.bind(real),
    refresh: async () => null,
    revoke: async () => undefined,
    probe: async () => {
      if (answer === 'throw') {
        throw new SenseProviderError({ ownerWords: 'Etsy did not answer', recoverable: true });
      }
      return answer;
    },
  });

  const r = (await query(
    "SELECT sense_key, mode FROM sense_providers WHERE provider = 'etsy' LIMIT 1"))
    .rows[0] as Record<string, unknown>;
  await query(
    `INSERT INTO company_senses (id, product_id, sense_key, provider, mode, disclosure)
     VALUES (?,?,?,?,?,?)`,
    [S, P, String(r.sense_key), 'etsy', String(r.mode), 'I would read the shop.']);
  await query(
    `INSERT INTO sense_credentials (id, company_sense_id, product_id, provider,
       granted_scopes_json, secret_json)
     VALUES (?,?,?,?,?,?)`,
    [C, S, P, 'etsy', JSON.stringify(['shops_r']),
      encryptCredentialPayload(JSON.stringify({ access_token: 'live' }))]);
});

describe('a connection made before any of this existed', () => {
  it('has a live credential and nothing to recognise, which is the state to repair', async () => {
    const before = await sense();
    expect(before.provider_account_ref).toBeNull();
    expect(before.identity_verified_at).toBeNull();
    const e = await etsy();
    expect(e.granted).toBe(true);
    expect(e.accountVerified).toBe(false);
  });

  it('does not invent an identity when the provider does not answer', async () => {
    // SILENCE IS NOT AN ACCUSATION AND IT IS NOT AN ANSWER. An outage must
    // leave the row exactly as it was, or every provider hiccup writes
    // something into the record of whose account this is.
    answer = 'throw';
    expect(await run()).toBe('unavailable');
    expect((await sense()).provider_account_ref).toBeNull();
  });

  it('does not invent an identity from an answer it cannot read', async () => {
    // `identityFromProbe` yields a null reference rather than a guess, and a
    // null reference writes nothing. A wrong shop id recorded here would be
    // indistinguishable, downstream, from one Etsy actually said.
    answer = { ok: true, detail: 'the account answers, and has no shop' };
    expect(await run()).toBe('unnamed');
    expect((await sense()).provider_account_ref).toBeNull();
  });

  it('records the account once the provider names one', async () => {
    answer = { ok: true, detail: 'ApexMicro (12345678) at https://etsy.com/shop/ApexMicro' };
    expect(await run()).toBe('recovered');
    const row = await sense();
    expect(row.provider_account_ref).toBe('12345678');
    expect(row.provider_account_label).toBe('ApexMicro');
    expect(row.identity_verified_at).toBeTruthy();
  });

  it('has still not recognised anything, which is the whole point', async () => {
    // THE SENTENCE THIS FILE EXISTS FOR. A credential that has worked for a
    // year, through an account whose name is exactly what he expects, is not
    // him saying it is his. Recovery writes 346's columns and never 347's.
    expect((await sense()).identity_confirmed_at).toBeNull();
    const e = await etsy();
    expect(e.accountVerified).toBe(true);
    expect(e.accountConfirmed).toBe(false);
    expect(e.authorised).toBe(false);
  });

  it('asks him once, and asking again on the next pass costs him nothing', async () => {
    // Routine maintenance must not become a recurring approval ritual. The
    // second pass over an unchanged connection reports `unchanged` and writes
    // nothing at all.
    expect(await run()).toBe('unchanged');
    expect(await run()).toBe('unchanged');
  });
});

describe('he recognises it, and then the world moves', () => {
  beforeAll(async () => {
    await query(
      `UPDATE company_senses SET identity_confirmed_at = datetime('now'),
              identity_confirmed_by = ? WHERE id = ?`, [`founder:${F}`, S]);
  });

  it('survives a rename, because the comparison is on the id and never the name', async () => {
    // The owner renamed this shop from Printbls4YouStudio to ApexMicro once
    // already. Comparing display names would have raised a false alarm on the
    // exact event he told us to expect.
    const was = (await sense()).identity_confirmed_at;
    answer = { ok: true, detail: 'Apex Micro Studio (12345678)' };
    expect(await run()).toBe('renamed');
    const row = await sense();
    expect(row.provider_account_label).toBe('Apex Micro Studio');
    expect(row.identity_confirmed_at).toBe(was);
    expect((await etsy()).authorised).toBe(true);
  });

  it('survives an outage, because a provider that said nothing accused nobody', async () => {
    answer = 'throw';
    expect(await run()).toBe('unavailable');
    expect(await disputeOn(S)).toBeNull();
    expect((await etsy()).authorised).toBe(true);
  });

  it('stops when the provider starts naming a different account', async () => {
    answer = { ok: true, detail: 'SomeoneElse (99999999)' };
    expect(await run()).toBe('disputed');
    const d = await disputeOn(S);
    expect(d?.observedRef).toBe('99999999');
    expect(d?.detail).toContain('SomeoneElse');
  });

  it('did not rewrite the recognition to match the provider', async () => {
    // "Do not silently rewrite owner recognition to match the latest provider
    // response." The recorded account and his confirmation of it are both
    // exactly as he left them; what is new is a fact ABOUT them.
    const row = await sense();
    expect(row.provider_account_ref).toBe('12345678');
    expect(row.identity_confirmed_at).toBeTruthy();
  });

  it('takes the authority and leaves his word alone', async () => {
    const e = await etsy();
    expect(e.authorised).toBe(false);
    expect(e.accountConfirmed).toBe(true);
    expect(e.disputedAccount).toBe('99999999');
  });

  it('says so where he already looks for a sense that has gone wrong', async () => {
    expect(String((await sense()).last_error)).toContain('different account');
  });

  it('does not multiply the record when the same disagreement repeats', async () => {
    const before = (await sense()).identity_disputed_at;
    expect(await run()).toBe('disputed');
    expect((await sense()).identity_disputed_at).toBe(before);
  });

  it('does not clear itself because the provider went quiet', async () => {
    answer = 'throw';
    expect(await run()).toBe('unavailable');
    expect(await disputeOn(S)).not.toBeNull();
  });

  it('clears itself, without him, when the recognised account is named again', async () => {
    // "Where a condition can safely be resolved autonomously, Foundry should
    // resolve it autonomously." Clearing grants nothing: the recognition this
    // stood in front of was never touched, so what resumes is what he already
    // recognised — proven by the confirmation timestamp being the same one.
    const was = (await sense()).identity_confirmed_at;
    answer = { ok: true, detail: 'Apex Micro Studio (12345678)' };
    expect(await run()).toBe('resolved');
    expect(await disputeOn(S)).toBeNull();
    const row = await sense();
    expect(row.identity_confirmed_at).toBe(was);
    expect((await etsy()).authorised).toBe(true);
  });
});

describe('the database refuses a dispute that is not one', () => {
  it('refuses one that agrees with the account it is about', async () => {
    await expect(query(
      `UPDATE company_senses SET identity_disputed_at = datetime('now'),
              identity_disputed_ref = '12345678', identity_disputed_detail = 'x'
        WHERE id = ?`, [S])).rejects.toThrow(/that_is_the_same_account/);
  });

  it('refuses half of one', async () => {
    await expect(query(
      `UPDATE company_senses SET identity_disputed_at = datetime('now')
        WHERE id = ?`, [S])).rejects.toThrow(/needs_both_halves/);
  });

  it('refuses one with no evidence behind it', async () => {
    await expect(query(
      `UPDATE company_senses SET identity_disputed_at = datetime('now'),
              identity_disputed_ref = '99999999' WHERE id = ?`, [S]))
      .rejects.toThrow(/needs_its_evidence/);
  });

  it('refuses one on a connection that never claimed an identity', async () => {
    await query('INSERT INTO products (id,name,owner_id,status) VALUES (?,?,?,?)',
      ['p_hands2', 'Second', F, 'active']);
    await query(
      `INSERT INTO company_senses (id, product_id, sense_key, provider, mode, disclosure)
       SELECT 'cs_blank', 'p_hands2', sense_key, 'etsy', mode, 'I would read the shop.'
         FROM sense_providers WHERE provider = 'etsy' LIMIT 1`);
    await expect(query(
      `UPDATE company_senses SET identity_disputed_at = datetime('now'),
              identity_disputed_ref = '77', identity_disputed_detail = 'x'
        WHERE id = 'cs_blank'`)).rejects.toThrow(/nothing_to_disagree_with/);
  });
});

describe('a replacement grant inherits nothing', () => {
  // "A new connection must not inherit recognition or operational authority
  // merely because its provider-reported identity resembles a previous
  // connection. Where a prior connection was disconnected, retain its
  // historical evidence without allowing that history to confer authority on
  // the replacement."
  it('disconnects the recognised one and connects the SAME account again', async () => {
    await query(
      "UPDATE sense_credentials SET revoked_at = datetime('now'), revoke_reason = 'replaced', revoked_at_provider = 1 WHERE id = ?",
      [C]);
    const { disconnectSense } = await import('../../src/services/senses/index.js');
    await disconnectSense(S, 'reconnecting');
    const r = (await query(
      "SELECT sense_key, mode FROM sense_providers WHERE provider = 'etsy' LIMIT 1"))
      .rows[0] as Record<string, unknown>;
    await query(
      `INSERT INTO company_senses (id, product_id, sense_key, provider, mode, disclosure)
       VALUES (?,?,?,?,?,?)`,
      ['cs_new', P, String(r.sense_key), 'etsy', String(r.mode), 'I would read the shop.']);
    await query(
      `INSERT INTO sense_credentials (id, company_sense_id, product_id, provider,
         granted_scopes_json, secret_json) VALUES (?,?,?,?,?,?)`,
      ['sc_new', 'cs_new', P, 'etsy', JSON.stringify(['shops_r']),
        encryptCredentialPayload(JSON.stringify({ access_token: 'live2' }))]);
  });

  it('reads the same shop back, and is still unrecognised', async () => {
    answer = { ok: true, detail: 'Apex Micro Studio (12345678)' };
    expect(await run()).toBe('recovered');
    const row = (await query(
      `SELECT provider_account_ref, identity_confirmed_at FROM company_senses
        WHERE id = 'cs_new'`)).rows[0] as Record<string, unknown>;
    expect(row.provider_account_ref).toBe('12345678');
    // The same shop id he recognised in March. It confers nothing in November,
    // because recognition is a fact about a GRANT, not about a shop name.
    expect(row.identity_confirmed_at).toBeNull();
    const e = await etsy();
    expect(e.accountConfirmed).toBe(false);
    expect(e.authorised).toBe(false);
  });

  it('keeps the old connection and its evidence, and keeps it out of the way', async () => {
    const old = (await query(
      `SELECT identity_confirmed_at, identity_confirmed_by, provider_account_ref,
              disconnected_at FROM company_senses WHERE id = ?`, [S]))
      .rows[0] as Record<string, unknown>;
    expect(old.disconnected_at).toBeTruthy();
    // History intact — an incident reconstruction needs to know he once
    // recognised this account through a grant that has since been replaced.
    expect(old.identity_confirmed_at).toBeTruthy();
    expect(String(old.identity_confirmed_by)).toContain('founder:');
    // And never probed again: the pass looks only at live connections, so a
    // withdrawn authorisation is not used to ask the provider anything.
    expect((await recoverIdentities({ productId: P })).looked).toBe(1);
  });
});
