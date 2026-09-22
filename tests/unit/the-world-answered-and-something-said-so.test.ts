// =============================================================================
// THE WORLD ANSWERED, AND SOMETHING SAID SO.
//
// `MATURITY_MAP.md` said of `read_marketplace_account`: "It moves on the first
// real read and not before." That described a transition no code could perform.
// The only general promoter, `checkTheSenses`, selects
// `WHERE supplies_source_type IS NOT NULL`, and migration 344 never set that
// column on `cp_etsy_read`. So the day the owner connected his shop and the
// hourly pass read it, `market_observations` would have filled with real
// readings while the registry that speaks for that capability stayed at
// `declared` — two records of one fact, permanently disagreeing, and the
// registry is the one every other reader consults.
//
// The same absence sat one step earlier: `completeAuthorization` ended at the
// credential INSERT and never asked the provider anything, so "connected" was
// said on the strength of a redeemed code. An exchange proves a code was
// redeemed. It proves nothing about whether the credential can be used or
// whether the account is the one he meant.
//
// The owner's directive, 22 September, names both: "perform its own independent
// read-back of the account identity" and "a configured credential without a
// successful external read must not be presented as a fully operational
// connection."
//
// What is proved here: that a reading promotes only reading, that a rehearsal
// cannot buy reality, that the identity is the provider's answer or absent, and
// that a connection which could not prove itself says so rather than lying.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '5'.repeat(64);
process.env.FOUNDRY_OWNER_EMAIL = 'w@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { witnessAReading } from '../../src/services/senses/witness.js';
import { identityFromProbe } from '../../src/services/senses/credentials.js';
import { Hono } from 'hono';

const F = 'f_witness', P = 'p_witness';

const maturityOf = async (id: string): Promise<string> => String(
  ((await query('SELECT maturity FROM capability_providers WHERE id = ?', [id]))
    .rows[0] as Record<string, unknown>).maturity);

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
    [F, 'c_w', 'w@example.com']);
  await query('INSERT INTO products (id,name,owner_id,status) VALUES (?,?,?,?)',
    [P, 'Apex Micro', F, 'active']);
});

describe('the registry can record what the world proved', () => {
  it('starts where migration 344 left it, which is the whole problem', async () => {
    // Not an assumption about the ladder — the actual row, before anything runs.
    expect(await maturityOf('cp_etsy_read')).toBe('declared');
  });

  it('moves the reading capability on a real read', async () => {
    const r = await witnessAReading({
      provider: 'etsy', evidenceMode: 'real', to: 'reality_proven',
      evidence: 'read Apex Micro (12345678) from Etsy: 0 listings, 0 paid orders',
      witnessedBy: 'experiment:e_1',
    });
    expect(r.promoted).toContain('cp_etsy_read');
    expect(await maturityOf('cp_etsy_read')).toBe('reality_proven');
  });

  it('leaves the writing capabilities exactly where they were', async () => {
    // THE POINT OF KEYING ON THE RUNG. Etsy's write providers hang off the same
    // provider name. A witness that asked "did etsy answer?" would promote a
    // publishing capability because a read succeeded. Reading proves reading.
    const rows = (await query(
      `SELECT p.id, p.maturity, c.rung FROM capability_providers p
         JOIN capabilities c ON c.capability_key = p.capability_key
        WHERE p.provider = 'etsy' AND c.rung <> 'observe'`)).rows as unknown as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(String(r.maturity), String(r.id)).toBe('declared');
  });

  it('keeps the write providers unable to reach the world at all', async () => {
    // The structural guarantee PENDING 25 rests on, re-asserted here because
    // this file is the one that promotes things.
    const rows = (await query(
      "SELECT id, tool FROM capability_providers WHERE provider = 'etsy'"))
      .rows as unknown as Array<Record<string, unknown>>;
    for (const r of rows) expect(r.tool, String(r.id)).toBeNull();
  });

  it('writes a witnessed, evidenced change rather than a silent update', async () => {
    const row = (await query(
      `SELECT to_maturity, evidence, evidence_mode, witnessed_by
         FROM capability_maturity_changes WHERE provider_id = 'cp_etsy_read'
        ORDER BY rowid DESC LIMIT 1`)).rows[0] as Record<string, unknown>;
    expect(row.to_maturity).toBe('reality_proven');
    expect(row.evidence_mode).toBe('real');
    expect(String(row.evidence)).toContain('12345678');
    expect(String(row.witnessed_by)).toBe('experiment:e_1');
  });

  it('does not throw when the same read happens again', async () => {
    // `recordMaturity` aborts on from == to. An hourly pass calling this every
    // hour must not raise, and must not write a second identical change.
    const before = (await query(
      "SELECT COUNT(*) AS n FROM capability_maturity_changes WHERE provider_id = 'cp_etsy_read'"))
      .rows[0] as Record<string, unknown>;
    const r = await witnessAReading({
      provider: 'etsy', evidenceMode: 'real', to: 'reality_proven',
      evidence: 'read it again', witnessedBy: 'experiment:e_1',
    });
    expect(r.promoted).toEqual([]);
    expect(r.because).toBe('already at least this proven');
    const after = (await query(
      "SELECT COUNT(*) AS n FROM capability_maturity_changes WHERE provider_id = 'cp_etsy_read'"))
      .rows[0] as Record<string, unknown>;
    expect(after.n).toBe(before.n);
  });
});

describe('a rehearsal cannot buy reality', () => {
  it('refuses reality_proven for reference evidence, with a sentence', async () => {
    const r = await witnessAReading({
      provider: 'reference_world', evidenceMode: 'reference', to: 'reality_proven',
      evidence: 'the reference world answered', witnessedBy: 'test',
    });
    expect(r.promoted).toEqual([]);
    expect(r.because).toContain('cannot prove the world answered');
  });

  it('says so plainly when a provider declares no observing capability', async () => {
    const r = await witnessAReading({
      provider: 'gumroad', evidenceMode: 'real', to: 'available',
      evidence: 'x', witnessedBy: 'test',
    });
    expect(r.promoted).toEqual([]);
    expect(r.because).toContain('no observing capability');
  });
});

describe('the identity is the provider answer, or it is absent', () => {
  it('reads a shop name and id out of the probe sentence', () => {
    expect(identityFromProbe('Apex Micro (12345678) at https://etsy.com/shop/ApexMicro'))
      .toEqual({ ref: '12345678', label: 'Apex Micro' });
  });

  it('records nothing rather than guessing when it cannot parse', () => {
    // A wrong shop id against a connection is worse than none, because whatever
    // reads it next has no way to know it was invented here.
    for (const s of ['the account answers, and has no shop', '', 'connected']) {
      expect(identityFromProbe(s), s).toEqual({ ref: null, label: null });
    }
  });

  it('takes an id with no name, which is a state the adapter really returns', () => {
    expect(identityFromProbe('(99) at https://example.test'))
      .toEqual({ ref: '99', label: null });
  });
});

describe('an identity is whole, or it is not there', () => {
  let senseId: string;

  beforeAll(async () => {
    // The declared (provider, sense, mode) triple, read from the vocabulary
    // rather than guessed — migration 226's guard refuses anything else, and a
    // fixture that invented one would be testing a state the world cannot hold.
    const r = (await query(
      "SELECT sense_key, mode FROM sense_providers WHERE provider = 'etsy' LIMIT 1"))
      .rows[0] as Record<string, unknown>;
    senseId = 'cs_witness';
    await query(
      `INSERT INTO company_senses (id, product_id, sense_key, provider, mode, disclosure)
       VALUES (?,?,?,?,?,?)`,
      [senseId, P, String(r.sense_key), 'etsy', String(r.mode), 'I would read the shop.']);
  });

  it('refuses a verification time with nothing verified', async () => {
    await expect(query(
      `UPDATE company_senses SET identity_verified_at = datetime('now') WHERE id = ?`,
      [senseId])).rejects.toThrow(/verified_needs_a_reference/);
  });

  it('refuses a reference with no moment it was confirmed', async () => {
    await expect(query(
      'UPDATE company_senses SET provider_account_ref = ? WHERE id = ?',
      ['12345678', senseId])).rejects.toThrow(/a_reference_needs_a_time/);
  });

  it('takes both together', async () => {
    await query(
      `UPDATE company_senses
          SET provider_account_ref = ?, provider_account_label = ?,
              identity_verified_at = datetime('now')
        WHERE id = ?`, ['12345678', 'Apex Micro', senseId]);
    const row = (await query(
      'SELECT provider_account_ref, provider_account_label, identity_verified_at, last_observed_at FROM company_senses WHERE id = ?',
      [senseId])).rows[0] as Record<string, unknown>;
    expect(row.provider_account_ref).toBe('12345678');
    expect(row.provider_account_label).toBe('Apex Micro');
    expect(row.identity_verified_at).toBeTruthy();
    // THE DISTINCTION THE DIRECTIVE ASKED FOR. The provider confirmed who this
    // is; nothing has been read through it. Those are two facts and a panel
    // that collapsed them would call this fully operational.
    expect(row.last_observed_at).toBeNull();
  });

  it('refuses to re-point a connection at a different account', async () => {
    // A rename is a fact, not a failure — the adapter says so. A different
    // account is a different connection, and the owner is owed the
    // disconnect-and-reconnect rather than a row that quietly changes subject.
    await expect(query(
      `UPDATE company_senses SET provider_account_ref = ?, identity_verified_at = datetime('now') WHERE id = ?`,
      ['87654321', senseId])).rejects.toThrow(/immutable_once_set/);
    await query(
      `UPDATE company_senses SET provider_account_label = ?, provider_account_ref = ?, identity_verified_at = datetime('now') WHERE id = ?`,
      ['ApexMicro', '12345678', senseId]);
    const row = (await query(
      'SELECT provider_account_label FROM company_senses WHERE id = ?', [senseId])).rows[0] as Record<string, unknown>;
    expect(row.provider_account_label).toBe('ApexMicro');
  });
});

describe('a listing experiment can actually become ready', () => {
  it('no longer carries a condition nothing can ever clear', async () => {
    // `blocking` and `stateFrom` both count anything that is neither `met` nor
    // `not_applicable`. The refund clause was pushed unconditionally with
    // `waits_for_you`, so `blocked.length === 0` was unreachable and an
    // experiment the owner HAD ALREADY APPROVED reported that it was waiting
    // for him to approve it, permanently.
    const src = await import('node:fs').then((fs) => fs.readFileSync(
      'src/services/venture/qualification.ts', 'utf8'));
    const clause = src.slice(src.indexOf("name: 'a refund can be carried out'"));
    expect(clause.slice(0, 200)).toContain("verdict: 'not_applicable'");
    // NOT `met`, which would assert a refund executor that does not exist
    // against a public promise on /refunds.
    expect(clause.slice(0, 200)).not.toContain("verdict: 'met'");
    expect(clause).toContain('rather than a condition on my readiness');
  });
});

describe('authorised and never exercised does not read as working', () => {
  // THE STATE THE DIRECTIVE SINGLES OUT: "a configured credential without a
  // successful external read must not be presented as a fully operational
  // connection." The connection above has an identity the provider confirmed
  // and no reading at all. What the owner is shown has to say both.
  let app: Hono;

  beforeAll(async () => {
    const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
    app = new Hono();
    app.use('*', async (c, next) => {
      c.set('founder', { id: F, email: 'w@example.com' }); await next();
    });
    app.route('/', foundryShellRoutes);
  });

  const companyPage = async (): Promise<string> => {
    const res = await app.request(`/foundry/companies/${P}`);
    expect(res.status, 'the company page did not render').toBe(200);
    return res.text();
  };

  it('names the account the provider confirmed', async () => {
    // Rendered, not grepped. The identity was captured from Etsy's own answer;
    // a hard-coded shop name is what the directive forbids.
    expect(await companyPage()).toContain('ApexMicro');
  });

  it('says nothing has been read through it, in the same breath', async () => {
    const html = await companyPage();
    expect(html).toContain('nothing has been read through it yet');
  });

  it('does not claim it last reported, because it never has', async () => {
    const html = await companyPage();
    expect(html).not.toContain('Last reported');
  });

  it('still says what the connection does not permit', async () => {
    // Seeing is not permission to act, and that sentence is not optional
    // garnish — it is the one the owner agreed to.
    expect(await companyPage()).toContain('None of this lets me act');
  });
});
