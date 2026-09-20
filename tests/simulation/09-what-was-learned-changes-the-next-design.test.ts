// =============================================================================
// WHAT WAS LEARNED CHANGES THE NEXT DESIGN.
//
// Experiment 001 settled, and nothing stood between the forge and asking its
// question again in new words: the proposer refused only a test in flight for
// the same unknown, the deliberation saw the last ten lessons as prose, and
// the sealing rule never looked back. This proves, on the world after that
// settlement, that a settled test changes the next decision APPROPRIATELY:
//
//   (a) the same question by the same mechanism, in new words, is not proposed
//       and does not seal; the precedent is named and the owner sees it;
//   (b) the same question by a different mechanism is deliberated with the
//       precedent in the recorded input, and seals inside the charter;
//   (c) a different candidate is untouched;
//   (d) a re-run on the record is the honest way to ask again.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.NODE_ENV = 'test';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);
process.env.OPENROUTER_API_KEY = 'test-key';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { query } from '../../src/db/client.js';
import { providerStubs } from '../helpers/provider-stubs.js';
import { OWNER, asText, owner, ownerApp, seedProductionShape } from '../helpers/world.js';

const { fetch: fetchStub } = providerStubs();
vi.stubGlobal('fetch', fetchStub);
afterAll(() => { vi.unstubAllGlobals(); });

type Reply = { content: string; tokensUsed: number; costUsd: number };
const say = (o: unknown): Reply => ({ content: JSON.stringify(o), tokensUsed: 10, costUsd: 0 });

/** What the canned forge composes: the same mechanism as Experiment 001 in new words, or a different one. */
const plan = { mechanism: 'same' as 'same' | 'different', composeInputs: [] as string[] };
const SAME = {
  decides: 'Whether a relevant Massachusetts millwork shop, reached cold, will pay $29 up front for a hand-screened brief of open public bid notices, under this identity and channel.',
  distribution: 'Cold outbound to hand-reviewed Massachusetts millwork businesses, once each, from the named operator, landing on the permanent public page.',
};
const DIFFERENT = {
  decides: 'Whether a Massachusetts millwork shop that arrives at the public page by search, with no message sent, will pay $29 for the brief.',
  distribution: 'No outbound at all: the page is published and indexed, and only shops that arrive by search on their own see the offer.',
};

vi.mock('../../src/services/ai/client.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  callSonnet: vi.fn(async (system: string) => {
    const lens = /discipline — ([a-z ]+) —/.exec(system)?.[1] ?? 'unknown';
    return say({ finding: `From ${lens}: the record shows shops tracking bids by hand.`, grounds: ['https://www.commbuys.com/bso/'],
      risk: 'material', recommends: 'run', because: `${lens} sees a small real test worth running.` });
  }),
  callOpus: vi.fn(async (system: string, user: string) => {
    if (system.startsWith('You compose the design')) {
      plan.composeInputs.push(user);
      const m = plan.mechanism === 'same' ? SAME : DIFFERENT;
      return say({
        decides: m.decides, decides_because: 'Only money settles it.',
        exchange: 'upfront_price', exchange_because: 'The only exchange the Workshop can run today.',
        can_prove: 'That one stranger pays.', cannot_prove: 'Whether they would pay twice.',
        rather_than_waiting: 'Reading more would not change the next decision.', distribution: m.distribution,
        if_it_succeeds: 'A second cohort.', fulfilment_cap: 10, recommendation: 'run', recommendation_because: 'Cheap and bounded.',
        interpretations: [
          { observation: 'nobody pays', reading: 'not worth the price sight unseen', distinguished_by: null },
          { observation: 'somebody pays', reading: 'a brief has value to one shop', distinguished_by: 'a second purchase' },
        ],
        alternatives: [{ exchange: 'value_first', not_chosen_because: 'not runnable today' }],
        costs: [
          { dimension: 'cash', level: 'low', grounds: 'a payment link' },
          { dimension: 'reputation', level: 'material', grounds: 'the Workshop speaks' },
          { dimension: 'participant_burden', level: 'low', grounds: 'one message at most' },
        ],
        stop_conditions: [
          { kind: 'complaints', threshold: 2, because: 'two is a pattern' },
          { kind: 'opt_outs', threshold: 3, because: 'three is enough' },
        ],
      });
    }
    return say({ attacks: [], verdict: 'run', because: 'It can run.' });
  }),
}));

let app: Awaited<ReturnType<typeof ownerApp>>;
let me: ReturnType<typeof owner>;
let X = '';
let OPP = '';
const one = async (sql: string, params: unknown[] = []) => (await query(sql, params)).rows[0] as Record<string, unknown>;

beforeAll(async () => {
  ({ experimentId: X } = await seedProductionShape({ charter: true, searching: true }));
  OPP = String((await one('SELECT opportunity_id FROM venture_experiments WHERE id = ?', [X])).opportunity_id);
  app = await ownerApp();
  me = owner(app);
});

describe('the precedent, read from the rows', () => {
  it('Experiment 001 is the settled precedent on its candidate, with the word, what it establishes and what it does not', async () => {
    const { testedBefore } = await import('../../src/services/venture/precedent.js');
    const before = await testedBefore(OWNER, OPP);
    expect(before).toHaveLength(1);
    expect(before[0]!.experimentId).toBe(X);
    expect(before[0]!.outcome.word).toBe('surprised');
    expect(before[0]!.exchange).toBe('upfront_price');
    expect(before[0]!.line).toMatch(/^Tested before: .* settled surprised on \d{4}-\d{2}-\d{2}\. It establishes that this offer/);
    expect(before[0]!.line).toContain('It does not establish that the category is worthless');
  });

  it('the owner sees it on the candidate\'s card on Explore', async () => {
    const t = asText(await me.page('/foundry/experiments/explore'));
    expect(t).toContain('Tested before:');
    expect(t).toContain('settled surprised');
    expect(t).toContain('It does not establish');
  });
});

describe('(a) the same question by the same mechanism, in new words', () => {
  it('is not proposed by the research chain: the precedent is named as the reason', async () => {
    // What reading could still answer on this candidate is answered, so the
    // chain reaches the point where it proposes; then the same question is
    // raised in new words with the same cheapest test.
    await query(`UPDATE market_unknowns SET answered_at = datetime('now'), answer = 'answered by reading, for this proof' WHERE opportunity_id = ? AND answered_at IS NULL`, [OPP]);
    const { raiseUnknown } = await import('../../src/services/venture/market-evidence.js');
    await raiseUnknown({ founderId: OWNER, opportunityId: OPP, blocking: true,
      question: 'Whether a Massachusetts millwork business will pay $29 for filtered public-bid discovery when written to cold',
      cheapestTest: 'write once to each approved Massachusetts millwork business offering a $29 one-time pilot brief of open public bid notices, delivered by email on payment' });
    const { proposeWhatRealityWouldSettle, whereToLookNext } = await import('../../src/services/venture/validation.js');
    expect((await whereToLookNext(OPP)).keepLooking).toBe(false);
    const r = await proposeWhatRealityWouldSettle({ founderId: OWNER, opportunityId: OPP });
    expect(r.proposed).toHaveLength(0);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]!.because).toContain(`this asks the same question ${X} settled`);
    expect(r.skipped[0]!.because).toContain('(surprised) by the same mechanism');
    expect(r.skipped[0]!.because).toContain('propose what it would change, or mark it a re-run');
  });

  it('designed by hand and deliberated, it does not seal; the precedent is in the forge\'s recorded input and in the reason', async () => {
    const unknownId = String((await one(`SELECT id FROM market_unknowns WHERE opportunity_id = ? AND answered_at IS NULL ORDER BY rowid DESC LIMIT 1`, [OPP])).id);
    const { designExperiment } = await import('../../src/services/venture/validation.js');
    const again = await designExperiment({ founderId: OWNER, opportunityId: OPP, unknownId, costCents: 2500, evidenceMode: 'real',
      whatWeDo: 'Send one email to each hand-reviewed Massachusetts millwork business, as the Workshop, offering a $29 pilot brief of open public bid notices for millwork, delivered by email once paid',
      whatWeExpect: 'at least one pays', wouldDisprove: 'nobody pays' });
    plan.mechanism = 'same'; plan.composeInputs = [];
    const { deliberate } = await import('../../src/services/venture/forge-deliberation.js');
    const d = await deliberate(again);
    expect(d.outcome).toBe('designed');
    expect(d.sealed).toBe(false);
    expect(d.unsealedBecause.some((s) => s.includes(`this asks the same question ${X} settled`))).toBe(true);
    // The forge was told, in its input, what is already known and its scope.
    expect(plan.composeInputs).toHaveLength(1);
    expect(plan.composeInputs[0]).toContain('PRECEDENT ON THIS CANDIDATE');
    expect(plan.composeInputs[0]).toContain('"stands": "asked_before"');
    expect(plan.composeInputs[0]).toContain('settled surprised');
    // Nothing sealed; the sealed record of Experiment 001 is untouched.
    expect((await one('SELECT sealed_at FROM probe_designs WHERE experiment_id = ?', [again])).sealed_at).toBeNull();
    const original = await one('SELECT what_we_do, what_we_expect, would_disprove, verdict, what_happened FROM venture_experiments WHERE id = ?', [X]);
    expect(String(original.what_happened)).toContain('nobody bought within the seven days');
    expect(String(original.verdict)).toBe('surprised');
    // And the owner can read why on the test's own page.
    const { designStandsInTheWay } = await import('../../src/services/venture/probe-design.js');
    expect((await designStandsInTheWay(again)).some((s) => s.includes('asks the same question'))).toBe(true);
  });
});

describe('(b) the same question by a different mechanism', () => {
  it('is deliberated with the precedent in its input as "narrowed", and seals inside the charter', async () => {
    const { raiseUnknown } = await import('../../src/services/venture/market-evidence.js');
    const unknownId = await raiseUnknown({ founderId: OWNER, opportunityId: OPP, blocking: true,
      question: 'Will an independent Massachusetts millwork business pay $29 for filtered public-bid discovery if it finds the page itself?',
      cheapestTest: 'publish the page and count shops that arrive by search and pay' });
    const { designExperiment } = await import('../../src/services/venture/validation.js');
    const found = await designExperiment({ founderId: OWNER, opportunityId: OPP, unknownId, costCents: 2500, evidenceMode: 'real',
      whatWeDo: 'Publish the brief\'s page, send nothing, and count the shops that arrive by search and pay',
      whatWeExpect: 'at least one pays', wouldDisprove: 'nobody arrives, or nobody who arrives pays' });
    plan.mechanism = 'different'; plan.composeInputs = [];
    const { deliberate } = await import('../../src/services/venture/forge-deliberation.js');
    const d = await deliberate(found);
    expect(d.outcome).toBe('designed');
    expect(d.unsealedBecause.some((s) => s.includes('asks the same question'))).toBe(false);
    expect(d.sealed).toBe(true);
    expect(plan.composeInputs[0]).toContain('"stands": "narrowed"');
    expect(plan.composeInputs[0]).toContain('It does not establish');
    const { precedentOfExperiment } = await import('../../src/services/venture/precedent.js');
    const p = (await precedentOfExperiment(found))!;
    expect(p.stands).toBe('narrowed');
    expect(p.nearby.map((n) => n.experimentId)).toEqual([X]);
    expect(p.because).toContain('by a different mechanism');
  });
});

describe('(c) a different candidate is untouched', () => {
  it('the same design on another candidate has no precedent, and seals', async () => {
    const { currentMandate } = await import('../../src/services/venture/mandate.js');
    const m = (await currentMandate(OWNER))!;
    await query(
      `INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
       VALUES ('opp_other', ?, ?, 'a permit-deadline brief for Vermont sign makers', 'Vermont sign makers', 'they miss municipal permit windows', 'two said so in public', 'it is one town', '["https://example.com/a"]', 'real')`,
      [m.id, OWNER]);
    const { raiseUnknown } = await import('../../src/services/venture/market-evidence.js');
    const unknownId = await raiseUnknown({ founderId: OWNER, opportunityId: 'opp_other', blocking: true,
      question: 'Will a Vermont sign maker pay $29 for a permit-deadline brief?', cheapestTest: 'offer one cold to a few' });
    const { designExperiment } = await import('../../src/services/venture/validation.js');
    const other = await designExperiment({ founderId: OWNER, opportunityId: 'opp_other', unknownId, costCents: 2500, evidenceMode: 'real',
      whatWeDo: 'Write once to each approved Vermont sign maker offering a $29 one-time permit-deadline brief, delivered by email on payment',
      whatWeExpect: 'one pays', wouldDisprove: 'nobody pays' });
    plan.mechanism = 'same'; plan.composeInputs = [];
    const { deliberate } = await import('../../src/services/venture/forge-deliberation.js');
    const d = await deliberate(other);
    expect(d.outcome).toBe('designed');
    expect(d.unsealedBecause.some((s) => s.includes('asks the same question'))).toBe(false);
    expect(plan.composeInputs[0]).toContain('"stands": "clear"');
    const { precedentOfExperiment } = await import('../../src/services/venture/precedent.js');
    expect((await precedentOfExperiment(other))!.stands).toBe('clear');
  });
});

describe('(d) a re-run on the record', () => {
  it('the same question by the same mechanism, marked rerun_of, is not refused as asked before', async () => {
    const { raiseUnknown } = await import('../../src/services/venture/market-evidence.js');
    const unknownId = await raiseUnknown({ founderId: OWNER, opportunityId: OPP, blocking: true,
      question: 'Will an independent Massachusetts millwork business pay $29 for filtered public-bid discovery at all? (re-run)',
      cheapestTest: 'the same offer to the same population, again' });
    const { designExperiment } = await import('../../src/services/venture/validation.js');
    const same = {
      founderId: OWNER, opportunityId: OPP, unknownId, costCents: 2500, evidenceMode: 'real' as const,
      whatWeDo: 'Write once to each approved Massachusetts millwork business, in the owner\'s name, offering a $29 one-time pilot brief of open public bid notices relevant to millwork, and deliver it by email on payment',
      whatWeExpect: 'at least one pays', wouldDisprove: 'nobody pays',
    };
    const asked = await designExperiment(same);
    const { precedentOfExperiment } = await import('../../src/services/venture/precedent.js');
    expect((await precedentOfExperiment(asked))!.stands).toBe('asked_before');
    // The schema's own door: a re-run of a test that settled surprised needs
    // the claim revised after the result, or it is the same claim tested twice.
    const x = await one('SELECT claim_id FROM venture_experiments WHERE id = ?', [X]);
    await expect(designExperiment({ ...same, rerunOf: X })).rejects.toThrow(/rerun_needs_a_revised_claim/);
    const { reviseClaim } = await import('../../src/services/venture/market-evidence.js');
    await reviseClaim({ founderId: OWNER, claimId: String(x.claim_id), opportunityId: OPP,
      into: 'A Massachusetts millwork shop that already sells to the public sector will pay $29 for a screened brief', because: 'the first test reached shops with no public-sector work' });
    const rerun = await designExperiment({ ...same, rerunOf: X });
    const p = (await precedentOfExperiment(rerun))!;
    expect(p.stands).not.toBe('asked_before');
    expect(p.because).toContain(`a re-run of ${X}, on the record`);
    const { designStandsInTheWay } = await import('../../src/services/venture/probe-design.js');
    expect((await designStandsInTheWay(rerun)).some((s) => s.includes('asks the same question'))).toBe(false);
  });
});
