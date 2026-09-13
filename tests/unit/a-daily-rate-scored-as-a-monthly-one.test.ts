import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';

// =============================================================================
// A DAILY RATE SCORED AGAINST A MONTHLY THRESHOLD.
//
// Three more consumers took the two most recent `metric_snapshots`, divided
// them, and treated the result as a monthly figure. The table is keyed by DATE
// and most companies report daily.
//
//   `fundraising-readiness`  scores growth against 15%/month and prints
//                            "growth: X%/mo" in an investor-readiness
//                            assessment — so a company growing 0.5% a day
//                            (about 16% a month) scored zero of two points.
//   `briefing.ts`            reports `mrr_growth_pct` to the founder as the
//                            company's growth.
//   `briefing/compressed.ts` named the older row `lastWeekMetrics` and built
//                            every delta in the compressed briefing from it.
//
// TWO OF THE THREE CONSUMERS ARE GONE. `scp/investor/fundraising-readiness.ts`
// was deleted as production-dead, and with it the three cases that drove a real
// assessment and read the rate back out of the prompt. `voice/briefing.ts` is
// still here but the daily-rate case for it never lived in this file. The
// compressed briefing is what is left, and it is held by its source rather than
// by a run, because nothing reachable calls it with two snapshots any more.
//
// The second `it` below arrived from `a-fundraising-verdict-about-nothing`,
// which was deleted whole with `investor/board_packet.ts`. Its subject is the
// same file and a neighbouring rule — a recorded zero is a report, not an
// absence — so it is kept here rather than lost with the module it was filed
// under.
// =============================================================================

describe('the compressed briefing', () => {
  it('does not call the previous snapshot last week', () => {
    const src = stripComments(readFileSync('src/services/scp/briefing/compressed.ts', 'utf8'));
    expect(src).not.toContain('lastWeekMetrics');
    expect(src).toContain('over_days');
  });

  it('does not report a recorded zero as unmeasured', () => {
    const src = stripComments(
      readFileSync('src/services/scp/briefing/compressed.ts', 'utf8'), { lineComments: true });
    expect(src, 'truthiness reported a pre-revenue company as unmeasured')
      .not.toMatch(/mrr_cents\s*\n?\s*\?\s*`\$/);
    expect(src).toMatch(/mrr_cents != null/);
  });
});
