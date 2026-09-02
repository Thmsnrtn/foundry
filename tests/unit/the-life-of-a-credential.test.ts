process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  beginAuthorization, completeAuthorization, credentialFor, probeCredential,
  renewCredentials, requiredScopes, revokeCredential,
} from '../../src/services/senses/credentials.js';
import { senseProvider } from '../../src/services/senses/providers/contract.js';
import { connectedSenses } from '../../src/services/senses/index.js';

// =============================================================================
// THE LIFE OF A CREDENTIAL.
//
// Asked for, granted, stored, renewed, failing, revoked, gone. The owner asked
// for this to be CONTROLLED-PROVEN before a real key is requested, and that is
// what this file is: every step travelled with no network, no secret and
// nothing to reach — by the reference provider, which is made to walk the whole
// path precisely so that none of it is discovered for the first time on a real
// account.
//
// THE STEPS THAT GO WRONG ARE THE ONES BETWEEN. A callback replayed. A scope
// granted narrower than the one asked for. A renewal failure mistaken for an
// outage. A local delete reported as a revocation the provider never confirmed.
// Each of those has its own assertion here, because each of them, unasserted,
// would leave the owner believing something is watched when it is not.
// =============================================================================

const OWNER = 'cl_owner';
const CO = 'cl_co';
const REDIRECT = 'https://foundry.example/foundry/senses/callback';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_cl', 'owner@example.com', 'Owner']);
  await query(
    `INSERT INTO products (id,name,owner_id,status,reality)
     VALUES (?,'Northgate',?,'active','reference')`, [CO, OWNER]);
  await query(
    `INSERT INTO reference_companies (product_id, scenario, purpose)
     VALUES (?,'a company that does not exist','exercising the credential lifecycle')`,
    [CO]);
});

describe('the minimum scope is a property, not a promise', () => {
  it('comes from a constitutional table nothing can widen', async () => {
    const scopes = await requiredScopes('stripe', 'revenue', 'real');
    expect(scopes.map((s) => s.scope)).toEqual(['read_only']);
    // Every scope says what it is for, because that is what the owner reads
    // before he grants it.
    expect(scopes[0]?.because).toContain('nothing else');
    // check-vocabulary:expected-refusal
    await expect(query(
      `INSERT INTO sense_provider_scopes (provider,sense_key,mode,scope,because)
       VALUES ('stripe','revenue','real','write_all','x')`))
      .rejects.toThrow(/constitutional/);
  });

  it('asks for read-only everywhere, which is what "a sense is not a hand" means', async () => {
    const all = (await query(
      'SELECT DISTINCT scope FROM sense_provider_scopes ORDER BY scope', []))
      .rows as unknown as Array<Record<string, unknown>>;
    for (const row of all) {
      expect(String(row.scope), 'no scope may permit writing').not.toMatch(/write|admin|delete|manage/);
    }
  });

  it('puts exactly those scopes in the authorize URL and nothing else', async () => {
    const started = await beginAuthorization({
      productId: CO, founderId: OWNER, companyName: 'Northgate',
      senseKey: 'revenue', provider: 'reference_world', mode: 'reference',
      redirectUri: REDIRECT,
    });
    if ('failed' in started) throw new Error(started.ownerWords);
    expect(started.authorizeUrl).toContain('scope=reference%3Aread');
    expect(started.scopes.map((s) => s.scope)).toEqual(['reference:read']);
    // And what he was shown is stored as what he agreed to, so consent is
    // provable against the words he actually saw.
    const stored = (await query(
      'SELECT disclosure, scopes_json FROM sense_authorizations WHERE state = ?',
      [started.state])).rows[0] as Record<string, unknown>;
    expect(String(stored.disclosure)).toContain('would NOT let me');
    expect(JSON.parse(String(stored.scopes_json))).toEqual(['reference:read']);
  });
});

describe('the round trip', () => {
  it('stores an encrypted credential bound to the company and the sense', async () => {
    const started = await beginAuthorization({
      productId: CO, founderId: OWNER, companyName: 'Northgate',
      senseKey: 'customers', provider: 'reference_world', mode: 'reference',
      redirectUri: REDIRECT,
    });
    if ('failed' in started) throw new Error(started.ownerWords);

    const { issueReferenceCode } = await import(
      '../../src/services/senses/providers/reference.js');
    const code = issueReferenceCode(started.state, ['reference:read']);
    const done = await completeAuthorization({
      state: started.state, code, founderId: OWNER, redirectUri: REDIRECT,
    });
    expect(done.connected).toBe(true);
    if (!done.connected) return;

    const credential = await credentialFor(done.senseId);
    expect(credential?.provider).toBe('reference_world');

    // ENCRYPTED AT REST. A secret readable by anything that can read the table
    // is not stored, it is published.
    const raw = (await query(
      'SELECT secret_json FROM sense_credentials WHERE company_sense_id = ?',
      [done.senseId])).rows[0] as Record<string, unknown>;
    expect(String(raw.secret_json)).not.toContain('reference-token');
    const { isEncrypted } = await import('../../src/services/encryption.js');
    expect(isEncrypted(String(raw.secret_json))).toBe(true);
  });

  it('refuses a replayed callback', async () => {
    // The same code arriving twice — a retry, a back button, someone else —
    // must not bind a second credential.
    const started = await beginAuthorization({
      productId: CO, founderId: OWNER, companyName: 'Northgate',
      senseKey: 'support', provider: 'reference_world', mode: 'reference',
      redirectUri: REDIRECT,
    });
    if ('failed' in started) throw new Error(started.ownerWords);
    const { issueReferenceCode } = await import(
      '../../src/services/senses/providers/reference.js');
    const code = issueReferenceCode(started.state, ['reference:read']);

    expect((await completeAuthorization({
      state: started.state, code, founderId: OWNER, redirectUri: REDIRECT })).connected)
      .toBe(true);
    const replay = await completeAuthorization({
      state: started.state, code, founderId: OWNER, redirectUri: REDIRECT });
    expect(replay.connected).toBe(false);
    if (!replay.connected) expect(replay.ownerWords).toContain('already used');
  });

  it('refuses a state nobody started, and one belonging to someone else', async () => {
    const nobody = await completeAuthorization({
      state: 'invented-state-that-nobody-issued', code: 'refcode_x',
      founderId: OWNER, redirectUri: REDIRECT });
    expect(nobody.connected).toBe(false);

    // Someone else's authorisation answers identically: nothing is revealed
    // about whether it existed.
    await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
      ['cl_other', 'c_o', 'o@e.com']);
    const mine = await beginAuthorization({
      productId: CO, founderId: OWNER, companyName: 'Northgate',
      senseKey: 'product_usage', provider: 'reference_world', mode: 'reference',
      redirectUri: REDIRECT,
    });
    if ('failed' in mine) throw new Error(mine.ownerWords);
    const theirs = await completeAuthorization({
      state: mine.state, code: 'refcode_x', founderId: 'cl_other', redirectUri: REDIRECT });
    expect(theirs.connected).toBe(false);
    if (!theirs.connected) expect(theirs.ownerWords).toContain('do not have a record');
  });

  it('refuses a grant narrower than what was asked for', async () => {
    // A provider that hands back less leaves a credential that cannot answer
    // the question it was obtained for. Refusing now is better than an empty
    // page discovered a week later.
    const CO2 = 'cl_co2';
    await query(
      `INSERT INTO products (id,name,owner_id,status,reality)
       VALUES (?,'Narrow',?,'active','reference')`, [CO2, OWNER]);
    await query(
      `INSERT INTO reference_companies (product_id, scenario, purpose)
       VALUES (?,'narrow grants','exercising a partial grant')`, [CO2]);
    const started = await beginAuthorization({
      productId: CO2, founderId: OWNER, companyName: 'Narrow',
      senseKey: 'revenue', provider: 'reference_world', mode: 'reference',
      redirectUri: REDIRECT,
    });
    if ('failed' in started) throw new Error(started.ownerWords);

    const { issueReferenceCode } = await import(
      '../../src/services/senses/providers/reference.js');
    // Issued with NO scopes: the provider grants nothing of what was requested.
    const code = issueReferenceCode(started.state, []);
    const done = await completeAuthorization({
      state: started.state, code, founderId: OWNER, redirectUri: REDIRECT });
    expect(done.connected).toBe(false);
    if (!done.connected) expect(done.ownerWords).toContain('granted less than I need');
    // And nothing was attached.
    expect((await connectedSenses(CO2)).length).toBe(0);
  });

  it('refuses a code the provider never issued', async () => {
    const started = await beginAuthorization({
      productId: CO, founderId: OWNER, companyName: 'Northgate',
      senseKey: 'product_usage', provider: 'reference_world', mode: 'reference',
      redirectUri: REDIRECT,
    });
    if ('failed' in started) throw new Error(started.ownerWords);
    const done = await completeAuthorization({
      state: started.state, code: 'not-a-real-code', founderId: OWNER,
      redirectUri: REDIRECT });
    expect(done.connected).toBe(false);
    if (!done.connected) expect(done.ownerWords).toContain('did not recognise');
  });
});

describe('keeping it alive', () => {
  it('renews what is near expiry', async () => {
    const before = (await query(
      `SELECT id, expires_at FROM sense_credentials
        WHERE product_id = ? AND revoked_at IS NULL ORDER BY rowid LIMIT 1`, [CO]))
      .rows[0] as Record<string, unknown>;
    const outcome = await renewCredentials(48);
    expect(outcome.renewed).toBeGreaterThan(0);
    expect(outcome.failed).toBe(0);

    const after = (await query(
      'SELECT expires_at, refreshed_at, failures FROM sense_credentials WHERE id = ?',
      [String(before.id)])).rows[0] as Record<string, unknown>;
    expect(after.refreshed_at).not.toBeNull();
    expect(Number(after.failures)).toBe(0);
  });

  it('a renewal failure makes the sense go blind, said out loud', async () => {
    // THE FAILURE THIS PREVENTS: serving month-old numbers with a confident
    // face because a token quietly stopped working.
    const { encryptCredentialPayload } = await import('../../src/services/encryption.js');
    const target = (await query(
      `SELECT c.id, c.company_sense_id FROM sense_credentials c
        WHERE c.product_id = ? AND c.revoked_at IS NULL ORDER BY c.rowid LIMIT 1`, [CO]))
      .rows[0] as Record<string, unknown>;
    await query(
      `UPDATE sense_credentials SET secret_json = ?, expires_at = datetime('now','+1 hour')
        WHERE id = ?`,
      [encryptCredentialPayload(JSON.stringify({ token: 'reference-token-refuse-refresh' })),
        String(target.id)]);

    const outcome = await renewCredentials(48);
    expect(outcome.failed).toBeGreaterThan(0);
    expect(outcome.broke.some((b) => b.productId === CO)).toBe(true);

    // And it reaches the place the owner reads.
    const sense = (await connectedSenses(CO))
      .find((sn) => sn.id === String(target.company_sense_id));
    expect(sense?.lastError).toContain('refused to renew');

    // Which the situation engine turns into the one sentence at the top.
    const { whatSituation } = await import('../../src/services/founder/what-situation.js');
    const read = await whatSituation(CO);
    expect(read.situation).toBe('blind');
    expect(read.demandsAttention).toBe(true);
  });

  it('notices a credential that died quietly', async () => {
    const { encryptCredentialPayload } = await import('../../src/services/encryption.js');
    const target = (await query(
      `SELECT id, company_sense_id FROM sense_credentials
        WHERE product_id = ? AND revoked_at IS NULL ORDER BY rowid DESC LIMIT 1`, [CO]))
      .rows[0] as Record<string, unknown>;
    await query('UPDATE sense_credentials SET secret_json = ? WHERE id = ?',
      [encryptCredentialPayload(JSON.stringify({ token: 'reference-token-dead' })),
        String(target.id)]);

    const probe = await probeCredential(String(target.company_sense_id));
    expect(probe?.ok).toBe(false);
    const after = (await query(
      'SELECT failures FROM sense_credentials WHERE id = ?', [String(target.id)]))
      .rows[0] as Record<string, unknown>;
    expect(Number(after.failures)).toBeGreaterThan(0);
  });
});

describe('giving it back', () => {
  it('asks the provider first, and records that it confirmed', async () => {
    const sense = (await connectedSenses(CO))[0];
    if (!sense) throw new Error('expected a sense');
    const result = await revokeCredential({ senseId: sense.id, reason: 'the owner said so' });
    expect(result?.confirmedByProvider).toBe(true);
    expect(result?.ownerWords).toContain('confirmed');
    expect(await credentialFor(sense.id)).toBeNull();
  });

  it('says so when the provider did not confirm, rather than claiming it did', async () => {
    // A LOCAL DELETE IS NOT A REVOCATION. Reporting one as the other would
    // leave the owner believing a key is dead while it is live at the other end
    // — the most dangerous thing this path could say.
    const { encryptCredentialPayload } = await import('../../src/services/encryption.js');
    // A sense that still HAS a live credential, asked for as a query rather
    // than found with an async predicate — `Array.find` takes the promise as
    // truthy and returns the first element whatever the answer was.
    const live = (await query(
      `SELECT c.id, c.company_sense_id FROM sense_credentials c
         JOIN company_senses s ON s.id = c.company_sense_id
        WHERE c.product_id = ? AND c.revoked_at IS NULL AND s.disconnected_at IS NULL
        ORDER BY c.rowid LIMIT 1`, [CO])).rows[0] as Record<string, unknown> | undefined;
    if (!live) throw new Error('expected a live credential');
    const sense = { id: String(live.company_sense_id) };
    const credential = { id: String(live.id) };
    await query('UPDATE sense_credentials SET secret_json = ? WHERE id = ?',
      [encryptCredentialPayload(JSON.stringify({ token: 'reference-token-refuse-revoke' })),
        credential.id]);

    const result = await revokeCredential({ senseId: sense.id, reason: 'the owner said so' });
    expect(result?.confirmedByProvider).toBe(false);
    expect(result?.ownerWords).toContain('did not confirm');
    expect(result?.ownerWords).toContain('revoke Foundry');
    // Foundry forgets it either way: keeping a secret it was told to drop,
    // because the provider was unreachable, is the opposite mistake.
    expect(await credentialFor(sense.id)).toBeNull();
    const row = (await query(
      'SELECT revoked_at_provider FROM sense_credentials WHERE id = ?', [credential.id]))
      .rows[0] as Record<string, unknown>;
    expect(Number(row.revoked_at_provider)).toBe(0);
  });

  it('cannot be un-revoked, and cannot be erased', async () => {
    const row = (await query(
      `SELECT id FROM sense_credentials WHERE product_id = ? AND revoked_at IS NOT NULL
        ORDER BY rowid LIMIT 1`, [CO])).rows[0] as Record<string, unknown>;
    await expect(query(
      'UPDATE sense_credentials SET revoked_at = NULL WHERE id = ?', [String(row.id)]))
      .rejects.toThrow(/already_revoked/);
    await expect(query('DELETE FROM sense_credentials WHERE id = ?', [String(row.id)]))
      .rejects.toThrow(/immutable/);
  });
});

describe('a provider Foundry cannot ask yet', () => {
  it('says so instead of offering a button that would fail', async () => {
    // `plausible` is a declared source with no adapter written. The honest
    // answer names it and says nothing is missing on his side.
    expect(await senseProvider('plausible')).toBeNull();
    const REAL = 'cl_real';
    await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,'Real Co',?,'active')",
      [REAL, OWNER]);
    const started = await beginAuthorization({
      productId: REAL, founderId: OWNER, companyName: 'Real Co',
      senseKey: 'product_usage', provider: 'plausible', mode: 'real',
      redirectUri: REDIRECT,
    });
    expect('failed' in started).toBe(true);
    if ('failed' in started) {
      expect(started.ownerWords).toContain('cannot ask it for permission yet');
    }
  });

  it('refuses to ask Stripe when the deployment has no Stripe configured', async () => {
    // A button that leads to a provider error page is worse than a button that
    // is not there.
    const previous = process.env.STRIPE_CONNECT_CLIENT_ID;
    delete process.env.STRIPE_CONNECT_CLIENT_ID;
    try {
      const started = await beginAuthorization({
        productId: 'cl_real', founderId: OWNER, companyName: 'Real Co',
        senseKey: 'revenue', provider: 'stripe', mode: 'real', redirectUri: REDIRECT,
      });
      expect('failed' in started).toBe(true);
      if ('failed' in started) {
        expect(started.ownerWords).toContain('no Stripe connection configured');
      }
    } finally {
      if (previous !== undefined) process.env.STRIPE_CONNECT_CLIENT_ID = previous;
    }
  });
});

describe('the owner walks it', () => {
  const app = async (): Promise<Hono> => {
    const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
    const a = new Hono();
    a.use('*', async (c, next) => {
      c.set('founder' as never,
        { id: OWNER, email: 'owner@example.com', name: 'Owner' } as never);
      c.set('csrfToken' as never, 'test' as never);
      await next();
    });
    a.route('/', foundryShellRoutes as never);
    return a;
  };

  it('goes from "I cannot see X" to a real authorisation and back', async () => {
    const CO3 = 'cl_walk';
    await query(
      `INSERT INTO products (id,name,owner_id,status,reality)
       VALUES (?,'Walkabout',?,'active','reference')`, [CO3, OWNER]);
    await query(
      `INSERT INTO reference_companies (product_id, scenario, purpose)
       VALUES (?,'walking the whole path','proving the round trip')`, [CO3]);
    const a = await app();

    // 1. The gap, in his question — and the exact scopes he is being asked for.
    const offer = await (await a.request(`/foundry/companies/${CO3}/see/revenue`)).text();
    expect(offer).toContain('Let me see what it earns?');
    expect(offer).toContain('What I would ask for');
    expect(offer).toContain('reference:read');
    expect(offer).toContain('I cannot ask for more than this');

    // 2. He taps it, and is sent to the provider.
    const away = await a.request(`/foundry/companies/${CO3}/see/revenue`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'provider=reference_world&mode=reference',
    });
    expect(away.status).toBe(302);
    const authorizeUrl = away.headers.get('location') ?? '';
    expect(authorizeUrl).toContain('/foundry/senses/reference-authorize');

    // 3. The provider does its part and sends him back with a code.
    const back = await a.request(authorizeUrl);
    expect(back.status).toBe(302);
    const callback = back.headers.get('location') ?? '';
    expect(callback).toContain('/foundry/senses/callback');

    // 4. The callback completes it.
    const landed = await a.request(new URL(callback).pathname + new URL(callback).search);
    expect(landed.status).toBe(302);
    expect(landed.headers.get('location'))
      .toBe(`/foundry/companies/${CO3}?done=seeing&sense=revenue`);

    // 5. AND HIS UNDERSTANDING ACTUALLY CHANGED — which is what he is told,
    // rather than "integration connected".
    const page = await (await a.request(
      `/foundry/companies/${CO3}?done=seeing&sense=revenue`)).text();
    expect(page).toContain('I can see it now');
    expect(page).toContain('revenue, subscriptions, failed payments');
    expect(page).toContain('I still cannot move money');
    expect(page).not.toContain('I cannot see what it earns');
  });

  it('tells him plainly when the provider refuses', async () => {
    const a = await app();
    const refused = await (await a.request(
      '/foundry/senses/callback?error_description=the%20user%20said%20no')).text();
    expect(refused).toContain('That did not connect');
    expect(refused).toContain('the user said no');
    expect(refused).toContain('I have not\n          stored anything');
  });
});
