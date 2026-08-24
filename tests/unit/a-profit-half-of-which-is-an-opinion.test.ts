process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  getAICompanyPL, getAgentCostBreakdown, getROISummary, logCost, logRevenue,
} from '../../src/services/financial/economics.js';
import { getExperimentSummary } from '../../src/services/scp/experiments.js';

// =============================================================================
// A PROFIT, HALF OF WHICH IS AN OPINION.
//
// The AI Company P&L subtracts two different kinds of number. Costs are real:
// `cost_events` rows written by the agent runner from tokens actually spent.
// Revenue is not: `revenue_attributions` has ONE writer — the Ledger agent —
// which asks a language model how much revenue another agent's action produced,
// takes the confidence that same model assigned to its own guess, filters at
// `> 0.6` and multiplies the amount by it. Nothing reconciles any of it against
// Stripe, an invoice or a customer.
//
// Showing that to a founder, labelled, is fair. Subtracting it from a measured
// cost and calling the difference "Profit", dividing and calling it "ROI", and
// answering "Self-Funding: Yes" is Foundry stating that it pays for itself on
// the strength of its own guess. The same ratio reaches an INVESTOR packet as
// "AI ROI 2.4x", and the strategy prompt handed the model the numbers with no
// indication that half of them were its own.
// =============================================================================

const P = 'p_pl';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_pl','c_pl','pl@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_pl','active')", [P]);
});

beforeEach(async () => {
  await query('DELETE FROM cost_events');
  await query('DELETE FROM revenue_attributions');
  await query('DELETE FROM experiments');
  await query('DELETE FROM hypotheses');
});

describe('the shape of the P&L', () => {
  it('names every figure that inherits an estimate', async () => {
    await logCost({ productId: P, agentName: 'ledger', costType: 'llm_tokens', amountUsd: 2 });
    await logRevenue({
      productId: P, attributionType: 'direct', agentName: 'ledger',
      amountUsd: 10, confidence: 0.8, description: 'a guess',
    });

    const pl = await getAICompanyPL(P, 30);
    // 10 × 0.8 = 8, which is the confidence weighting, not a measurement.
    expect(pl.attributed_revenue.total_usd).toBeCloseTo(8, 6);
    expect(pl.costs.total_usd).toBeCloseTo(2, 6);
    expect(pl.attributed_profit_usd).toBeCloseTo(6, 6);
    expect(pl.attributed_roi).toBeCloseTo(3, 6);
    expect(pl.attributed_revenue_covers_cost).toBe(true);

    // The old names are gone, because the name is what a reader carries away.
    expect(Object.keys(pl)).not.toContain('profit_usd');
    expect(Object.keys(pl)).not.toContain('self_funding');
    expect(Object.keys(pl)).not.toContain('revenue');
  });

  it('reports an unmeasured ratio as unmeasured, not as zero', async () => {
    // A company whose agents have not run has no cost to divide by. "ROI 0.0%"
    // was the answer, in amber, beside companies that had one.
    const pl = await getAICompanyPL(P, 30);
    expect(pl.costs.total_usd).toBe(0);
    expect(pl.attributed_roi).toBeNull();

    const summary = await getROISummary(P);
    expect(summary.attributed_roi_ratio).toBeNull();
    expect(summary.top_attributed_roi_agent).toBeNull();
    expect(summary.bottom_attributed_roi_agent).toBeNull();
  });

  it('ranks only the agents that recorded a cost', async () => {
    await logCost({ productId: P, agentName: 'ledger', costType: 'llm_tokens', amountUsd: 1 });
    await logRevenue({
      productId: P, attributionType: 'direct', agentName: 'ledger',
      amountUsd: 10, confidence: 1, description: 'a guess',
    });
    const summary = await getROISummary(P);
    expect(summary.top_attributed_roi_agent).toBe('ledger');
    // It used to return the string 'none' as an agent name for both ends.
    expect(summary.bottom_attributed_roi_agent).toBe('ledger');
  });

  it('carries its provenance with the numbers, because both readers are models or founders', async () => {
    const summary = await getROISummary(P);
    expect(summary.provenance).toContain('measured');
    expect(summary.provenance).toContain('estimate');
  });

  it('leaves a per-agent ratio null when that agent recorded no cost', async () => {
    await logCost({ productId: P, agentName: 'ledger', costType: 'llm_tokens', amountUsd: 4 });
    const [row] = await getAgentCostBreakdown(P, 30);
    expect(row.agent_name).toBe('ledger');
    expect(row.attributed_roi).toBeCloseTo(-1, 6);   // cost, no attributed revenue

    await query('DELETE FROM cost_events');
    expect(await getAgentCostBreakdown(P, 30)).toEqual([]);
  });
});

describe('the window the attributions are read through', () => {
  it('counts an attribution the moment it is recorded', async () => {
    // `logRevenue` stores `period_start = now - 30 days`: the period the
    // revenue is attributed OVER. The P&L asked for `period_start >= now - 30
    // days`, evaluated after the write, so every attribution's own start was a
    // hair before the boundary and was excluded — attributed revenue was 0 for
    // every company in every window since the P&L was written, which made
    // "Profit" the negative of cost and "Self-Funding" permanently "No".
    await logCost({ productId: P, agentName: 'ledger', costType: 'llm_tokens', amountUsd: 1 });
    await logRevenue({
      productId: P, attributionType: 'direct', agentName: 'ledger',
      amountUsd: 25, confidence: 1, description: 'a guess',
    });

    const pl = await getAICompanyPL(P, 30);
    expect(pl.attributed_revenue.total_usd).toBeCloseTo(25, 6);
    expect(pl.attributed_revenue.by_agent.ledger).toBeCloseTo(25, 6);
    expect(pl.attributed_profit_usd).toBeCloseTo(24, 6);

    const [row] = await getAgentCostBreakdown(P, 30);
    expect(row.attributed_revenue_usd).toBeCloseTo(25, 6);
  });

  it('does not drop the oldest day of the window to a format mismatch', async () => {
    // `created_at` is CURRENT_TIMESTAMP, 'YYYY-MM-DD HH:MM:SS'; the bound was a
    // JavaScript ISO string, 'YYYY-MM-DDTHH:MM:SS.sssZ'. Compared as TEXT, a
    // space sorts before 'T', so EVERY row written on the boundary date read as
    // earlier than the boundary whatever its clock time — a "trailing 30 days"
    // window that silently dropped its oldest day.
    await logRevenue({
      productId: P, attributionType: 'direct', agentName: 'ledger',
      amountUsd: 40, confidence: 1, description: 'a guess',
    });
    const boundary = (await query(
      "SELECT datetime('now', '-30 days') AS b")).rows[0] as unknown as Record<string, unknown>;
    // Late in the day, 30 days back: inside a 30-day window by any reading.
    await query('UPDATE revenue_attributions SET created_at = ?',
      [`${String(boundary.b).slice(0, 10)} 23:59:59`]);

    const pl = await getAICompanyPL(P, 30);
    expect(pl.attributed_revenue.total_usd).toBeCloseTo(40, 6);
  });

  it('still honours the window it was given', async () => {
    await logRevenue({
      productId: P, attributionType: 'direct', agentName: 'ledger',
      amountUsd: 25, confidence: 1, description: 'a guess',
    });
    await query(
      "UPDATE revenue_attributions SET created_at = '2020-01-01T00:00:00.000Z'");
    const pl = await getAICompanyPL(P, 30);
    expect(pl.attributed_revenue.total_usd).toBe(0);
  });
});

describe('what the strategy prompt is told', () => {
  const src = stripComments(readFileSync('src/services/strategy/synthesis.ts', 'utf8'));

  it('passes the economics under a name that says what they are', () => {
    expect(src).toContain('attributed_economics: roiSummary');
    expect(src).not.toMatch(/\broi: roiSummary\b/);
  });

  it('forbids the model from restating them as measured results', () => {
    expect(src).toContain('Never state');
    expect(src).toContain('never conclude');
  });
});

describe('the investor-facing ratio', () => {
  const packet = stripComments(readFileSync('src/services/investor/board_packet.ts', 'utf8'));
  const page = stripComments(readFileSync('src/routes/dashboard/investors.ts', 'utf8'));

  it('is named for the half it inherits', () => {
    expect(packet).toContain('attributed_roi');
    expect(packet).not.toMatch(/^\s*roi,$/m);
    expect(page).toContain('Attributed AI ROI');
  });
});

describe('the experiment summary', () => {
  async function experiment(id: string, opts: {
    endedAt?: string | null; actualEndAt?: string | null; results?: string | null;
  }) {
    await query(
      `INSERT INTO hypotheses (id, product_id, proposed_by, statement, status)
       VALUES (?, ?, 'oracle', 'a statement', 'active')`, [`h_${id}`, P]);
    await query(
      `INSERT INTO experiments
         (id, product_id, hypothesis_id, name, type, control_description,
          treatment_description, success_metric, status, winner, results_json,
          ended_at, actual_end_at)
       VALUES (?, ?, ?, ?, 'ab_test', 'c', 't', 'signups', 'completed', 'treatment', ?, ?, ?)`,
      [id, P, `h_${id}`, id, opts.results ?? null,
       opts.endedAt ?? null, opts.actualEndAt ?? null],
    );
  }

  it('no longer reports an average ROI nothing can produce', async () => {
    // `roi_vs_predicted` has no writer anywhere in the codebase, and `?? 0`
    // turned the empty average into a zero — which nobody rendered, but which
    // `strategy/synthesis.ts` put into every model context block as fact.
    const summary = await getExperimentSummary(P);
    expect(Object.keys(summary)).not.toContain('avg_roi_completed');
  });

  it('picks the most recent win by a date something actually writes', async () => {
    // `actual_end_at` is written only by `updateResults`, which has no caller;
    // the engine that concludes experiments writes `ended_at`. Ordering by
    // `actual_end_at` alone ordered every row by NULL.
    await experiment('older', { endedAt: '2026-01-01' });
    await experiment('newer', { endedAt: '2026-06-01' });
    const summary = await getExperimentSummary(P);
    expect(summary.recent_win?.name).toBe('newer');
  });

  it('says the effect size is not recorded rather than announcing +0.0%', async () => {
    // The engine stores per-variant metrics with no `effect_size` key at all.
    await experiment('engine_style', {
      endedAt: '2026-06-01',
      results: JSON.stringify([{ variant: 'control', mean: 1 }, { variant: 'treatment', mean: 2 }]),
    });
    const summary = await getExperimentSummary(P);
    expect(summary.recent_win?.effect_size).toBeNull();
  });

  it('reports an effect size that was recorded', async () => {
    await experiment('measured', {
      endedAt: '2026-06-01',
      results: JSON.stringify({ effect_size: 0.12, p_value: 0.03 }),
    });
    const summary = await getExperimentSummary(P);
    expect(summary.recent_win?.effect_size).toBeCloseTo(0.12, 6);
  });

  it('survives a results blob it cannot read', async () => {
    await experiment('broken', { endedAt: '2026-06-01', results: 'not json at all' });
    const summary = await getExperimentSummary(P);
    expect(summary.recent_win?.name).toBe('broken');
    expect(summary.recent_win?.effect_size).toBeNull();
  });
});
