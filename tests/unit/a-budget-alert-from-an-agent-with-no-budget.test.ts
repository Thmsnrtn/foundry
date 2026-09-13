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
// to answer in runway and burn. What was fixed here was every part that made a
// claim; whether the file should be product-shaped throughout was recorded as a
// design question rather than answered by a test — and the file has since been
// deleted, which answers it a third way. See the note in the describe below.
// =============================================================================

const read = (f: string) => stripComments(
  readFileSync(resolve(import.meta.dirname, `../../src/services/scp/agents/${f}`), 'utf8'));

describe('an agent does not alert on a domain it cannot see', () => {
  // TWO CASES HERE READ PRISM, AND PRISM IS GONE. One proved it neither asked
  // the model for `budget_alerts` nor emitted `action_type: 'budget_alert'`;
  // the other proved it stopped promising the founder an analysis of unit
  // economics and runway it had no source for. The agent was reachable only
  // through the Commercial Foundry surface, and `beta_intake` — one of the
  // three sources it was asked to answer product questions over — had no
  // writer left, so the module was deleted.
  //
  // The rule survives in the two cases below: the alert belongs to the agent
  // that has the data for it, and no two agents answer to the same role.

  it('ledger still does, and still has the data for it', () => {
    const src = read('ledger.ts');
    expect(src).toContain("action_type: 'budget_alert'");
    expect(src, 'the grounding is the point — remove it and the alert is Prism again')
      .toContain('cost_events');
  });

  it('no two agents answer to the same role', () => {
    // Compass, Prism and Scribe were on this list and are no longer on disk.
    const roles = ['atlas', 'beacon', 'crucible', 'forge', 'harbor',
      'ledger', 'oracle', 'sentinel', 'shield']
      .map((a) => /getRole\(\): string \{ return '([^']+)'/.exec(read(`${a}.ts`))?.[1]);
    expect(roles.every(Boolean), 'every agent declares a role').toBe(true);
    expect(new Set(roles).size,
      `two agents share a role: ${roles.join(', ')}`).toBe(roles.length);
  });
});
