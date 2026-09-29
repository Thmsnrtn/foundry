// =============================================================================
// FOUNDRY — what the evidence says, and the strongest sentence it supports.
//
// Pure: given the sealed forecasts, the official results and the simulated
// fills, compute the same numbers every time (the digest proves it). The
// verdict ladder has no rung that says "trade". The best any evidence can earn
// is "survived the holdout — the owner reviews it", and even that grants
// nothing: a real-money mandate is the owner's, separately, after a design
// review that has not happened (CAPITAL_RESEARCH.md).
//
// Brier scores are compared on the SAME markets, paired. The model's score is
// computed from the model's own sealed probability and never from a price —
// the legacy tracker filled a missing forecast with the entry price and scored
// the market under the bot's name (resolution_tracker.ts:75). A forecast
// without a probability is excluded from calibration and counted as excluded.
// =============================================================================

import { createHash } from 'node:crypto';

export interface ResolvedForecast {
  marketTicker: string;
  closeTime: string;
  model: 'market_implied_v1' | 'proxy_drift_v1';
  pYes: number | null;
  decision: 'yes' | 'no' | 'skip';
  result: 'yes' | 'no';
  /** The rule text at the snapshot and at resolution were the same. */
  ruleUnchanged: boolean;
  fill: { side: 'yes' | 'no'; filled: number; cost: number; fee: number | null } | null;
  /** The stored fill is what the stored book gives when walked again. */
  fillReproduces?: boolean;
}

/** Fixed before the first observation. */
export const EVALUATION_RULE = {
  /** Fewer independent resolved markets than this and nothing is concluded. */
  minResolvedMarkets: 200,
  /** One cent a contract worse than displayed, for the adverse case. */
  adverseCentsPerContract: 0.01,
  z95: 1.96,
} as const;

export type Verdict = 'insufficient_evidence' | 'market_is_better' | 'no_net_edge' | 'survived_holdout_owner_review';

export interface Evaluation {
  resolvedMarkets: number;
  excluded: { ruleChanged: number; noModelProbability: number; noMarketProbability: number; feeUnknown: number; fillNotReproduced: number };
  brier: { model: number | null; market: number | null; pairedDiff: number | null; diffLow: number | null; diffHigh: number | null; pairs: number };
  simulated: {
    trades: number; unfilled: number; contracts: number;
    netDollars: number; netDollarsAdverse: number;
    meanPerTrade: number | null; lowPerTrade: number | null;
    maxDrawdown: number;
    firstHalfNet: number; secondHalfNet: number;
  };
  firstClose: string | null; lastClose: string | null;
  verdict: Verdict;
  sentence: string;
}

const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};
const r6 = (x: number): number => Math.round(x * 1e6) / 1e6;

export function evaluate(rows: ResolvedForecast[]): Evaluation {
  const usable = rows.filter((r) => r.ruleUnchanged);
  const ruleChanged = new Set(rows.filter((r) => !r.ruleUnchanged).map((r) => r.marketTicker)).size;
  const markets = [...new Set(usable.map((r) => r.marketTicker))];
  const byMarket = new Map<string, { close: string; result: 'yes' | 'no'; model?: ResolvedForecast; market?: ResolvedForecast }>();
  for (const r of usable) {
    const m = byMarket.get(r.marketTicker) ?? { close: r.closeTime, result: r.result };
    if (r.model === 'proxy_drift_v1') m.model = r; else m.market = r;
    byMarket.set(r.marketTicker, m);
  }
  const ordered = [...byMarket.entries()].sort((a, b) => a[1].close.localeCompare(b[1].close) || a[0].localeCompare(b[0]));

  // ─── Calibration, paired on the same markets ───────────────────────────────
  const y = (res: 'yes' | 'no'): number => (res === 'yes' ? 1 : 0);
  const modelScores: number[] = []; const marketScores: number[] = []; const diffs: number[] = [];
  let noModelProbability = 0; let noMarketProbability = 0;
  for (const [, m] of ordered) {
    const mp = m.model?.pYes ?? null; const kp = m.market?.pYes ?? null;
    if (m.model && mp === null) noModelProbability++;
    if (m.market && kp === null) noMarketProbability++;
    if (mp !== null) modelScores.push((mp - y(m.result)) ** 2);
    if (kp !== null) marketScores.push((kp - y(m.result)) ** 2);
    if (mp !== null && kp !== null) diffs.push((mp - y(m.result)) ** 2 - (kp - y(m.result)) ** 2);
  }
  const pairedDiff = diffs.length ? mean(diffs) : null;
  const se = diffs.length > 1 ? sd(diffs) / Math.sqrt(diffs.length) : null;

  // ─── The simulated ledger, in close order ──────────────────────────────────
  const pnl: number[] = []; const pnlAdverse: number[] = [];
  let unfilled = 0; let contracts = 0; let feeUnknown = 0; let fillNotReproduced = 0;
  for (const [, m] of ordered) {
    const f = m.model?.fill;
    if (!m.model || m.model.decision === 'skip' || !f) continue;
    if (m.model.fillReproduces === false) { fillNotReproduced++; continue; }
    if (f.filled === 0) { unfilled++; continue; }
    if (f.fee === null) { feeUnknown++; continue; }
    const won = f.side === m.result;
    const net = f.filled * (won ? 1 : 0) - f.cost - f.fee;
    pnl.push(net);
    pnlAdverse.push(net - f.filled * EVALUATION_RULE.adverseCentsPerContract);
    contracts += f.filled;
  }
  let peak = 0; let equity = 0; let maxDrawdown = 0;
  for (const x of pnl) { equity += x; peak = Math.max(peak, equity); maxDrawdown = Math.max(maxDrawdown, peak - equity); }
  const half = Math.floor(pnl.length / 2);
  const sum = (xs: number[]): number => xs.reduce((s, x) => s + x, 0);
  const meanPerTrade = pnlAdverse.length ? mean(pnlAdverse) : null;
  const lowPerTrade = pnlAdverse.length > 1 ? mean(pnlAdverse) - EVALUATION_RULE.z95 * sd(pnlAdverse) / Math.sqrt(pnlAdverse.length) : null;

  const brier = {
    model: modelScores.length ? r6(mean(modelScores)) : null,
    market: marketScores.length ? r6(mean(marketScores)) : null,
    pairedDiff: pairedDiff === null ? null : r6(pairedDiff),
    diffLow: pairedDiff === null || se === null ? null : r6(pairedDiff - EVALUATION_RULE.z95 * se),
    diffHigh: pairedDiff === null || se === null ? null : r6(pairedDiff + EVALUATION_RULE.z95 * se),
    pairs: diffs.length,
  };
  const simulated = {
    trades: pnl.length, unfilled, contracts,
    netDollars: r6(sum(pnl)), netDollarsAdverse: r6(sum(pnlAdverse)),
    meanPerTrade: meanPerTrade === null ? null : r6(meanPerTrade),
    lowPerTrade: lowPerTrade === null ? null : r6(lowPerTrade),
    maxDrawdown: r6(maxDrawdown),
    firstHalfNet: r6(sum(pnlAdverse.slice(0, half))), secondHalfNet: r6(sum(pnlAdverse.slice(half))),
  };

  // ─── The verdict, never stronger than the evidence ─────────────────────────
  let verdict: Verdict; let sentence: string;
  if (markets.length < EVALUATION_RULE.minResolvedMarkets) {
    verdict = 'insufficient_evidence';
    sentence = `${String(markets.length)} of ${String(EVALUATION_RULE.minResolvedMarkets)} resolved markets needed before anything is concluded. Nothing here is a reason to trade.`;
  } else if (brier.diffHigh === null || brier.diffHigh >= 0) {
    verdict = 'market_is_better';
    sentence = 'The model does not forecast better than the market\'s own price, with 95% confidence. Do not trade it.';
  } else if (lowPerTrade === null || lowPerTrade <= 0 || simulated.firstHalfNet <= 0 || simulated.secondHalfNet <= 0) {
    verdict = 'no_net_edge';
    sentence = 'The model forecasts a little better than the market, but after fees and one cent of adverse fill the simulated result is not reliably positive in both halves. Do not trade it.';
  } else {
    verdict = 'survived_holdout_owner_review';
    sentence = 'The model beat the market\'s price and stayed positive after fees and adverse fills in both halves of a sample fixed in advance. This is a simulation; it grants nothing. The next step is the owner\'s review, not an order.';
  }

  return {
    resolvedMarkets: markets.length,
    excluded: { ruleChanged, noModelProbability, noMarketProbability, feeUnknown, fillNotReproduced },
    brier, simulated,
    firstClose: ordered[0]?.[1].close ?? null, lastClose: ordered.at(-1)?.[1].close ?? null,
    verdict, sentence,
  };
}

/** The same evaluation always has the same digest. */
export function evaluationDigest(e: Evaluation): string {
  return createHash('sha256').update(JSON.stringify(e)).digest('hex');
}
