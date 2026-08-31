// =============================================================================
// FOUNDRY — Ghost Company simulator (Ascent B3)
//
// "Fork reality": before a high-stakes decision, simulate each option's 90-day
// MRR trajectory. Loop stage: frame/decide. Laws: Ledger (every simulation is
// persisted with its assumptions), Honesty (abstains without enough history;
// the model contributes only LABELED effect-priors per option — all numbers
// come from the company's own telemetry + reproducible math).
//
// Mechanics (adapted from AcreOS portfolioOptimizer's Monte-Carlo technique):
//   1. Estimate the company's real monthly MRR growth mean/σ from its own
//      metric_snapshots history (≥4 points or we abstain).
//   2. One atomic model call maps each decision option to structured priors
//      ({growth_delta_pp, rationale}) — judgment, clearly labeled as such.
//   3. A SEEDED Monte Carlo (mulberry32 + Box-Muller; seed = decision id) runs
//      1,000 90-day paths per option: reproducible, no Math.random in fact
//      paths, same decision → same fork every time.
// Results land in scenario_models (best=p90 / base=p50 / stress=p10), which
// the decision chamber already renders — the existing Scenarios stage lights up.
// =============================================================================

import { nanoid } from 'nanoid';
import { z } from 'zod';
import { query } from '../../db/client.js';
import { callSonnet, parseJSONResponse } from '../ai/client.js';
import { buildInsert } from '../../db/schema/kernel.js';
import { log } from '../../lib/logger.js';

const RUNS = 1000;
const HORIZON_MONTHS = 3;
const MIN_HISTORY = 4;

// ── Seeded RNG (mulberry32) + Box-Muller normal draws — deterministic per seed.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function normal(rng: () => number): number {
  // Box-Muller; guard u1=0.
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export interface Baseline {
  currentMrrCents: number;
  monthlyGrowthMean: number;   // e.g. 0.04 = +4%/mo
  monthlyGrowthStd: number;
  nSnapshots: number;
  /** Calendar days between the first and last snapshot used. Four snapshots a
   *  day apart and four a quarter apart are different evidence, and the number
   *  travels with the estimate so a reader can tell them apart. */
  historySpanDays: number;
}

/** The company's own trajectory, from its own history. Returns null (abstain)
 *  below MIN_HISTORY usable points — we never simulate on fabricated numbers. */
export async function estimateBaseline(productId: string): Promise<Baseline | null> {
  // THE MOST RECENT 24 SNAPSHOTS, NOT THE FIRST 24. `ORDER BY snapshot_date ASC
  // LIMIT 24` takes the OLDEST rows, so a company with two years of history was
  // simulated forward from the growth rate of its first three weeks. The
  // ordering is reversed here and the series re-sorted into date order below.
  const r = await query(
    `SELECT snapshot_date, mrr_cents, new_mrr_cents, expansion_mrr_cents,
            contraction_mrr_cents, churned_mrr_cents
     FROM metric_snapshots WHERE product_id = ?
     ORDER BY snapshot_date DESC LIMIT 24`,
    [productId],
  );
  const rows = (r.rows as unknown as Array<Record<string, string | number | null>>)
    .slice().reverse();

  // MRR series: prefer absolute mrr_cents; else reconstruct cumulatively from deltas.
  const series: Array<{ date: string; mrr: number }> = [];
  let cum = 0;
  for (const row of rows) {
    const date = String(row.snapshot_date);
    if (row.mrr_cents != null) {
      cum = Number(row.mrr_cents);
      series.push({ date, mrr: cum });
      continue;
    }
    const delta = Number(row.new_mrr_cents ?? 0) + Number(row.expansion_mrr_cents ?? 0)
      - Number(row.contraction_mrr_cents ?? 0) - Number(row.churned_mrr_cents ?? 0);
    cum += delta;
    if (cum > 0) series.push({ date, mrr: cum });
  }
  if (series.length < MIN_HISTORY) return null;

  // A GROWTH RATE HAS A PERIOD, AND THIS ONE'S WAS WHATEVER THE COMPANY'S
  // REPORTING CADENCE HAPPENED TO BE. The rate between two consecutive
  // snapshots was called `monthlyGrowthMean` and compounded three times for a
  // 90-day horizon. `metric_snapshots` is keyed by DATE and companies report
  // daily, so for most of them this was the mean DAILY growth compounded over
  // three days, presented as a 90-day forecast with p10/p50/p90 bands. Each
  // observed step is now converted to its monthly equivalent using the gap
  // between the two dates, which is what the rest of this file assumes it has.
  const DAYS_PER_MONTH = 30.44;
  const growths: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    const next = series[i];
    if (prev.mrr <= 0) continue;
    const gapDays = (Date.parse(`${next.date}T00:00:00Z`) - Date.parse(`${prev.date}T00:00:00Z`))
      / 86_400_000;
    if (!Number.isFinite(gapDays) || gapDays <= 0) continue;
    growths.push((next.mrr / prev.mrr) ** (DAYS_PER_MONTH / gapDays) - 1);
  }
  if (growths.length < MIN_HISTORY - 1) return null;
  const mean = growths.reduce((a, b) => a + b, 0) / growths.length;
  const variance = growths.reduce((a, b) => a + (b - mean) ** 2, 0) / growths.length;
  const spanDays = (Date.parse(`${series[series.length - 1].date}T00:00:00Z`)
    - Date.parse(`${series[0].date}T00:00:00Z`)) / 86_400_000;
  return {
    currentMrrCents: series[series.length - 1].mrr,
    monthlyGrowthMean: mean,
    monthlyGrowthStd: Math.sqrt(variance),
    nSnapshots: series.length,
    historySpanDays: Number.isFinite(spanDays) ? spanDays : 0,
  };
}

const priorSchema = z.object({
  options: z.array(z.object({
    label: z.string(),
    growth_delta_pp: z.number().min(-50).max(50), // percentage-POINT shift to monthly growth
    rationale: z.string(),
  })).min(1),
});

export interface OptionFork {
  label: string;
  p10: number; p50: number; p90: number;   // 90-day MRR (cents)
  probDecline: number;                      // P(MRR_90d < today)
  growthDeltaPp: number;
  rationale: string;
}

function simulatePath(base: Baseline, deltaPp: number, rng: () => number): number {
  let mrr = base.currentMrrCents;
  for (let m = 0; m < HORIZON_MONTHS; m++) {
    const g = base.monthlyGrowthMean + deltaPp / 100 + normal(rng) * base.monthlyGrowthStd;
    mrr = Math.max(0, mrr * (1 + g));
  }
  return mrr;
}

function fork(base: Baseline, label: string, deltaPp: number, rationale: string, seed: number): OptionFork {
  const rng = mulberry32(seed);
  const outcomes: number[] = [];
  let declines = 0;
  for (let i = 0; i < RUNS; i++) {
    const v = simulatePath(base, deltaPp, rng);
    outcomes.push(v);
    if (v < base.currentMrrCents) declines++;
  }
  outcomes.sort((a, b) => a - b);
  return {
    label,
    p10: outcomes[Math.floor(RUNS * 0.10)],
    p50: outcomes[Math.floor(RUNS * 0.50)],
    p90: outcomes[Math.floor(RUNS * 0.90)],
    probDecline: declines / RUNS,
    growthDeltaPp: deltaPp,
    rationale,
  };
}

const fmt = (cents: number): string => `$${Math.round(cents / 100).toLocaleString()}`;

/** Run the Ghost fork for a pending decision: baseline (do-nothing ghost) plus
 *  one fork per option, persisted to scenario_models for the chamber to render.
 *  Idempotent per decision. Returns the forks, or null when we must abstain. */
export async function runGhostFork(decisionId: string, productId: string): Promise<OptionFork[] | null> {
  const existing = await query(
    'SELECT id FROM scenario_models WHERE decision_id = ? LIMIT 1', [decisionId],
  );
  if (existing.rows.length > 0) return null; // already forked

  const dRes = await query(
    'SELECT * FROM decisions WHERE id = ? AND product_id = ?', [decisionId, productId],
  );
  const decision = dRes.rows[0] as Record<string, unknown> | undefined;
  if (!decision) return null;

  const base = await estimateBaseline(productId);
  if (!base) {
    log.info('ghost fork abstained — insufficient MRR history', { productId, decisionId });
    return null; // Honesty Law: no history, no forecast.
  }

  let options: Array<{ label: string; description?: string }> = [];
  try {
    options = typeof decision.options === 'string' ? JSON.parse(decision.options as string) : [];
  } catch { /* no options */ }
  if (options.length === 0) options = [{ label: decision.recommendation as string ?? 'Proceed' }];

  // Judgment layer (labeled as such): map each option to a growth-delta prior.
  const userPrompt = `DECISION: ${decision.what}\nWHY NOW: ${decision.why_now ?? 'n/a'}\n\nCOMPANY BASELINE (from its own history: ${base.nSnapshots} snapshots spanning ${Math.round(base.historySpanDays)} days): MRR ${fmt(base.currentMrrCents)}, monthly growth mean ${(base.monthlyGrowthMean * 100).toFixed(1)}% ± ${(base.monthlyGrowthStd * 100).toFixed(1)}%.\n\nOPTIONS:\n${options.map((o, i) => `${i + 1}. ${o.label}${o.description ? ` — ${o.description}` : ''}`).join('\n')}\n\nFor EACH option, estimate the shift it makes to MONTHLY MRR growth in percentage points over the next 90 days, as a conservative point estimate. Respond ONLY JSON: {"options":[{"label","growth_delta_pp","rationale"}]}`;
  const response = await callSonnet(
    'You translate a business decision\'s options into conservative monthly-growth deltas (percentage points). You are an estimator, not a cheerleader: when in doubt, estimate closer to 0. Your numbers are labeled as judgment-priors and combined with the company\'s real variance — do not inflate.',
    userPrompt, 800, productId,
  );
  const priors = parseJSONResponse(response.content, priorSchema);

  const seed = hashSeed(decisionId);
  const forks: OptionFork[] = [
    fork(base, 'Ghost (do nothing)', 0, 'The company\'s own trajectory, unchanged.', seed),
    ...priors.options.map((p, i) => fork(base, p.label, p.growth_delta_pp, p.rationale, seed + i + 1)),
  ];

  const assumptions = JSON.stringify({
    n_snapshots: base.nSnapshots,
    history_span_days: base.historySpanDays,
    monthly_growth_mean: base.monthlyGrowthMean,
    monthly_growth_std: base.monthlyGrowthStd,
    runs: RUNS, horizon_months: HORIZON_MONTHS, seed,
    priors: priors.options,
  });

  for (const f of forks) {
    const { sql, args } = buildInsert('scenario_models', {
      id: nanoid(),
      decision_id: decisionId,
      product_id: productId,
      option_label: f.label,
      best_case: `${fmt(f.p90)} MRR in 90d (p90)`,
      base_case: `${fmt(f.p50)} MRR in 90d (p50) · ${(f.probDecline * 100).toFixed(0)}% risk of decline`,
      stress_case: `${fmt(f.p10)} MRR in 90d (p10)`,
      data_inputs_used: assumptions,
    });
    await query(sql, args);
  }
  log.info('ghost fork complete', { productId, decisionId, forks: forks.length });
  return forks;
}
