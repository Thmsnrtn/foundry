import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';

// =============================================================================
// A CRITICAL BUDGET ALERT FROM AN AGENT THAT CANNOT SEE A BUDGET.
//
// Prism asked its model for `budget_alerts` and queued every 'critical' one as
// a `budget_alert` outbound action at authority level 1, reading "CRITICAL
// budget alert [category]: message". The model producing them is told it is the
// Chief Product Officer and asked whether the product is getting closer to what
// customers want, over `audit_scores`, `beta_intake` and `metric_snapshots` —
// three sources with no cost, no burn and no budget in them.
//
// Ledger reads `cost_events` and `revenue_attributions` and already emits
// `budget_alert` from them. The domain was not missing a watcher; it had two,
// one of them blind.
//
// Prism was four jobs at once: rostered as UX, headed CFO, returning 'CFO' from
// getRole() as Ledger also did, prompted as Chief Product Officer, and required
// to answer in runway and burn. What is fixed here is every part that made a
// claim; whether the file should be product-shaped throughout is recorded as a
// design question, not answered by a test.
// =============================================================================

const read = (f: string) => stripComments(
  readFileSync(resolve(import.meta.dirname, `../../src/services/scp/agents/${f}`), 'utf8'));

describe('an agent does not alert on a domain it cannot see', () => {
  it('prism neither asks for nor emits budget alerts', () => {
    const src = read('prism.ts');
    expect(src.includes('budget_alerts'),
      'the field only gave the model somewhere to put an invention').toBe(false);
    expect(src.includes("action_type: 'budget_alert'"),
      'prism has no cost, burn or budget source to ground this').toBe(false);
  });

  it('ledger still does, and still has the data for it', () => {
    const src = read('ledger.ts');
    expect(src).toContain("action_type: 'budget_alert'");
    expect(src, 'the grounding is the point — remove it and the alert is Prism again')
      .toContain('cost_events');
  });

  it('no two agents answer to the same role', () => {
    const roles = ['atlas', 'beacon', 'compass', 'crucible', 'forge', 'harbor',
      'ledger', 'oracle', 'prism', 'scribe', 'sentinel', 'shield']
      .map((a) => /getRole\(\): string \{ return '([^']+)'/.exec(read(`${a}.ts`))?.[1]);
    expect(roles.every(Boolean), 'every agent declares a role').toBe(true);
    expect(new Set(roles).size,
      `two agents share a role: ${roles.join(', ')}`).toBe(roles.length);
  });

  it('does not promise the founder an analysis it cannot perform', () => {
    const src = read('prism.ts');
    expect(/Prism will analy[sz]e unit economics and runway/.test(src),
      'its three sources contain no unit economics and no runway').toBe(false);
  });
});
