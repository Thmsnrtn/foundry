// =============================================================================
// Tests: which door the responsibility ladder actually has.
//
// `discovery.ts` used to map four event types straight onto responsibilities —
// `payment_failed` → billing recovery, `churn_detected`, `support_spike`,
// `activation_failure`. Read on its own, that said Foundry notices a company's
// billing and support problems and takes them up.
//
// It did not. `emitSignalEvent` is the ONLY function that runs discovery, and it
// has exactly one caller: the founder-and-company report path. Sixteen places
// insert into `signal_events`; one of them goes through the dispatcher.
//
// The map survived a deletion because twenty test files built their ladder state
// through it — the institution's own suite entering through a door the running
// system does not have. Those were moved onto the real intake one at a time
// under a ratchet, and the map is now gone. What this file holds is the shape of
// the finding, so it cannot come back unnoticed:
//
//   • the one caller stays one caller;
//   • no second, domain-shaped contract reappears beside the generic one;
//   • the SAME defect one layer up — `EVENT_AGENT_MAP` routes ten event types to
//     the named agents and nothing emits any of them either — stays asserted
//     rather than believed.
//
// CODE EXISTS IS NOT PRODUCTION REACHABLE, and the most convincing form of that
// mistake is a passing test on a path nothing can trigger.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function sourceFiles(dir = 'src', out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const strip = (src: string): string => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');

describe('the only door into responsibility discovery', () => {
  it('is opened by exactly one caller, and that caller is the company reporting', () => {
    const callers = sourceFiles().filter((f) => {
      // `emitSignalEvent` moved here from `scp/events/dispatcher.ts` when the
      // dispatcher was deleted in Roadmap 2027 R9.
      if (f.endsWith('institution/signals.ts')) return false;   // defines it
      return /\bemitSignalEvent\s*\(/.test(strip(readFileSync(f, 'utf8')));
    });
    expect(callers, `emitSignalEvent is called from ${callers.join(', ')}`)
      .toEqual(['src/services/founder/company-report.ts']);
  });

  it('admits nothing through a second, domain-shaped contract', () => {
    // The deleted map is the shape this guards against, not the specific four
    // names: a second `Record<eventType, {title, capability}>` beside the
    // generic one, which recognises a marina only when its reality happens to
    // fit a software company's words. Discovery has one contract, and the
    // company states which kind applies.
    const src = strip(readFileSync('src/services/institution/discovery.ts', 'utf8'));
    const contracts = [...src.matchAll(/^ {2}([a-z_]+): \{ title:/gm)].map((m) => m[1]);
    expect(contracts,
      `discovery admits ${contracts.join(', ')} without the company naming a kind`)
      .toEqual([]);

    // And the four are not emitted through the dispatcher by anything, which is
    // what made the map dead in the first place. If that ever changes it is
    // news, and it should be noticed rather than assumed.
    const emitters = sourceFiles().filter((f) => {
      // The definition is not a call (it lived in `scp/events/dispatcher.ts`
      // until Roadmap 2027 R9).
      if (f.endsWith('institution/signals.ts')) return false;
      const body = strip(readFileSync(f, 'utf8'));
      if (!/\bemitSignalEvent\s*\(/.test(body)) return false;
      return /payment_failed|churn_detected|support_spike|activation_failure/.test(body);
    });
    expect(emitters,
      `these now reach discovery with a SaaS event type: ${emitters.join(', ')}`)
      .toEqual([]);
  });

  // The two cases on `EVENT_AGENT_MAP` and the agent-run branch went with
  // `scp/events/dispatcher.ts` and the agents in Roadmap 2027 R9: the signal
  // door no longer routes to anything.

  it('says at the intake why there is only one, rather than leaving it inferred', () => {
    const src = readFileSync('src/services/institution/discovery.ts', 'utf8');
    expect(src).toContain('THE FOUR SAAS EVENT TYPES ARE GONE');
  });
});
