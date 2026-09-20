// =============================================================================
// PRECEDENT IS SCOPED.
//
// The reader that lets a settled test change the next design must bind only
// what it should: the same candidate, a valid settlement, the same question by
// the same mechanism. Normal, failing and adversarial shapes: no settlement;
// a design that omits its fields; a test its search closed (never ran); an
// invalid test; two settled tests that disagree; and the thresholds themselves.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '7'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { overlap, precedentFor, words } from '../../src/services/venture/precedent.js';

const OWNER = 'prec_owner';
let n = 0;
const experiment = async (input: { opp: string; whatWeDo: string; question: string; settled?: 'as_predicted' | 'surprised' | null; validity?: 'valid' | 'invalid'; retired?: string | null; design?: { decides: string; exchange: string; distribution: string } | null }): Promise<string> => {
  n += 1;
  const unk = `prec_unk${String(n)}`; const x = `prec_x${String(n)}`;
  await query(`INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test) VALUES (?,?,?,?,1,?)`, [unk, OWNER, input.opp, input.question, input.whatWeDo]);
  await query(`INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode)
               VALUES (?,?,?,?,?,'one pays','nobody pays',100,'real')`, [x, OWNER, input.opp, unk, input.whatWeDo]);
  if (input.design) {
    const { recordDesign } = await import('../../src/services/venture/probe-design.js');
    await recordDesign({ founderId: OWNER, experimentId: x, decides: input.design.decides, decidesBecause: 'b', exchange: input.design.exchange as 'upfront_price', exchangeBecause: 'b',
      canProve: 'c', cannotProve: 'that it sells twice', ratherThanWaiting: 'r', distribution: input.design.distribution, ifItSucceeds: 's', fulfilmentCap: null,
      recommendation: 'run', recommendationBecause: 'r', designedBy: 'institution:probe_designer', interpretations: [], alternatives: [], costs: [], stopConditions: [] });
  }
  if (input.settled) {
    const { decideExperiment, recordResult } = await import('../../src/services/venture/validation.js');
    await decideExperiment({ experimentId: x, decision: 'approved', by: `founder:${OWNER}`, via: 'its own authorisation' });
    await new Promise((r) => { setTimeout(r, 1100); }); // a resolution is after its prediction, by the clock
    await recordResult({ experimentId: x, asPredicted: input.settled === 'as_predicted', whatHappened: 'what the world did' });
  }
  if (input.retired) await query(`UPDATE venture_experiments SET retired_at = datetime('now'), retired_because = ? WHERE id = ?`, [input.retired, x]);
  return x;
};

const Q = 'Will a Massachusetts millwork business pay $29 for a filtered brief of open public bids?';
const DO = 'Write once to each approved Massachusetts millwork business offering a $29 pilot brief of open public bid notices, delivered by email on payment';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_prec', 'owner@example.com', 'Owner']);
  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const m = await openMandate({ founderId: OWNER, statement: 'Small things for trades businesses', shape: null, evidenceMode: 'real' });
  if ('refused' in m) throw new Error(m.refused);
  for (const opp of ['prec_oppA', 'prec_oppB']) {
    await query(`INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
                 VALUES (?,?,?,'a brief','shops','bids by hand','three said so','one firm','["https://example.com"]','real')`, [opp, m.id, OWNER]);
  }
});

describe('the words and the overlap', () => {
  it('carry the sentence and ignore its scaffolding; identical sentences overlap fully, unrelated ones not at all', () => {
    expect(words('Will a shop pay $29 for the brief?')).toEqual(new Set(['shop', 'pay', '$29', 'brief']));
    expect(overlap(DO, DO)).toBe(1);
    expect(overlap(DO, 'Publish the page and count who arrives')).toBe(0);
    expect(overlap('', DO)).toBe(0);
    expect(overlap(null, undefined)).toBe(0);
  });
});

describe('what binds and what does not', () => {
  it('nothing settled on the candidate: clear', async () => {
    const p = await precedentFor({ founderId: OWNER, opportunityId: 'prec_oppA', design: { whatWeDo: DO, question: Q } });
    expect(p.stands).toBe('clear');
    expect(p.because).toBe('no test on this candidate has settled');
  });

  it('a test its search closed (never ran) is not a precedent; an invalid test cannot carry a verdict at all, by the schema', async () => {
    await experiment({ opp: 'prec_oppA', whatWeDo: DO, question: Q, retired: 'its search was closed before it was decided' });
    const p = await precedentFor({ founderId: OWNER, opportunityId: 'prec_oppA', design: { whatWeDo: DO, question: Q } });
    expect(p.stands).toBe('clear');
  });

  it('the same question by the same mechanism, settled: asked before, naming the test and the thresholds', async () => {
    const x = await experiment({ opp: 'prec_oppA', whatWeDo: DO, question: Q, settled: 'surprised',
      design: { decides: 'whether a millwork shop reached cold pays $29 for a screened brief', exchange: 'upfront_price', distribution: 'cold outbound once each from the named operator' } });
    const p = await precedentFor({ founderId: OWNER, opportunityId: 'prec_oppA',
      design: { whatWeDo: 'Send one email to each hand-reviewed Massachusetts millwork business offering a $29 pilot brief of open public bid notices, delivered by email once paid', question: 'Will a Massachusetts millwork business pay $29 for a filtered brief of open public bids when written to cold?' } });
    expect(p.stands).toBe('asked_before');
    expect(p.sameQuestion.map((s) => s.experimentId)).toEqual([x]);
    expect(p.because).toContain('Thresholds: 0.6');
    // A design that names its exchange and distribution is compared on them.
    const byDesign = await precedentFor({ founderId: OWNER, opportunityId: 'prec_oppA',
      design: { whatWeDo: 'something else entirely', question: 'unrelated words here', decides: 'whether a millwork shop reached cold pays $29 for a screened brief', exchange: 'upfront_price', distribution: 'cold outbound once each from the named operator' } });
    expect(byDesign.stands).toBe('asked_before');
    // A different exchange for the same question is narrowed, never refused.
    const otherExchange = await precedentFor({ founderId: OWNER, opportunityId: 'prec_oppA',
      design: { whatWeDo: 'something else entirely', question: Q, decides: 'whether a millwork shop reached cold pays $29 for a screened brief', exchange: 'value_first', distribution: 'cold outbound once each from the named operator' } });
    expect(otherExchange.stands).toBe('narrowed');
    expect(otherExchange.because).toContain('by a different mechanism');
  });

  it('a design that omits its fields is compared on what it has, and never crashes', async () => {
    const p = await precedentFor({ founderId: OWNER, opportunityId: 'prec_oppA', design: {} });
    expect(p.stands).toBe('clear');
    const q = await precedentFor({ founderId: OWNER, opportunityId: 'prec_oppA', design: { question: Q } });
    expect(q.stands).toBe('narrowed');
  });

  it('the other candidate is untouched by A\'s settlement', async () => {
    const p = await precedentFor({ founderId: OWNER, opportunityId: 'prec_oppB', design: { whatWeDo: DO, question: Q } });
    expect(p.stands).toBe('clear');
  });

  it('two settled tests that disagree are both named; the reader takes no side', async () => {
    const y = await experiment({ opp: 'prec_oppB', whatWeDo: DO, question: Q, settled: 'as_predicted' });
    const z = await experiment({ opp: 'prec_oppB', whatWeDo: DO, question: Q, settled: 'surprised' });
    const p = await precedentFor({ founderId: OWNER, opportunityId: 'prec_oppB', design: { whatWeDo: DO, question: Q } });
    expect(p.stands).toBe('asked_before');
    expect(new Set(p.sameQuestion.map((s) => s.experimentId))).toEqual(new Set([y, z]));
    expect(p.sameQuestion.map((s) => s.outcome.word).sort()).toEqual(['as predicted', 'surprised']);
    // A re-run of one of them is on the record; the other still stands.
    const r = await precedentFor({ founderId: OWNER, opportunityId: 'prec_oppB', rerunOf: y, design: { whatWeDo: DO, question: Q } });
    expect(r.stands).toBe('asked_before');
    expect(r.sameQuestion.map((s) => s.experimentId)).toEqual([z]);
  });

  it('the test being designed is never its own precedent', async () => {
    const x = await experiment({ opp: 'prec_oppB', whatWeDo: DO, question: Q, settled: 'surprised' });
    const p = await precedentFor({ founderId: OWNER, opportunityId: 'prec_oppB', except: x, design: { whatWeDo: DO, question: Q } });
    expect(p.sameQuestion.map((s) => s.experimentId)).not.toContain(x);
  });
});
