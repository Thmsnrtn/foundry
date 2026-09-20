process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '6'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.APP_URL = 'http://localhost:8080';

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { seedProof1 } from '../../src/services/venture/proof-1.js';
import { recordMaterial } from '../../src/services/venture/hand.js';
import { decideExperiment, designExperiment, recordResult, retireExperiment } from '../../src/services/venture/validation.js';
import { experimentLedger, getExperimentView, listExperiments } from '../../src/services/founder/experiment-view.js';
import { waitingOn } from '../../src/services/founder/attention.js';

// =============================================================================
// HISTORY IS NOT THE ACTIVE LIST.
//
// The Experiments page listed every real test that ever had materials, and
// the state derivation never read `retired_at` or `superseded_by` — so a
// design the forge and its adversary had killed came back as "Needs you", and
// every concluded test stayed in the working set forever. History is
// evidence, kept whole on its own page; the working set is what can still
// produce evidence. This holds both, and that a retired test never asks.
// =============================================================================

const OWNER = 'hist_owner'; const FOUNDRY = 'hist_foundry';
let app: Hono;
let X = ''; let A = ''; let B = ''; let C = '';
let emptyIndex = ''; let emptyHistory = '';
const page = async (path: string) => { const r = await app.request(path); return { status: r.status, text: await r.text() }; };
const nowSection = (t: string) => t.slice(t.indexOf('<h1>'), t.indexOf('id="recent"') > 0 ? t.indexOf('id="recent"') : t.indexOf('History ('));

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)`, [OWNER, 'hist_clk', 'owner@example.com', 'Owner']);
  await query(`INSERT INTO products (id,name,owner_id,status,operating_budget_monthly_usd) VALUES (?,'Foundry',?,'active',50)`, [FOUNDRY, OWNER]);
  await query(`INSERT INTO system_identities (identity_key,product_id,established_reason) VALUES ('foundry',?,'test')`, [FOUNDRY]);
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'owner@example.com', preferences: {} } as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', letterRoutes);
  // The empty states, read before anything exists.
  emptyIndex = (await page('/foundry/experiments')).text;
  emptyHistory = (await page('/foundry/experiments/history')).text;
  X = (await seedProof1(OWNER)).experimentId;
  const base = (await query('SELECT opportunity_id, unknown_id FROM venture_experiments WHERE id = ?', [X])).rows[0] as Record<string, unknown>;
  const another = async (word: string): Promise<string> => {
    const id = await designExperiment({
      founderId: OWNER, opportunityId: String(base.opportunity_id), unknownId: String(base.unknown_id),
      whatWeDo: `offering the ${word} brief to the same businesses`, whatWeExpect: 'at least one pays', wouldDisprove: 'nobody pays',
      costCents: 0, evidenceMode: 'real' });
    await recordMaterial({ founderId: OWNER, experimentId: id, kind: 'deliverable', title: `The ${word} brief`, body: `# The ${word} brief\n\nA row.`, by: 'test' });
    return id;
  };
  A = await another('duplicate');
  B = await another('killed');
  C = await another('finished');
  // A: retired by the owner as a duplicate of X, lineage kept.
  expect((await retireExperiment({ experimentId: A, by: `founder:${OWNER}`, because: 'the same test as its survivor', supersededBy: X })).retired).toBe(true);
  // B: killed by the forge and its adversary a month ago (the forge's own UPDATE).
  await query(`UPDATE venture_experiments SET retired_at = datetime('now','-30 days'), retired_because = 'the forge and its adversary both said kill' WHERE id = ?`, [B]);
  // C: approved and settled by the world, just now.
  const d = await decideExperiment({ experimentId: C, decision: 'approved', by: `founder:${OWNER}`, via: 'its own authorisation' });
  expect(d.refused).toBeUndefined();
  // A resolution comes after its prediction, and the rows hold that to the second.
  await new Promise((r) => { setTimeout(r, 1100); });
  await recordResult({ experimentId: C, whatHappened: 'one business paid', asPredicted: true });
});

describe('the derivation reads how a test ended', () => {
  it('a retired test is retired, not "Needs you"; a superseded one names its successor; neither can be allowed', async () => {
    const a = (await getExperimentView(OWNER, A))!;
    expect(a.state).toBe('superseded');
    expect(a.supersededBy).toBe(X);
    expect(a.concluded).toBe(true);
    expect(a.allow.possible).toBe(false);
    const b = (await getExperimentView(OWNER, B))!;
    expect(b.state).toBe('retired');
    expect(b.stateDetail).toContain('both said kill');
    expect(b.concludedAt).not.toBeNull();
    const c = (await getExperimentView(OWNER, C))!;
    expect(c.state).toBe('completed');
    expect(c.concluded).toBe(true);
    const x = (await getExperimentView(OWNER, X))!;
    expect(x.state).toBe('needs_you');
    expect(x.concluded).toBe(false);
  });

  it('the scopes partition the record, and the ledger counts without hydrating', async () => {
    expect((await listExperiments(OWNER, new Date(), 'now')).map((v) => v.id)).toEqual([X]);
    const history = await listExperiments(OWNER, new Date(), 'history');
    expect(history.map((v) => v.id).sort()).toEqual([A, B, C].sort());
    // Most recently concluded first: A and C now, B a month ago.
    expect(history[history.length - 1]!.id).toBe(B);
    const ledger = await experimentLedger(OWNER);
    expect(ledger.filter((l) => l.settled).map((l) => l.id).sort()).toEqual([A, B, C].sort());
    expect(ledger.find((l) => l.id === X)).toMatchObject({ settled: false, settledAt: null });
  });

  it('a retired test never waits on him', async () => {
    const queue = await waitingOn(OWNER);
    const tests = queue.filter((q) => q.kind === 'experiment').map((q) => q.id);
    expect(tests).toContain(X);
    expect(tests).not.toContain(A);
    expect(tests).not.toContain(B);
  });
});

describe('the pages: a working set, a strip of what finished lately, and the record', () => {
  it('Experiments shows the live test, only the recently finished, and a counted door to History', async () => {
    const t = (await page('/foundry/experiments')).text;
    const now = nowSection(t);
    expect(now).toContain('Needs you');
    expect(now).toContain(`/foundry/experiments/${X}`);
    for (const gone of [A, B, C]) expect(now).not.toContain(`/foundry/experiments/${gone}"`);
    expect(now).toContain('1 live test');
    const recent = t.slice(t.indexOf('id="recent"'), t.indexOf('History ('));
    expect(recent).toContain(`/foundry/experiments/${A}`);
    expect(recent).toContain(`/foundry/experiments/${C}`);
    expect(recent).not.toContain(`/foundry/experiments/${B}`);
    expect(recent).toContain('Superseded');
    expect(recent).toContain('As predicted');
    expect(t).toContain('href="/foundry/experiments/history">History (3)</a>');
    expect(t).not.toContain('Other tests');
  });

  it('History lists every concluded test, most recent first, filtered by how it ended, with the successor linked', async () => {
    const all = (await page('/foundry/experiments/history')).text;
    expect(all).toContain('3 concluded tests');
    for (const id of [A, B, C]) expect(all).toContain(`exp-row done" href="/foundry/experiments/${id}"`);
    // The live test is not a row here; it appears only as the successor of A.
    expect(all).not.toContain(`exp-row done" href="/foundry/experiments/${X}"`);
    expect(all.indexOf(`/foundry/experiments/${C}"`)).toBeLessThan(all.indexOf(`/foundry/experiments/${B}"`));
    expect(all).toContain(`Succeeded by <a href="/foundry/experiments/${X}">`);
    expect(all).toContain('Retired <b>1</b>');
    const retired = (await page('/foundry/experiments/history?state=retired')).text;
    expect(retired).toContain(`/foundry/experiments/${B}"`);
    expect(retired).not.toContain(`/foundry/experiments/${A}"`);
    expect(retired).not.toContain(`/foundry/experiments/${C}"`);
    expect(retired).toContain('href="/foundry/experiments/history?state=retired" class="on" aria-current="page"');
    expect((await page('/foundry/experiments/history?state=nonsense')).text).toContain('3 concluded tests');
  });

  it('before anything exists, both pages are finished empty states, not dead cards', () => {
    expect(emptyIndex).toContain('No real test is set up yet');
    expect(emptyIndex).toContain('History (0)');
    expect(emptyHistory).toContain('Nothing has finished yet.');
    expect(emptyHistory).not.toContain('class="filters"');
  });
});
