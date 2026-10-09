// =============================================================================
// THE HELD-OUT PANEL, ASKED OF A REAL MODEL — the caller judges.ts said was
// missing ("Run by hand: … and a caller"). FQ, 9 October 2026.
//
// BY DEFAULT IT CALLS NOTHING: it prints the plan — how many judgements, the
// estimated cost by planARealRun's own arithmetic at the model's published
// prices — and exits. Only `--go`, with PANEL_REAL=1, a ceiling in
// PANEL_MAX_USD (at most the $25 hard cap) and OPENROUTER_API_KEY, makes calls,
// and planARealRun refuses before the first one when the estimate is over the
// ceiling.
//
//   npx tsx tests/simulation/panel/run-real-panel.mts                     # the plan, no call
//   PANEL_REAL=1 PANEL_MAX_USD=3 OPENROUTER_API_KEY=… \
//     npx tsx tests/simulation/panel/run-real-panel.mts --go --out /tmp/panel-real.json
//
// Prices: Sonnet at $2 / $10 per million input / output tokens, the repository's
// own table (services/ai/client.ts COST_PER_1M, read 2026-10-05). PANEL_MODEL
// chooses another model; pass its prices with --in and --out-price.
// =============================================================================
import { writeFileSync } from 'node:fs';
import { PANEL_HARD_CAP_USD, judgeTheHeldOutPanelForReal, planARealRun } from './judges.js';

const arg = (name: string): string | undefined => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const prices = { inputUsdPerMTok: Number(arg('--in') ?? 2), outputUsdPerMTok: Number(arg('--out-price') ?? 10) };

if (!process.argv.includes('--go')) {
  const plan = planARealRun({ env: { PANEL_REAL: '1', PANEL_MAX_USD: String(PANEL_HARD_CAP_USD) }, ...prices });
  process.stdout.write(`${JSON.stringify({ mode: 'plan only — nothing was called', model: process.env.PANEL_MODEL ?? 'anthropic/claude-sonnet-5', prices, calls: plan.calls,
    estimateUsd: Number(plan.estimateUsd.toFixed(4)), hardCapUsd: PANEL_HARD_CAP_USD,
    toRun: 'PANEL_REAL=1 PANEL_MAX_USD=<ceiling> OPENROUTER_API_KEY=… npx tsx tests/simulation/panel/run-real-panel.mts --go --out <file>' }, null, 1)}\n`);
  process.exit(0);
}
const run = await judgeTheHeldOutPanelForReal(process.env, prices);
const out = arg('--out');
if (out) writeFileSync(out, JSON.stringify(run, null, 1));
process.stdout.write(`${JSON.stringify(run, null, 1)}\n`);
