process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '7'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.OPENROUTER_API_KEY = 'test-key';

import { beforeAll, describe, expect, it, vi } from 'vitest';

// =============================================================================
// THE FORGE DELIBERATES INSIDE THE CHARTER.
//
// Five disciplines read the record and each finding is written before the
// design is composed; a separate adversary is given only the draft and told to
// break it; and the rule that seals is neither of them. What is proved here:
// the findings exist before the design, in the record; the composer's design
// is recorded as the forge's; the adversary's accepted attack is an amendment
// in the ledger signed by the adversary; the seal happens only when the design
// says run, the attacker agrees, nothing stands in the way, and the probe is
// inside the charter — and not otherwise, with every reason on the page.
// =============================================================================

type Reply = { content: string; tokensUsed: number; costUsd: number };
const say = (o: unknown): Reply => ({ content: JSON.stringify(o), tokensUsed: 10, costUsd: 0 });

/** What each model call answers, keyed by what the system prompt is for. */
const world = {
  attackerVerdict: 'run' as 'run' | 'kill' | 'defer',
  recommendation: 'run' as 'run' | 'kill',
  lensCalls: 0, composeCalls: 0, attackCalls: 0,
};

vi.mock('../../src/services/ai/client.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  callSonnet: vi.fn(async (system: string) => {
    if (system.startsWith('You shape the offer')) {
      return say({ title: 'Bid roles brief', terms: 'contractor bid tracker', source_types: ['job_posting'], coverage: 'One board on the pull date.',
        price_dollars: 19, price_because: 'a short read', product_name: 'Bid Roles Brief', sells: 'a dated shortlist', claims_made: 'a shortlist, not a listing',
        collects: 'an email for one delivery', delivers_by: 'email on payment', sells_to: 'Small contractors.', charges_how: 'one-time, $19', lighter: 'nothing lighter settles it', offer_subject: 'A short brief' });
    }
    world.lensCalls += 1;
    const lens = /discipline — ([a-z ]+) —/.exec(system)?.[1] ?? 'unknown';
    return say({
      finding: `From ${lens}: the record shows three people writing that they track contractor bids by hand, and one maintained app that does not export.`,
      grounds: ['https://news.ycombinator.com/item?id=h1', 'https://apps.apple.com/us/app/bid-tracker-pro/id111'],
      risk: 'material', recommends: 'run', because: `${lens} sees a small real test worth running.`,
    });
  }),
  callOpus: vi.fn(async (system: string) => {
    if (system.startsWith('You compose the design')) {
      world.composeCalls += 1;
      return say({
        decides: 'Whether a contractor who tracks bids by hand will pay a fixed price for a filtered bid brief.',
        decides_because: 'Every other question in the record is settled by reading; this one only money settles.',
        exchange: 'upfront_price', exchange_because: 'A price paid on a description alone is the only exchange the Workshop can run today.',
        can_prove: 'That at least one stranger pays for a brief sight unseen.', cannot_prove: 'Whether they would pay twice, or what they would pay after seeing it.',
        rather_than_waiting: 'Reading more would not change the next decision.', distribution: 'One message per business, under the sealed contact rules, as the Workshop.',
        if_it_succeeds: 'A second cohort, then a standing brief.', fulfilment_cap: 10,
        recommendation: world.recommendation, recommendation_because: world.recommendation === 'run' ? 'Cheap, bounded, and the only thing left that reading cannot settle.' : 'The record does not support a test yet.',
        interpretations: [
          { observation: 'nobody pays', reading: 'the brief is not worth the price sight unseen', distinguished_by: null },
          { observation: 'nobody pays', reading: 'these businesses do not buy by cold email', distinguished_by: null },
          { observation: 'somebody pays', reading: 'a filtered brief has value to at least one shop', distinguished_by: 'a second purchase' },
        ],
        alternatives: [{ exchange: 'value_first', not_chosen_because: 'not something the Workshop can run today' }],
        costs: [
          { dimension: 'cash', level: 'low', grounds: 'sending and a payment link' },
          { dimension: 'reputation', level: 'material', grounds: 'the Workshop writes to strangers once' },
          { dimension: 'participant_burden', level: 'low', grounds: 'one message each, never twice' },
        ],
        stop_conditions: [
          { kind: 'complaints', threshold: 2, because: 'two complaints from a small cohort is a pattern' },
          { kind: 'opt_outs', threshold: 3, because: 'three people asking not to be written to is enough' },
        ],
      });
    }
    world.attackCalls += 1;
    return say({
      attacks: [
        { claim: 'The distribution sentence promises nothing about follow-ups.', why: 'The contact rules forbid a second message; the design should say so.',
          field: 'distribution', reads_now: 'One message per business and never a second, under the sealed contact rules, as the Workshop.' },
        { claim: 'A null result cannot be told from a wrong population.', why: 'Screening is not in the record.', field: null, reads_now: null },
      ],
      verdict: world.attackerVerdict, because: world.attackerVerdict === 'run' ? 'With the amendment, it can run.' : 'It should not run as drafted.',
    });
  }),
}));

const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');

const OWNER = 'forge_owner';
let mandateId = '';
let n = 0;

async function aTest(costCents: number): Promise<string> {
  n += 1;
  const opp = `forge_opp${String(n)}`; const unk = `forge_unk${String(n)}`; const x = `forge_x${String(n)}`;
  await query(
    `INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
     VALUES (?,?,?,'a filtered bid brief for contractors','small construction contractors','they track bids by hand','three people said so and one app does not export','it is one unusual firm','["https://news.ycombinator.com/item?id=h1"]','real')`,
    [opp, mandateId, OWNER]);
  await query(
    `INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test)
     VALUES (?,?,?,'whether a contractor would pay for a filtered brief',1,'offer one at a fixed price to a few')`, [unk, OWNER, opp]);
  await query(
    `INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode)
     VALUES (?,?,?,?,'offer one at a fixed price to a few','one pays','nobody pays',?,'real')`, [x, OWNER, opp, unk, costCents]);
  return x;
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_forge', 'owner@example.com', 'Owner']);
  await query("INSERT INTO products (id, name, owner_id, status, reality) VALUES ('forge_co','Apex Micro',?,'active','real')", [OWNER]);
  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const m = await openMandate({ founderId: OWNER, statement: 'Small things for trades businesses', shape: null, evidenceMode: 'real' });
  if ('refused' in m) throw new Error(m.refused);
  mandateId = m.id;
});

describe('the forge deliberates', () => {
  it('writes five findings before the design, composes as the forge, is attacked, and seals inside the charter', async () => {
    const { signCharter } = await import('../../src/services/institution/charter.js');
    await signCharter({ founderId: OWNER, monthlyCents: 10_000, probesInFlight: 3, cognitionCentsPerDay: 300, publicVoice: 'Apex Micro', statement: 'A river of nickels.' });
    const x = await aTest(2000);
    const { deliberate, findingsOf, attacksOf } = await import('../../src/services/venture/forge-deliberation.js');
    const d = await deliberate(x);
    expect(d.outcome).toBe('designed');
    expect(world.lensCalls).toBe(5);
    expect(world.composeCalls).toBe(1);
    expect(world.attackCalls).toBe(1);
    // The findings are rows, each on grounds, and every one precedes the design.
    const findings = await findingsOf(x);
    expect(findings.map((f) => f.lens)).toEqual(['market_reality', 'experimental_design', 'commercial_operations', 'risk_ethics_compliance', 'economics_portfolio']);
    expect(findings.every((f) => f.grounds.length >= 1)).toBe(true);
    const designedAt = String((await query('SELECT designed_at FROM probe_designs WHERE experiment_id = ?', [x])).rows[0]!.designed_at);
    expect(findings.every((f) => f.recordedAt <= designedAt)).toBe(true);
    // The design is the forge's, and the adversary's accepted attack is an amendment it signed.
    expect(d.design).toMatchObject({ designedBy: 'forge', recommendation: 'run' });
    expect(d.design!.distribution).toContain('never a second');
    const amendments = (await query('SELECT field, amended_by FROM probe_design_amendments WHERE experiment_id = ?', [x])).rows;
    expect(amendments).toEqual([{ field: 'distribution', amended_by: 'forge:adversary' }]);
    const attacks = await attacksOf(x);
    expect(attacks.map((a) => a.accepted)).toEqual([true, false]);
    expect(attacks[0]!.verdict).toBe('run');
    // Sealed by the rule, inside the charter.
    expect(d.sealed).toBe(true);
    expect(d.unsealedBecause).toEqual([]);
    expect((await query('SELECT sealed_at FROM probe_designs WHERE experiment_id = ?', [x])).rows[0]!.sealed_at).not.toBeNull();
    // Deliberating again composes nothing: the record is the record.
    expect((await deliberate(x)).outcome).toBe('already_designed');
    expect(world.composeCalls).toBe(1);
  });

  it('does not seal when the attacker objects, and says so', async () => {
    world.attackerVerdict = 'defer';
    const x = await aTest(1000);
    const { deliberate } = await import('../../src/services/venture/forge-deliberation.js');
    const d = await deliberate(x);
    expect(d.sealed).toBe(false);
    expect(d.unsealedBecause.join(' ')).toContain('the attacker says defer');
    expect((await query('SELECT sealed_at FROM probe_designs WHERE experiment_id = ?', [x])).rows[0]!.sealed_at).toBeNull();
    world.attackerVerdict = 'run';
  });

  it('does not seal a probe the charter does not cover, and the reason is the charter\'s', async () => {
    const x = await aTest(50_000);
    const { deliberate } = await import('../../src/services/venture/forge-deliberation.js');
    const d = await deliberate(x);
    expect(d.sealed).toBe(false);
    expect(d.unsealedBecause.join(' ')).toMatch(/\$500\.00 and \$\d+\.\d\d is left/);
  });

  it('retires a test both the composer and the adversary recommend against, with both reasons', async () => {
    world.recommendation = 'kill'; world.attackerVerdict = 'kill';
    const x = await aTest(1000);
    const { deliberate } = await import('../../src/services/venture/forge-deliberation.js');
    const d = await deliberate(x);
    expect(d.sealed).toBe(false);
    const row = (await query('SELECT retired_at, retired_because FROM venture_experiments WHERE id = ?', [x])).rows[0]!;
    expect(row.retired_at).not.toBeNull();
    expect(String(row.retired_because)).toContain('both recommend against it');
    world.recommendation = 'run'; world.attackerVerdict = 'run';
  });

  it('the row guards hold the discipline without the code', async () => {
    const x = await aTest(1000);
    // A forge design with fewer than five findings behind it is refused.
    await expect(query(
      `INSERT INTO probe_designs (experiment_id, founder_id, decides, decides_because, exchange, exchange_because, can_prove, cannot_prove,
         rather_than_waiting, distribution, if_it_succeeds, recommendation, recommendation_because, designed_by)
       VALUES (?,?,'d','b','upfront_price','e','c','n','r','x','i','run','w','forge')`, [x, OWNER]))
      .rejects.toThrow(/forge_without_five_findings/);
    // An attack cannot be recorded before a draft exists, nor by the composer.
    await expect(query(
      `INSERT INTO probe_attacks (id, experiment_id, founder_id, claim, why, verdict, because, recorded_by)
       VALUES ('att_early', ?, ?, 'c', 'w', 'run', 'b', 'forge:adversary')`, [x, OWNER])).rejects.toThrow(/no_draft/);
    // Unsealed (the attacker objects), the composer still cannot attack its own draft.
    world.attackerVerdict = 'defer';
    const { deliberate } = await import('../../src/services/venture/forge-deliberation.js');
    expect((await deliberate(x)).sealed).toBe(false);
    world.attackerVerdict = 'run';
    await expect(query(
      `INSERT INTO probe_attacks (id, experiment_id, founder_id, claim, why, verdict, because, recorded_by)
       VALUES ('att_self', ?, ?, 'c', 'w', 'run', 'b', 'forge')`, [x, OWNER])).rejects.toThrow(/attacker_is_the_composer/);
    // Sealed, the record admits no more findings or attacks.
    const { sealDesign } = await import('../../src/services/venture/probe-design.js');
    await sealDesign(x);
    await expect(query(
      `INSERT INTO probe_lens_findings (id, experiment_id, founder_id, lens, finding, grounds_json, risk, recommends, because, recorded_by)
       VALUES ('late', ?, ?, 'market_reality', 'f', '["x"]', 'low', 'run', 'b', 'forge')`, [x, OWNER])).rejects.toThrow(/design_is_sealed/);
  });

  it('the daily pass proposes from candidates, designs at most two, and lets a sealed, ready test in only when it is ready', async () => {
    const { forgePass } = await import('../../src/services/venture/forge-deliberation.js');
    const before = world.composeCalls;
    const pass = await forgePass(OWNER);
    expect(pass.skipped).toBeNull();
    expect(world.composeCalls - before).toBeLessThanOrEqual(2);
    // The sealed tests are not ready — no recipients, no materials — and the pass says so instead of forcing them.
    expect(pass.allowed).toEqual([]);
    expect(pass.notAllowed.length).toBeGreaterThan(0);
    // Here the eyes have retrieved nothing for these words, so the hands
    // refuse to make a brief of nothing, and the pass says exactly that.
    expect(pass.notAllowed[0]!.because).toMatch(/the hands could not make it: (nothing retrieved|there is no Workshop to speak as)/);
    // Nothing was decided behind the owner's back.
    expect(Number((await query("SELECT COUNT(*) AS n FROM venture_experiments WHERE founder_id = ? AND decision IS NOT NULL", [OWNER])).rows[0]!.n)).toBe(0);
  });
});
