process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '5'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.OPENROUTER_API_KEY = 'test-key';

import { beforeAll, describe, expect, it, vi } from 'vitest';

// =============================================================================
// A DESIGN THE FORGE COULD NOT SEAL IS NOT STRANDED (Stage 1, F1.5).
//
// A design was sealed or not once, inside the deliberation, and the daily pass
// took up only tests with no design or a sealed one. So a design refused
// because no charter stood, or because the attacker said defer, waited for
// ever: never judged again when the charter was signed, never a refusal the
// give-up rule could count, and nowhere the owner would see it.
//
// What is proved here, through the real forge pass with the model stubbed:
// an unsealed design is a refusal with its reasons; signing the charter takes
// it up again exactly once and seals it; a defer verdict is a refusal and the
// owner sees every waiting design as ONE needs-you item; unchanged facts ask
// nothing again however many passes run; changing facts are bounded by the
// give-up rule; and his "take them up again" and "retire them" both work.
// =============================================================================

type Reply = { content: string; tokensUsed: number; costUsd: number };
const say = (o: unknown): Reply => ({ content: JSON.stringify(o), tokensUsed: 10, costUsd: 0 });
const world = { attackerVerdict: 'run' as 'run' | 'defer', lensCalls: 0, composeCalls: 0, attackCalls: 0 };

vi.mock('../../src/services/ai/client.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  callSonnet: vi.fn(async (system: string) => {
    if (!system.includes('discipline —')) throw new Error('not a lens: this test does not make offers');
    world.lensCalls += 1;
    return say({ finding: 'The record shows three people tracking contractor bids by hand.', grounds: ['https://news.ycombinator.com/item?id=h1'],
      risk: 'material', recommends: 'run', because: 'A small real test is worth running.' });
  }),
  callOpus: vi.fn(async (system: string) => {
    if (system.startsWith('You compose the design')) {
      world.composeCalls += 1;
      return say({
        decides: 'Whether a contractor who tracks bids by hand will pay a fixed price for a filtered bid brief.',
        decides_because: 'Only money settles it.', exchange: 'upfront_price', exchange_because: 'The one exchange the Workshop can run today.',
        can_prove: 'That one stranger pays sight unseen.', cannot_prove: 'Whether they would pay twice.',
        rather_than_waiting: 'Reading more would not change the decision.', distribution: 'One message per business, as the Workshop.',
        if_it_succeeds: 'A second cohort.', fulfilment_cap: 10, recommendation: 'run', recommendation_because: 'Cheap and bounded.',
        interpretations: [
          { observation: 'nobody pays', reading: 'not worth the price', distinguished_by: null },
          { observation: 'nobody pays', reading: 'they do not buy by email', distinguished_by: null },
        ],
        alternatives: [],
        costs: [
          { dimension: 'cash', level: 'low', grounds: 'sending' },
          { dimension: 'reputation', level: 'material', grounds: 'writing to strangers' },
          { dimension: 'participant_burden', level: 'low', grounds: 'one message each' },
        ],
        stop_conditions: [
          { kind: 'complaints', threshold: 2, because: 'a pattern' },
          { kind: 'opt_outs', threshold: 3, because: 'enough' },
        ],
      });
    }
    world.attackCalls += 1;
    return say({ attacks: [{ claim: 'A null result cannot be told from a wrong population.', why: 'Screening is not in the record.', field: null, reads_now: null }],
      verdict: world.attackerVerdict, because: world.attackerVerdict === 'run' ? 'It can run.' : 'Wait for more evidence.' });
  }),
}));

// The candidate proposes nothing new, so the pass reads only the tests placed here.
vi.mock('../../src/services/venture/validation.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  proposeWhatRealityWouldSettle: vi.fn(async () => ({ proposed: [] })),
}));

const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');

const OWNER = 'forge_owner';
const DAY = 86_400_000;
const T0 = new Date('2026-10-06T06:00:00Z');
const at = (days: number) => new Date(T0.getTime() + days * DAY);
let mandateId = '';
let n = 0;

async function aTest(costCents: number): Promise<string> {
  n += 1;
  const opp = `opp${String(n)}`; const unk = `unk${String(n)}`; const x = `x${String(n)}`;
  await query(
    `INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
     VALUES (?,?,?,'a filtered bid brief for contractors','small construction contractors','they track bids by hand','three people said so','one firm','[]','real')`,
    [opp, mandateId, OWNER]);
  await query(`INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test)
     VALUES (?,?,?,'whether a contractor would pay for a filtered brief',1,'offer one')`, [unk, OWNER, opp]);
  await query(
    `INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode)
     VALUES (?,?,?,?,?,'one pays','nobody pays',?,'real')`, [x, OWNER, opp, unk, `offer brief ${String(n)} at a fixed price`, costCents]);
  return x;
}
const one = async (sql: string, p: unknown[]) => (await query(sql, p)).rows[0] as Record<string, unknown>;
const refusals = async (id: string) => Number((await one(`SELECT COUNT(*) AS n FROM forge_refusals WHERE experiment_id = ? AND stage = 'deliberate'`, [id])).n);
const sealedAt = async (id: string) => (await one('SELECT sealed_at FROM probe_designs WHERE experiment_id = ?', [id])).sealed_at;
const waitingItems = async () => {
  const { waitingOn } = await import('../../src/services/founder/attention.js');
  return (await waitingOn(OWNER)).filter((i) => i.id === 'forge-designs-waiting');
};
const sign = async () => {
  const { signCharter } = await import('../../src/services/institution/charter.js');
  await signCharter({ founderId: OWNER, testsTotalCents: 10_000, probesInFlight: 3, cognitionCentsPerDay: 300, days: 30, publicVoice: 'Apex Micro', statement: 'A river of nickels.' });
};
const withdraw = async () => {
  const { withdrawCharter } = await import('../../src/services/institution/charter.js');
  await withdrawCharter({ founderId: OWNER, reason: 'a rehearsal of the facts changing' });
};

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_forge', 'owner@example.com', 'Owner']);
  await query("INSERT INTO products (id, name, owner_id, status, reality) VALUES ('forge_co','Apex Micro',?,'active','real')", [OWNER]);
  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const m = await openMandate({ founderId: OWNER, statement: 'Small things for trades businesses', shape: null, evidenceMode: 'real' });
  if ('refused' in m) throw new Error(m.refused);
  mandateId = m.id;
});

describe('designed before the charter, then the charter is signed', () => {
  let x = '';
  it('with no charter standing, the design is not sealed, and that is a refusal with its reasons', async () => {
    x = await aTest(1000);
    const { forgePass } = await import('../../src/services/venture/forge-deliberation.js');
    const p = await forgePass(OWNER, at(0));
    expect(p.deliberated.map((d) => [d.outcome, d.sealed])).toEqual([['designed', false]]);
    expect(p.deliberated[0]!.unsealedBecause.join(' ')).toContain('no charter is standing');
    expect(await refusals(x)).toBe(1);
    const r = await one(`SELECT because, facts FROM forge_refusals WHERE experiment_id = ?`, [x]);
    expect(String(r.because)).toMatch(/^designed but not sealed: .*no charter is standing/);
    expect(r.facts).not.toBeNull();
    expect(await sealedAt(x)).toBeNull();
  });

  it('another pass with nothing changed asks nothing and writes nothing', async () => {
    const { forgePass } = await import('../../src/services/venture/forge-deliberation.js');
    const before = { ...world };
    for (const d of [0.2, 1, 2, 5]) expect((await forgePass(OWNER, at(d))).deliberated).toEqual([]);
    expect(world).toEqual(before);
    expect(await refusals(x)).toBe(1);
  });

  it('the charter is signed: the next pass takes it up again once, and seals it, without asking the model again', async () => {
    await sign();
    const { forgePass } = await import('../../src/services/venture/forge-deliberation.js');
    const before = { ...world };
    const p = await forgePass(OWNER, at(5.1));
    const mine = p.deliberated.filter((d) => d.experimentId === x);
    expect(mine.map((d) => [d.outcome, d.sealed])).toEqual([['reconsidered', true]]);
    expect(mine[0]!.because).toBe('what it was refused on has changed');
    expect(await sealedAt(x)).not.toBeNull();
    expect(world).toEqual(before);
    // Once: sealed now, it is never taken up as a waiting design again.
    expect((await forgePass(OWNER, at(5.2))).deliberated.filter((d) => d.experimentId === x)).toEqual([]);
    expect(await waitingItems()).toEqual([]);
  });
});

describe('a defer verdict', () => {
  const ids: string[] = [];
  it('is a refusal row, and every waiting design reaches the owner as one needs-you item', async () => {
    world.attackerVerdict = 'defer';
    ids.push(await aTest(1000), await aTest(1000));
    const { forgePass } = await import('../../src/services/venture/forge-deliberation.js');
    const p = await forgePass(OWNER, at(6));
    expect(p.deliberated.filter((d) => ids.includes(d.experimentId)).map((d) => d.sealed)).toEqual([false, false]);
    for (const id of ids) {
      expect(await refusals(id)).toBe(1);
      expect(String((await one('SELECT because FROM forge_refusals WHERE experiment_id = ?', [id])).because)).toContain('the attacker says defer');
    }
    const items = await waitingItems();
    expect(items).toHaveLength(1);
    expect(items[0]!.summary).toBe('2 designs are waiting and cannot be let in');
    expect(items[0]!.detail).toContain('2: the attacker says defer');
    expect(items[0]!.points).toHaveLength(2);
    expect(items[0]!.yes.action).toBe('/foundry/forge/designs-waiting/reconsider');
    expect(items[0]!.no.action).toBe('/foundry/forge/designs-waiting/retire');
    const { needsYou } = await import('../../src/services/needs-you/queue.js');
    const ny = (await needsYou(OWNER)).items.filter((i) => i.key === 'experiment:forge-designs-waiting');
    expect(ny).toHaveLength(1);
    expect(ny[0]!.answers.ifYes).toContain('next forge pass');
  });

  it('when he asks, each is taken up again once on the next pass — the attacker asked again — and then not again', async () => {
    const { askToReconsiderDesigns, forgePass } = await import('../../src/services/venture/forge-deliberation.js');
    expect(await askToReconsiderDesigns(OWNER, at(6.1))).toBe(2);
    expect((await waitingItems())[0]!.detail).toContain('You asked for them to be taken up again');
    const attacks = world.attackCalls;
    const p = await forgePass(OWNER, at(6.2));
    expect(p.deliberated.filter((d) => ids.includes(d.experimentId)).map((d) => d.because)).toEqual([
      'the owner asked for it to be taken up again', 'the owner asked for it to be taken up again']);
    expect(world.attackCalls).toBe(attacks + 2);
    for (const id of ids) expect(await refusals(id)).toBe(2);
    expect((await forgePass(OWNER, at(6.3))).deliberated).toEqual([]);
    expect(world.attackCalls).toBe(attacks + 2);
  });

  it('no infinite loop: facts that keep changing are bounded by the give-up rule, and then nothing is asked', async () => {
    const { forgePass } = await import('../../src/services/venture/forge-deliberation.js');
    // The charter withdrawn, signed, withdrawn: what the seal is refused on
    // changes every pass. Each change is one more refusal, and the fourth retires.
    for (const [i, flip] of [withdraw, sign, withdraw, sign, withdraw].entries()) {
      await flip();
      await forgePass(OWNER, at(7 + i));
    }
    for (const id of ids) {
      expect(await refusals(id)).toBe(4);
      const e = await one('SELECT retired_at, retired_because FROM venture_experiments WHERE id = ?', [id]);
      expect(e.retired_at).not.toBeNull();
      expect(String(e.retired_because)).toMatch(/the forge was refused 4 times .* designing it; the last: designed but not sealed/);
    }
    const attacks = world.attackCalls;
    await sign();
    for (let d = 20; d < 30; d++) await forgePass(OWNER, at(d));
    expect(world.attackCalls).toBe(attacks);
    expect(await waitingItems()).toEqual([]);
  });
});

describe('he retires them', () => {
  it('every waiting design is retired with its own reason, and the item is gone', async () => {
    world.attackerVerdict = 'defer';
    const y = await aTest(1000);
    const { forgePass, retireWaitingDesigns } = await import('../../src/services/venture/forge-deliberation.js');
    await forgePass(OWNER, at(40));
    expect(await waitingItems()).toHaveLength(1);
    expect(await retireWaitingDesigns(OWNER)).toBe(1);
    const e = await one('SELECT retired_at, retired_because FROM venture_experiments WHERE id = ?', [y]);
    expect(e.retired_at).not.toBeNull();
    expect(String(e.retired_because)).toMatch(/^retired by the owner while its design waited unsealed: the attacker says defer/);
    expect(await waitingItems()).toEqual([]);
  });
});
