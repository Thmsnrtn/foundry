// =============================================================================
// Tests: V3.1 Layer A — Briefing markdown integrates destination block
// Verifies the formatBriefingAsMarkdown wire-in for the destination context.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { formatBriefingAsMarkdown } from '../../src/services/scp/briefing.js';
import type { SCPBriefing } from '../../src/services/scp/types.js';

function fixture(): SCPBriefing {
  return {
    id: 'b1',
    product_id: 'p1',
    briefing_date: '2026-05-07',
    signal_score: 72,
    risk_state: 'green',
    health_score: 80,
    headline: 'Trial conversion +18% week over week',
    full_briefing: '',
    agent_contributions: [
      {
        agent_name: 'oracle',
        display_name: 'Oracle',
        role: 'Analytics Lead',
        contribution: 'Conversion improving',
        priority: 'normal',
        pending_decisions_count: 0,
        actions_taken_count: 1,
        session_id: 's1',
      },
    ],
    pending_decisions: [],
    overnight_actions: [],
    financial_summary: null,
    lifecycle_state: 'operating',
    tokens_used: 0,
    cost_usd: 0,
    created_at: new Date().toISOString(),
  };
}

describe('formatBriefingAsMarkdown: destination block', () => {
  it('omits the Destination section when no block is passed', () => {
    const md = formatBriefingAsMarkdown(fixture());
    expect(md).not.toContain('## Destination');
  });

  it('omits the Destination section when block is empty string', () => {
    const md = formatBriefingAsMarkdown(fixture(), '');
    expect(md).not.toContain('## Destination');
  });

  it('includes the Destination section above the first ---', () => {
    const block = 'North Star: Hit $50K MRR by end of 2026.\nProgress: $5K / $50K MRR (10%)';
    const md = formatBriefingAsMarkdown(fixture(), block);
    expect(md).toContain('## Destination');
    expect(md).toContain('North Star:');
    // The Destination block must appear before the Overnight Activity section
    const destIdx = md.indexOf('## Destination');
    const overnightIdx = md.indexOf('## Overnight Activity');
    expect(destIdx).toBeGreaterThan(0);
    expect(overnightIdx).toBeGreaterThan(destIdx);
  });

  it('preserves multi-line block with markdown-friendly line breaks', () => {
    const block = 'Line one\nLine two\nLine three';
    const md = formatBriefingAsMarkdown(fixture(), block);
    expect(md).toContain('Line one  \nLine two  \nLine three');
  });
});
