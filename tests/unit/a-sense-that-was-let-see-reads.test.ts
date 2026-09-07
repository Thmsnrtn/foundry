process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { encryptCredentialPayload } from '../../src/services/encryption.js';
import { connectSense } from '../../src/services/senses/index.js';
import { readSenses } from '../../src/services/senses/read.js';
import { openUndertaking, stepOn, threadOf } from '../../src/services/institution/undertaking.js';
import { JOB_REGISTRY } from '../../src/jobs/index.js';

// =============================================================================
// A SENSE THAT WAS LET SEE, READS.
//
// Before this leg, a company that connected Stripe as a sense had a credential
// that was probed hourly and renewed near expiry — and nothing ever read
// through it. The only Stripe reader was the legacy hourly sync over the
// `integrations` table, which the sense path does not populate. "Connected"
// was true; "has ever reported" was never true; no row told them apart.
//
// What this file proves, with Stripe stubbed at the network edge and nothing
// else faked:
//
//   - a live, credentialed sense produces one revenue snapshot, one observation
//     on the channel its MODE decides (sandbox stays test evidence), and a
//     `last_observed_at`; and it does so ONCE a day, however often the job runs;
//   - a page Stripe refuses writes NO snapshot: the sense carries the error, the
//     credential's failures climb, and the owner is shown a blind sense, never a
//     confident zero — the exact defect the legacy sync had;
//   - the first report is an event: a thread that had said "I cannot see
//     revenue" hears that it now can, and only that thread;
//   - the job is registered, daily, and reads — it is not a Hand.
// =============================================================================

const F = 'f_read';
let n = 0;
/** A fresh company per test: credentials and senses are append-only by trigger. */
async function company(name: string): Promise<string> {
  n += 1;
  const id = `p_read_${String(n)}`;
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?, ?, ?, 'active')", [id, name, F]);
  return id;
}

function stripe(status: number, subs: unknown[] = []): void {
  const page = (data: unknown[]) => ({
    ok: status < 400, status,
    json: async () => (status < 400 ? { data, has_more: false } : { error: { message: 'no' } }),
    text: async () => JSON.stringify(status < 400 ? { data, has_more: false } : { error: { message: 'no' } }),
  });
  vi.stubGlobal('fetch', async (url: string) => {
    if (String(url).includes('/subscriptions') && String(url).includes('status=active')) return page(subs);
    return page([]);
  });
}

async function connectedWithKey(productId: string, mode: 'real' | 'sandbox'): Promise<string> {
  const connected = await connectSense({ productId, companyName: 'Acme', senseKey: 'revenue', provider: 'stripe', mode });
  if (!connected) throw new Error('no stripe revenue offer');
  await query(
    `INSERT INTO sense_credentials (id, company_sense_id, product_id, provider, granted_scopes_json, secret_json)
     VALUES (?,?,?,?,?,?)`,
    [`cred_${connected.id}`, connected.id, productId, 'stripe', '["read_only"]',
      encryptCredentialPayload(JSON.stringify({ access_token: 'sk_test_x', stripe_account_id: 'acct_1' }))]);
  return connected.id;
}

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES (?, 'c_read', 'read@example.com')", [F]);
});
beforeEach(async () => {
  await query('DELETE FROM undertaking_steps'); await query('DELETE FROM undertakings');
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('a connected sense with a live credential', () => {
  it('reads one revenue snapshot a day, through the credential, on the channel its mode decides', async () => {
    const P = await company('Acme');
    await connectedWithKey(P, 'sandbox');
    // An observation is a movement, so there must be a yesterday to move from.
    await query(`INSERT INTO metric_snapshots (id, product_id, snapshot_date, active_users)
                 VALUES ('snap_y', ?, date('now', '-1 day'), 0)`, [P]);
    stripe(200, [{ id: 'sub_a', status: 'active', created: 1, canceled_at: null,
      items: { data: [{ price: { unit_amount: 50000, recurring: { interval: 'month' } } }] } }]);

    const first = await readSenses();
    expect(first.read, 'one sense read').toBe(1);
    expect(first.failed).toBe(0);

    const snap = (await query('SELECT mrr_cents, active_users FROM metric_snapshots WHERE product_id = ? AND snapshot_date = date(\'now\')', [P]))
      .rows[0] as Record<string, unknown>;
    expect(Number(snap.mrr_cents)).toBe(50000);
    expect(Number(snap.active_users)).toBe(1);

    const sense = (await query('SELECT last_observed_at, last_error FROM company_senses WHERE product_id = ?', [P]))
      .rows[0] as Record<string, unknown>;
    expect(sense.last_observed_at).toBeTruthy();
    expect(sense.last_error).toBeNull();

    // Sandbox evidence stays sandbox evidence: the observation is on the test
    // channel, and never on the real one.
    const events = (await query(
      `SELECT source, event_type FROM signal_events WHERE product_id = ?`, [P])).rows as unknown as Array<Record<string, unknown>>;
    expect(events.length, 'the read reported through the observation channel').toBeGreaterThan(0);
    expect(events.every((e) => String(e.source).startsWith('sandbox')), JSON.stringify(events)).toBe(true);

    // Same day, run again: nothing to do, one snapshot still.
    const again = await readSenses();
    expect(again.read).toBe(0);
    expect(again.nothingToDo).toBe(1);
    expect((await query("SELECT COUNT(*) AS n FROM metric_snapshots WHERE product_id = ? AND snapshot_date = date('now')", [P])).rows[0]).toMatchObject({ n: 1 });
  });

  it('writes no snapshot when Stripe refuses, and says the sense is blind', async () => {
    const P = await company('Acme Two');
    await connectedWithKey(P, 'real');
    stripe(401);

    const outcome = await readSenses();
    expect(outcome.read).toBe(0);
    expect(outcome.failed).toBe(1);
    expect(outcome.broke[0]?.why).toMatch(/401/);

    expect((await query('SELECT COUNT(*) AS n FROM metric_snapshots WHERE product_id = ?', [P])).rows[0],
      'a refused page is not an empty page').toMatchObject({ n: 0 });
    const sense = (await query('SELECT last_observed_at, last_error FROM company_senses WHERE product_id = ?', [P]))
      .rows[0] as Record<string, unknown>;
    expect(String(sense.last_error)).toMatch(/401/);
    const cred = (await query('SELECT failures, last_failure FROM sense_credentials WHERE product_id = ?', [P]))
      .rows[0] as Record<string, unknown>;
    expect(Number(cred.failures)).toBe(1);
    expect(String(cred.last_failure)).toMatch(/401/);
    // The attempt is on record, with its error: a sense the owner can see is blind.
    expect(sense.last_observed_at).toBeTruthy();
  });

  it('is skipped without a credential, and never reads the reference world', async () => {
    const P = await company('Acme Three');
    await connectSense({ productId: P, companyName: 'Acme', senseKey: 'revenue', provider: 'stripe', mode: 'sandbox' });
    let calls = 0;
    vi.stubGlobal('fetch', async () => { calls += 1; return { ok: true, status: 200, json: async () => ({ data: [], has_more: false }), text: async () => '' }; });
    const outcome = await readSenses();
    expect(outcome.read).toBe(0);
    expect(calls, 'no credential, no request').toBe(0);
  });
});

describe('the first report is an event', () => {
  it('reaches the thread that said it could not see revenue, and only that thread', async () => {
    const P = await company('Acme Four');
    const P2 = await company('Other');
    await connectedWithKey(P, 'sandbox');
    const waiting = await openUndertaking({ founderId: F, productId: P, kind: 'understand', asked: 'Understand Acme', understoodAs: 'understand Acme', openedBy: `founder:${F}`, from: { kind: 'owner', id: null } });
    await stepOn(waiting!.id, { kind: 'needs', said: 'I cannot see revenue.', ref: { kind: 'sense', id: 'revenue' }, actor: `founder:${F}` });
    const bystander = await openUndertaking({ founderId: F, productId: P, kind: 'grow', asked: 'Grow Acme', understoodAs: 'grow Acme', openedBy: `founder:${F}`, from: { kind: 'owner', id: null } });
    const elsewhere = await openUndertaking({ founderId: F, productId: P2, kind: 'understand', asked: 'Understand Other', understoodAs: 'understand Other', openedBy: `founder:${F}`, from: { kind: 'owner', id: null } });
    await stepOn(elsewhere!.id, { kind: 'needs', said: 'I cannot see revenue.', ref: { kind: 'sense', id: 'revenue' }, actor: `founder:${F}` });

    stripe(200, []);
    await readSenses();

    const heard = (await threadOf(waiting!.id)).steps.filter((s) => s.kind === 'found');
    expect(heard.map((s) => s.said).join(' '), 'the thread that named the sense hears it').toMatch(/revenue has reported for the first time/);
    expect((await threadOf(bystander!.id)).steps.filter((s) => s.kind === 'found'),
      'a thread on the same company that never named the sense hears nothing').toHaveLength(0);
    expect((await threadOf(elsewhere!.id)).steps.filter((s) => s.kind === 'found'),
      'another company\'s thread, same sense key, hears nothing').toHaveLength(0);
  });
});

describe('the job', () => {
  it('is registered daily and reads — it is not a Hand', () => {
    const job = JOB_REGISTRY['sense_read_tick'];
    expect(job).toBeTruthy();
    expect(job.schedule).toBe('40 4 * * *');
    expect(job.description).toMatch(/^Read/);
  });
});
