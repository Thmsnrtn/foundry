process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// The narrative is written by a model; this test is about the numbers and the
// words around them, so the call is stubbed rather than made.
vi.mock('../../src/services/ai/client.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  callOpus: vi.fn(async () => ({ content: 'stubbed narrative', tokensUsed: 0, costUsd: 0 })),
}));

const { computeFundingReadiness } = await import('../../src/services/investor/board_packet.js');

// =============================================================================
// A FUNDRAISING VERDICT ABOUT A COMPANY NOBODY MEASURED.
//
// `computeFundingReadiness` scores seven components, and each carries a branch
// scoring 50 when its input is null — a defensible neutral, and better than the
// extremes found in the agent prompts.
//
// THAT BRANCH NEVER RAN. The row is read as `rows[0] ?? {}`, so a company with
// no metric snapshot at all produced `undefined`, not `null`; the `=== null`
// check missed it and every numeric comparison fell through to the final
// `: 10` / `: 20`. Such a company scored 10, 20 and 20 on its three revenue
// components — not a neutral placeholder, very nearly the worst score
// available.
//
// Then the gap list tested those scores against thresholds of 60, so a company
// that had reported NOTHING was told, in a document it would fundraise on:
//
//   "Churn rate above acceptable threshold for this stage"
//   "Activation rate below benchmarks for fundraising"
//   "MRR health ratio indicates churn exceeds new revenue"
//   "Technical audit score below threshold — product readiness concerns"
//
// Four specific negative findings about numbers that did not exist. Note the
// direction against the agents' defect: there the fabrication FLATTERED, here
// it CONDEMNED. Both come from answering "unknown" with a digit, and which way
// it lands is an accident of where somebody put a threshold.
//
// The decision component had its own version: the query averaged unmeasured
// outcomes AS ZERO — `AVG(CASE WHEN outcome_valence IS NOT NULL THEN
// outcome_valence ELSE 0 END)`, when AVG already skips nulls. Two good outcomes
// among ninety-eight unmeasured ones scored the same as a company that had
// gone nowhere.
// =============================================================================

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => {
  await query('DELETE FROM metric_snapshots');
  await query('DELETE FROM audit_scores');
  await query('DELETE FROM decisions');
  await query('DELETE FROM products');
  await query('DELETE FROM founders');
});

async function addCompany(): Promise<string> {
  const owner = `f_${nanoid(8)}`;
  await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)',
    [owner, `clerk_${owner}`, `${owner}@example.com`]);
  const pid = `p_${nanoid(8)}`;
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,?,?,'active')",
    [pid, 'Company', owner]);
  return pid;
}

describe('a company that has reported nothing', () => {
  it('is told what is unmeasured, not what is wrong with it', async () => {
    const r = await computeFundingReadiness(await addCompany());

    for (const fabricated of [
      /Churn rate above acceptable threshold/,
      /Activation rate below benchmarks/,
      /MRR health ratio indicates churn exceeds new revenue/,
      /Technical audit score below threshold/,
    ]) {
      expect(r.key_gaps.join(' | '), 'a finding about a number that does not exist')
        .not.toMatch(fabricated);
    }

    expect(r.unmeasured.join(' | ')).toMatch(/Churn rate — no churn figure reported/);
    expect(r.unmeasured.join(' | ')).toMatch(/Activation rate — no activation figure/);
    expect(r.unmeasured.join(' | ')).toMatch(/Technical audit — no audit has been run/);
    expect(r.unmeasured.join(' | ')).toMatch(/MRR health ratio — no revenue snapshot/);
  });

  it('says how much of the score was real', async () => {
    const r = await computeFundingReadiness(await addCompany());
    expect(r.measured_components.total).toBe(7);
    expect(r.measured_components.measured, 'team size and DNA are counts, always answerable')
      .toBe(2);
  });

  it('is not raise-ready on an empty gap list', async () => {
    const r = await computeFundingReadiness(await addCompany());
    expect(r.verdict, 'the mirror of the old bug, and worse in this document')
      .toBe('not_ready');
  });

  it('reaches the neutral branch that was being skipped', async () => {
    const r = await computeFundingReadiness(await addCompany());
    // `rows[0] ?? {}` gave undefined, so `=== null` missed and these fell
    // through to the worst branch: 10, 20, 20.
    expect(r.component_scores.mrr_trajectory_score, 'was 10').toBe(50);
    expect(r.component_scores.churn_score, 'was 20').toBe(50);
    expect(r.component_scores.activation_score, 'was 20').toBe(50);
  });
});

describe('a company that has reported figures', () => {
  it('is told what is actually wrong', async () => {
    const pid = await addCompany();
    await query(
      `INSERT INTO metric_snapshots
         (id, product_id, snapshot_date, churn_rate, activation_rate, mrr_health_ratio)
       VALUES (?,?, date('now'), 0.15, 0.10, 1.6)`, [nanoid(), pid]);

    const r = await computeFundingReadiness(pid);
    expect(r.key_gaps.join(' | ')).toMatch(/Churn rate above acceptable threshold/);
    expect(r.key_gaps.join(' | ')).toMatch(/Activation rate below benchmarks/);
    expect(r.unmeasured.join(' | '), 'these three were reported').not.toMatch(/Churn rate —/);
    expect(r.measured_components.measured).toBe(5);
  });

  it('reports a good figure as good rather than as absent', async () => {
    const pid = await addCompany();
    await query(
      `INSERT INTO metric_snapshots
         (id, product_id, snapshot_date, churn_rate, activation_rate, mrr_health_ratio)
       VALUES (?,?, date('now'), 0.01, 0.7, 0.2)`, [nanoid(), pid]);

    const r = await computeFundingReadiness(pid);
    expect(r.component_scores.churn_score).toBe(100);
    expect(r.component_scores.activation_score).toBe(100);
    expect(r.key_gaps.join(' | ')).not.toMatch(/Churn rate|Activation rate/);
  });
});

describe('decision outcomes that were never measured', () => {
  it('are excluded rather than averaged in as neutral', async () => {
    const pid = await addCompany();
    const add = (valence: number | null) => query(
      `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status, outcome_valence)
       VALUES (?,?, 'product', 2, 'x', 'y', 'executed', ?)`, [nanoid(), pid, valence]);
    await add(1); await add(1);
    for (let i = 0; i < 8; i++) await add(null);

    const r = await computeFundingReadiness(pid);
    expect(r.component_scores.decision_track_record_score,
      'two measured outcomes, both good — the eight unmeasured ones are not neutral results')
      .toBe(100);
  });

  it('leave the component unmeasured when none was measured at all', async () => {
    const pid = await addCompany();
    await query(
      `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status)
       VALUES (?,?, 'product', 2, 'x', 'y', 'executed')`, [nanoid(), pid]);

    const r = await computeFundingReadiness(pid);
    expect(r.component_scores.decision_track_record_score).toBe(50);
    expect(r.unmeasured.join(' | ')).toMatch(/no decision outcome has been measured/);
  });

  it('holds no CASE that folds a null valence in as zero', () => {
    const src = stripComments(
      readFileSync('src/services/investor/board_packet.ts', 'utf8'), { lineComments: true });
    expect(src, 'AVG already skips nulls; the CASE existed only to include them')
      .not.toMatch(/outcome_valence ELSE 0 END/);
  });
});

describe('what reaches the page and the model', () => {
  it('persists the unmeasured list rather than dropping it', () => {
    const route = readFileSync('src/routes/dashboard/investors.ts', 'utf8');
    expect(route).toMatch(/unmeasured = excluded\.unmeasured/);
    expect(route).toMatch(/<strong>Not measured:<\/strong>/);
    expect(route).toMatch(/not a\s*\n?\s*middling assessment/);
  });

  it('tells the narrative model which components are unmeasured', () => {
    const src = readFileSync('src/services/investor/board_packet.ts', 'utf8');
    expect(src).toMatch(/Not measured at all:/);
    expect(src).toMatch(/Do not describe an unmeasured component as good or bad/);
    expect(stripComments(src, { lineComments: true }),
      'the model used to be handed "Churn: 50/100" with no note')
      .not.toMatch(/Churn: \$\{churnScore\}\/100/);
  });

  it('does not report a recorded zero as unmeasured in the briefings', () => {
    for (const f of ['src/services/scp/briefing/compressed.ts',
                     'src/services/scp/briefing/email-digest.ts']) {
      const src = stripComments(readFileSync(f, 'utf8'), { lineComments: true });
      expect(src, 'truthiness reported a pre-revenue company as unmeasured')
        .not.toMatch(/mrr_cents\s*\n?\s*\?\s*`\$/);
      expect(src).toMatch(/mrr_cents != null/);
    }
  });
});
