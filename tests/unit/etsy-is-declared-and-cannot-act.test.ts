// =============================================================================
// ETSY IS DECLARED, AND CANNOT ACT.
//
// The owner has an Etsy seller shop, renamed from Printbls4YouStudio to
// ApexMicro, with no listing published. He authorised none of: access to the
// account, publication, or fees — and said so in as many words: "Do not assume
// that renaming the shop grants Foundry access to the account or authority to
// publish listings or incur fees."
//
// So this wave names the acts and grades them, and stops. Every proof here is
// about something NOT being possible yet, which is an awkward thing to test and
// the only honest thing to test.
//
// FOUR ACTS, NOT ONE. Etsy's own documentation makes publishing a digital
// download four calls — create a draft, upload the file, upload an image, set
// the state to active — and only the last is public and only the last costs
// money. That is not a distinction this schema had to be taught: it is what
// `capabilities.rung` already means. An approval of one is no approval of
// another, and the rows are what make that true rather than a paragraph.
//
// AND THE SHOP IS VERIFIED, NEVER ASSUMED. A rename changes a display name and
// a public URL; it does not change a shop id, and it does not tell this
// institution which shop a credential opens. The adapter reads the identity
// back from the account at exchange and at every probe, and the qualification
// reader refuses to call the shop confirmed until something has.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '9'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { senseProvider } from '../../src/services/senses/providers/contract.js';

beforeAll(async () => { await runMigrations(); });

describe('the four acts are named and graded before anything can perform them', () => {
  it('grades preparing and publishing differently, because they are different', async () => {
    const rows = (await query(
      `SELECT c.capability_key, c.rung, c.draws_on_allowance
         FROM capabilities c
        WHERE c.capability_key IN ('draft_on_marketplace','upload_product_file','list_on_marketplace')`))
      .rows as unknown as Array<Record<string, unknown>>;
    const by = new Map(rows.map((r) => [String(r.capability_key), r]));

    // Nothing is public until the last step.
    expect(String(by.get('draft_on_marketplace')!.rung)).toBe('prepare');
    expect(String(by.get('upload_product_file')!.rung)).toBe('prepare');
    expect(String(by.get('list_on_marketplace')!.rung)).toBe('public');
  });

  it('makes activation draw on an allowance, because activation is what charges', async () => {
    // Etsy's fee page, recorded as an observation against this very test:
    // $0.20 per listing for four months, renewing at $0.20 on each sale. A
    // capability that charges the owner without a declared amount covered by
    // an allowance is what `draws_on_allowance` exists to stop.
    const r = (await query(
      `SELECT draws_on_allowance FROM capabilities WHERE capability_key = 'list_on_marketplace'`))
      .rows[0] as Record<string, unknown>;
    expect(Number(r.draws_on_allowance)).toBe(1);
    // And the preparing steps do not, because a draft is free.
    const d = (await query(
      `SELECT draws_on_allowance FROM capabilities WHERE capability_key = 'draft_on_marketplace'`))
      .rows[0] as Record<string, unknown>;
    expect(Number(d.draws_on_allowance)).toBe(0);
  });

  it('records what activation actually costs, in the row rather than in prose', async () => {
    const r = (await query(
      `SELECT cost_note FROM capability_providers WHERE id = 'cp_etsy_activate'`))
      .rows[0] as Record<string, unknown>;
    expect(String(r.cost_note)).toContain('$0.20');
    expect(String(r.cost_note)).toContain('6.5%');
  });
});

describe('nothing declared here can reach the world', () => {
  it('binds no tool at all, which is how this schema says "cannot act"', async () => {
    // EVERY Etsy provider, not a chosen subset. A later wave added a READ
    // capability for the same account, and it carries no tool either — a read
    // causes no external effect and has no business at a door built for
    // mutations. So this assertion did not have to be relaxed to let it in,
    // which is the test it was really facing.
    const rows = (await query(
      `SELECT id, tool, maturity FROM capability_providers WHERE provider = 'etsy'`))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of rows) {
      // `consequenceAllows` refuses a tool bound to nothing; a capability with
      // no tool has no door to arrive at.
      expect(r.tool, String(r.id)).toBeNull();
      // Nothing arrives proven.
      expect(String(r.maturity), String(r.id)).toBe('declared');
    }
  });

  it('registers no handler on the gateway', async () => {
    const { toolIsRegistered } = await import('../../src/services/outbound/gateway.js');
    for (const t of ['etsy_create_draft_listing', 'etsy_upload_listing_file', 'etsy_activate_listing']) {
      expect(toolIsRegistered(t), t).toBe(false);
    }
  });

  it('asks Etsy for read scopes only, and cannot widen them', async () => {
    const rows = (await query(
      `SELECT scope FROM sense_provider_scopes WHERE provider = 'etsy' ORDER BY scope`))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(rows.map((r) => String(r.scope))).toEqual(['listings_r', 'shops_r', 'transactions_r']);
    // The one that would let a credential publish is absent from the code
    // itself, deliberately. The header names it to explain the absence.
    expect(codeOf('src/services/senses/providers/etsy.ts')).not.toContain('listings_w');
  });

  it('keeps the scope list constitutional, so an adapter cannot add one', async () => {
    await expect(query(
      `INSERT INTO sense_provider_scopes (provider, sense_key, mode, scope, because)
       VALUES ('etsy','revenue','real','listings_w','to publish')`))
      .rejects.toThrow(/constitutional/);
  });
});

/** The code only. The header explains what is deliberately absent, by naming it. */
const codeOf = (path: string): string => readFileSync(path, 'utf8')
  .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

describe('the shop is read back, never remembered', () => {
  const src = codeOf('src/services/senses/providers/etsy.ts');

  it('hard-codes no shop name, so a rename cannot make it wrong', () => {
    expect(src).not.toContain('Printbls4YouStudio');
    expect(src).not.toMatch(/shop_name\s*[:=]\s*['"]/);
  });

  it('asks the account whose shop this is, at connection and at every probe', () => {
    expect(src).toContain('users/me');
    expect(src).toContain('whoseShop');
    // Both paths use it: the exchange records it, the probe re-reads it.
    const exchange = src.slice(src.indexOf('async exchange'), src.indexOf('async refresh'));
    const probe = src.slice(src.indexOf('async probe'));
    expect(exchange).toContain('whoseShop');
    expect(probe).toContain('whoseShop');
  });

  it('carries the proof Etsy requires on every authorization', () => {
    expect(src).toContain('code_challenge_method');
    expect(src).toContain('S256');
    // And refuses to start without it rather than sending him to a page that
    // will reject him.
    expect(src).toContain('if (!codeChallenge)');
  });

  it('says a revocation it could not confirm is local only', () => {
    // Etsy publishes no revocation endpoint this environment could read.
    // Throwing is the contract's way of saying the provider did not confirm.
    expect(src).toContain('remove this app under your Etsy');
  });
});

describe('the credential flow carries a verifier that never leaves the row', () => {
  it('stores it on the single-use authorization, not in the credential vault', async () => {
    const cols = (await query(`PRAGMA table_info(sense_authorizations)`))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(cols.map((c) => String(c.name))).toContain('code_verifier');
  });

  it('derives the challenge from it rather than sending the verifier', () => {
    const src = readFileSync('src/services/senses/credentials.ts', 'utf8');
    expect(src).toContain("createHash('sha256').update(codeVerifier)");
    expect(src).toContain("digest('base64url')");
    // What goes to the provider is the challenge.
    expect(src).toContain('codeChallenge');
  });
});

describe('the adapter exists and refuses cleanly with no app registered', () => {
  it('is registered as a provider', async () => {
    const adapter = await senseProvider('etsy');
    expect(adapter).not.toBeNull();
    expect(adapter!.provider).toBe('etsy');
  });

  it('will not build an authorize URL without an application key, and says why', async () => {
    // The key is HANDED IN now rather than read from the environment — the one
    // thing this adapter used to choose for itself, while its scopes were
    // handed to it precisely so it could not.
    const adapter = (await senseProvider('etsy'))!;
    expect(() => adapter.authorizeUrl({
      scopes: ['shops_r'], state: 's', redirectUri: 'https://example.com/cb',
      codeChallenge: 'c', appCredential: null,
    })).toThrow(/no Etsy application key/);
  });

  it('cannot reach for a key it was not given', () => {
    const src = readFileSync('src/services/senses/providers/etsy.ts', 'utf8');
    // Named in the header to explain the absence; absent from the code.
    expect(codeOf('src/services/senses/providers/etsy.ts')).not.toContain('process.env');
    expect(src).toContain('appKey(appCredential)');
  });
});
