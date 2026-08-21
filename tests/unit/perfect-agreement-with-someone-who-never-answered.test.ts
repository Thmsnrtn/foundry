process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getAlignmentScore, getDecisionAttribution } from '../../src/services/wisdom/cofounder.js';

// =============================================================================
// PERFECT AGREEMENT WITH SOMEONE WHO NEVER ANSWERED.
//
// `getAlignmentScore` compares co-founders' independent DNA responses. Its two
// branches that have nothing to compare returned opposite extremes of the same
// absence:
//
//   no responses at all   → 0, 0, 0, 0        complete disagreement
//   one founder responded → 100, 100, 100, 100  perfect agreement
//
// A solo founder was reported as being in perfect alignment with co-founders who
// had said nothing. The recommendation string explained the case; the four
// numbers did not, and a number is what a caller renders.
//
// A CO-FOUNDER COMPARISON WITH NO CO-FOUNDERS IN IT. `by_founder` was keyed on
// `decisions.decided_by`. That column does not hold a person. Migration 153 said
// so outright — "`decided_by` holds 'founder' or 'second_self'. That is a KIND"
// — and added `decided_by_founder_id` for the person; migration 158 put the
// CHECK on it.
//
// So the map had at most two keys and neither was a co-founder: one was the
// human role, the other was Foundry deciding for itself. The imbalance check
// compared those two and reported "One co-founder is approving significantly
// more decisions than the other." It told a founder their CO-FOUNDER was out of
// balance, on the strength of a comparison between the founder and the machine.
//
// Both questions are real and they are different, so both are answered now,
// each from the column that holds it.
//
// TWO LABELS, ONE NUMBER. `.proposed` counted decisions CLOSED. Nobody proposed
// them; `decisions` has no proposer column at all.
//
// AND AN ABSENCE REPORTED AS A NEGATIVE FINDING. `imbalance_detected` was
// `false` whenever fewer than two people had decided anything — which is the
// most imbalanced arrangement there is. False reads as "we checked, they are
// balanced".
// =============================================================================

vi.mock('../../src/services/ai/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/ai/client.js')>()),
  callOpus: async () => ({
    content: JSON.stringify({
      overall_alignment: 62, vision_alignment: 70, priority_alignment: 55,
      risk_alignment: 61, divergence_axis: 'speed-vs-quality',
      recommendations: ['Agree a shipping bar.'],
    }),
    model: 'stub', usage: { input_tokens: 0, output_tokens: 0 }, stop_reason: null,
  }),
}));

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_a','c_a','a@example.com')");
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_b','c_b','b@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES ('p_al','Acme','f_a','active')");
});
beforeEach(async () => {
  await query('DELETE FROM cofounder_dna_responses');
  await query('DELETE FROM cofounder_alignment_scores');
  await query('DELETE FROM decisions');
});

async function dna(founderId: string, field: string, response: string) {
  await query(
    `INSERT INTO cofounder_dna_responses (id, product_id, founder_id, dna_field, response)
     VALUES (?, 'p_al', ?, ?, ?)`, [nanoid(), founderId, field, response]);
}

async function decision(
  kind: 'founder' | 'second_self', status: string, founderId: string | null = null,
) {
  await query(
    `INSERT INTO decisions
       (id, product_id, what, why_now, category, gate, status, decided_by,
        decided_by_founder_id, decided_at)
     VALUES (?, 'p_al', 'a decision', 'because', 'strategic', 1, ?, ?, ?, datetime('now'))`,
    [nanoid(), status, kind, founderId]);
}

describe('alignment is not scored when there is nothing to compare', () => {
  it('nobody has answered: null, not zero', async () => {
    const score = await getAlignmentScore('p_al');
    expect(score.overall_alignment).toBeNull();
    expect(score.vision_alignment).toBeNull();
    expect(score.priority_alignment).toBeNull();
    expect(score.risk_alignment).toBeNull();
    expect(score.respondents).toBe(0);
    expect(score.recommendations.join(' ')).toMatch(/No co-founder DNA responses/);
  });

  it('one person has answered: null, not a hundred', async () => {
    await dna('f_a', 'icp', 'mid-market ops teams');
    const score = await getAlignmentScore('p_al');
    expect(score.overall_alignment,
      'perfect alignment with someone who never answered').toBeNull();
    expect(score.respondents).toBe(1);
    expect(score.recommendations.join(' ')).toMatch(/Only one co-founder has responded/);
  });

  it('the same absence does not score 0 one way and 100 the other', async () => {
    const none = await getAlignmentScore('p_al');
    await dna('f_a', 'icp', 'mid-market ops teams');
    const one = await getAlignmentScore('p_al');
    expect(none.overall_alignment).toBe(one.overall_alignment);
  });

  it('two people have answered: a real score, and it is persisted', async () => {
    await dna('f_a', 'icp', 'mid-market ops teams');
    await dna('f_b', 'icp', 'enterprise procurement');
    const score = await getAlignmentScore('p_al');
    expect(score.overall_alignment).toBe(62);
    expect(score.respondents).toBe(2);

    const row = (await query(
      'SELECT overall_alignment FROM cofounder_alignment_scores')).rows[0] as Record<string, unknown>;
    expect(Number(row.overall_alignment)).toBe(62);
  });
});

describe('the attribution counts what it says it counts', () => {
  it('keys on the person, not on the kind of decider', async () => {
    await decision('founder', 'approved', 'f_a');
    await decision('founder', 'rejected', 'f_a');

    const attr = await getDecisionAttribution('p_al');
    expect(attr.by_founder['f_a']).toEqual({ decided: 2, approved: 1 });
    expect(Object.keys(attr.by_founder),
      "'founder' is a role; it must not appear as a person")
      .not.toContain('founder');
    expect(Object.keys(attr.by_founder['f_a']!),
      '`decisions` records who decided; nobody proposed these')
      .not.toContain('proposed');
  });

  it('never mistakes Foundry for a co-founder', async () => {
    for (let i = 0; i < 10; i++) await decision('second_self', 'approved');
    await decision('founder', 'approved', 'f_a');

    const attr = await getDecisionAttribution('p_al');
    expect(attr.imbalance_detected,
      'the founder versus the machine is not a co-founder imbalance').toBeNull();
    expect(attr.by_decider_kind).toEqual({ founder: 1, second_self: 10 });
    expect(attr.unattributed, 'the ten Foundry took have no person on them').toBe(10);
  });

  it('says imbalance is not applicable rather than absent', async () => {
    for (let i = 0; i < 5; i++) await decision('founder', 'approved', 'f_a');
    const attr = await getDecisionAttribution('p_al');
    expect(attr.imbalance_detected,
      'one person deciding everything is not a balanced arrangement').toBeNull();
  });

  it('detects a real imbalance between two people', async () => {
    for (let i = 0; i < 10; i++) await decision('founder', 'approved', 'f_a');
    await decision('founder', 'approved', 'f_b');
    const attr = await getDecisionAttribution('p_al');
    expect(attr.imbalance_detected).toBe(true);
    expect(attr.imbalance_description).toMatch(/approving significantly more/);
  });

  it('reports false only when it actually checked', async () => {
    for (let i = 0; i < 5; i++) await decision('founder', 'approved', 'f_a');
    for (let i = 0; i < 5; i++) await decision('founder', 'approved', 'f_b');
    const attr = await getDecisionAttribution('p_al');
    expect(attr.imbalance_detected).toBe(false);
  });
});
