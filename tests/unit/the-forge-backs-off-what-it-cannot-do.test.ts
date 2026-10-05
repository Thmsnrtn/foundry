// =============================================================================
// LAW (Roadmap 2027 R27): THE FORGE SURVIVES A FAILED CALL, AND BACKS OFF WHAT
// IT KEEPS BEING REFUSED.
//
// A test the forge could not design left no design behind, so the next daily
// pass deliberated it again: five disciplines and a composition, every day,
// for ever, on a question that had already come back unusable. A sealed test
// the hands could not make was composed again every day the same way. And one
// test whose deliberation threw stopped the pass for every test after it.
//
// Now each refusal is recorded; the same stage of the same test waits a day,
// then two, then four before it is tried again; after the fourth refusal the
// test is retired with the reasons, so the frontier does not carry it. A test
// that throws is reported and the pass goes on to the next; a pass in which
// every attempt threw still fails, loudly, and the model door failing stops it
// at once (R33). A failure is not a refusal and earns no back-off.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '6'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'forge@example.com';
process.env.OPENROUTER_API_KEY = 'test-key';

import { beforeAll, describe, expect, it, vi } from 'vitest';

let mode: 'unusable' | 'throws' | 'door' = 'unusable';
let lensCalls = 0;
vi.mock('../../src/services/ai/client.js', async (orig) => {
  const real = await orig<Record<string, unknown> & { ModelDoorError: new (m: string, s: number | null) => Error }>();
  const answer = (user?: unknown) => {
    lensCalls += 1;
    if (String(user ?? '').includes('THROWS_FOR_THIS_TEST')) throw new Error('a row this test could not read');
    if (mode === 'throws') throw new Error('a row this test could not read');
    if (mode === 'door') throw new real.ModelDoorError('OpenRouter API error 402: insufficient credits', 402);
    return { content: 'not a finding at all', tokensUsed: 10, costUsd: 0 };
  };
  return { ...real, callHaiku: vi.fn(async (_s: unknown, u: unknown) => answer(u)), callSonnet: vi.fn(async (_s: unknown, u: unknown) => answer(u)), callOpus: vi.fn(async (_s: unknown, u: unknown) => answer(u)) };
});

// The candidate proposes nothing new, so the pass reads only the tests placed here.
vi.mock('../../src/services/venture/validation.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  proposeWhatRealityWouldSettle: vi.fn(async () => ({ proposed: [] })),
}));

const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');

const OWNER = 'forge_owner';
const DAY = 86_400_000;
const T0 = new Date('2026-10-05T06:00:00Z');
const at = (days: number) => new Date(T0.getTime() + days * DAY);

async function anUndesignedTest(id: string, whatWeDo = 'offer one at a fixed price'): Promise<void> {
  await query(
    `INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode)
     VALUES (?,?,'forge_opp','forge_unk',?,'one pays','nobody pays',1000,'real')`, [id, OWNER, whatWeDo]);
}
const refusals = async (id: string) => Number(((await query('SELECT COUNT(*) AS n FROM forge_refusals WHERE experiment_id = ?', [id])).rows[0] as Record<string, unknown>).n);

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_forge', 'forge@example.com', 'Owner']);
  await query("INSERT INTO products (id, name, owner_id, status, reality) VALUES ('forge_co','Apex Micro',?,'active','real')", [OWNER]);
  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const m = await openMandate({ founderId: OWNER, statement: 'Small things for trades businesses', shape: null, evidenceMode: 'real' });
  if ('refused' in m) throw new Error(m.refused);
  await query(
    `INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
     VALUES ('forge_opp',?,?,'a filtered bid brief','small contractors','they track bids by hand','people said so','one firm','[]','real')`, [m.id, OWNER]);
  await query(`INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test)
     VALUES ('forge_unk',?,'forge_opp','whether a contractor would pay',1,'offer one')`, [OWNER]);
  await anUndesignedTest('forge_x1');
});

describe('a refusal is recorded and backed off', () => {
  it('the first pass deliberates and is refused; the refusal is recorded', async () => {
    const { forgePass } = await import('../../src/services/venture/forge-deliberation.js');
    const p = await forgePass(OWNER, at(0));
    expect(p.deliberated.map((d) => d.outcome)).toEqual(['refused']);
    expect(await refusals('forge_x1')).toBe(1);
  });

  it('the next pass the same day does not deliberate it again, and says why', async () => {
    const { forgePass } = await import('../../src/services/venture/forge-deliberation.js');
    lensCalls = 0;
    const p = await forgePass(OWNER, at(0.5));
    expect(p.deliberated).toEqual([]);
    expect(lensCalls).toBe(0);
    expect(p.waiting.join(' ')).toMatch(/forge_x1: refused once; tried again from 2026-10-06/);
  });

  it('a day later it is tried again; then it waits two days, then four', async () => {
    const { forgePass } = await import('../../src/services/venture/forge-deliberation.js');
    expect((await forgePass(OWNER, at(1))).deliberated).toHaveLength(1);
    expect(await refusals('forge_x1')).toBe(2);
    expect((await forgePass(OWNER, at(2))).deliberated).toHaveLength(0);
    expect((await forgePass(OWNER, at(3))).deliberated).toHaveLength(1);
    expect(await refusals('forge_x1')).toBe(3);
    expect((await forgePass(OWNER, at(6))).deliberated).toHaveLength(0);
    expect((await forgePass(OWNER, at(7))).deliberated).toHaveLength(1);
  });

  it('after the fourth refusal the test is retired, with the reasons, and the frontier no longer carries it', async () => {
    expect(await refusals('forge_x1')).toBe(4);
    const e = (await query('SELECT retired_at, retired_because, decision FROM venture_experiments WHERE id = ?', ['forge_x1'])).rows[0] as Record<string, unknown>;
    expect(e.retired_at).not.toBeNull();
    expect(e.decision).toBeNull();
    expect(String(e.retired_because)).toMatch(/the forge was refused 4 times over 7 days designing it; the last: .*disciplines returned nothing usable/);
    const { forgePass } = await import('../../src/services/venture/forge-deliberation.js');
    lensCalls = 0;
    expect((await forgePass(OWNER, at(30))).deliberated).toHaveLength(0);
    expect(lensCalls).toBe(0);
  });
});

describe('a failed call is not a refusal, and one test does not stop the others', () => {
  it('a test that throws is reported and the pass goes on; no back-off is earned', async () => {
    await anUndesignedTest('forge_x2', 'THROWS_FOR_THIS_TEST');
    await anUndesignedTest('forge_x3');
    const { forgePass } = await import('../../src/services/venture/forge-deliberation.js');
    const p = await forgePass(OWNER, at(31));
    expect(p.failed.map((f) => f.experimentId)).toEqual(['forge_x2']);
    expect(p.deliberated.map((d) => d.experimentId)).toEqual(['forge_x3']);
    expect(await refusals('forge_x2')).toBe(0);
  });

  it('a pass in which every attempt threw fails, so the routine is recorded failing', async () => {
    mode = 'throws';
    await query(`DELETE FROM forge_refusals WHERE experiment_id = 'forge_x3'`, []);
    const { forgePass } = await import('../../src/services/venture/forge-deliberation.js');
    await expect(forgePass(OWNER, at(40))).rejects.toThrow(/the forge could not deliberate any test this pass/);
  });

  it('the model door failing stops the pass at once', async () => {
    mode = 'door';
    const { forgePass } = await import('../../src/services/venture/forge-deliberation.js');
    const { ModelDoorError } = await import('../../src/services/ai/client.js');
    await expect(forgePass(OWNER, at(41))).rejects.toBeInstanceOf(ModelDoorError);
  });
});
