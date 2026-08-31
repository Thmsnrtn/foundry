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
      if (f.endsWith('scp/events/dispatcher.ts')) return false;   // defines it
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
      // The dispatcher carries an agent-routing map keyed by event type;
      // naming a type there is not emitting one.
      if (f.endsWith('scp/events/dispatcher.ts')) return false;
      const body = strip(readFileSync(f, 'utf8'));
      if (!/\bemitSignalEvent\s*\(/.test(body)) return false;
      return /payment_failed|churn_detected|support_spike|activation_failure/.test(body);
    });
    expect(emitters,
      `these now reach discovery with a SaaS event type: ${emitters.join(', ')}`)
      .toEqual([]);
  });

  it('selects no agent either, because the agent map is keyed the same way', () => {
    // THE SAME DEFECT ONE LAYER UP, found while moving the fixtures.
    //
    // `EVENT_AGENT_MAP` in the dispatcher routes ten event types to the named
    // agents, and `dynamic-agent-reachability.test.ts` classified nine agents
    // `production-reachable` BECAUSE that map selects them. It cannot. The map
    // is read only by `emitSignalEvent`, whose one caller emits
    // `founder_reported:<kind>` and `external_company_reported:<kind>` —
    // neither of which is a key. So `relevant_agents_json` is always `[]` in
    // production and no agent has ever been selected by an event.
    //
    // The agent map is NOT deleted with the discovery map, and the difference
    // matters: deleting the discovery map removed a contract that made the
    // institution look like it noticed things it did not. `EVENT_AGENT_MAP` is
    // wiring for a routing layer whose retirement is a separate, blocked
    // decision — see the named-agent entry in the live frontier. Unreachable is
    // a reason to assert, not always a reason to delete.
    //
    // Those nine agents ARE reachable, by the roster route and by
    // `agent_instances` scheduling, which load any name on demand. The
    // conclusion survived; the reason did not, and a reachability inventory
    // holding a false reason is exactly the thing it exists to prevent.
    const dispatcher = readFileSync('src/services/scp/events/dispatcher.ts', 'utf8');
    const mapBody = /EVENT_AGENT_MAP[^{]*\{([\s\S]*?)\n\};/.exec(dispatcher);
    expect(mapBody, 'EVENT_AGENT_MAP is no longer parseable — this test is stale')
      .not.toBeNull();
    const routed = [...mapBody![1].matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]);
    expect(routed.length, 'expected the ten routed event types').toBe(10);

    const emitters = sourceFiles().filter((f) => {
      if (f.endsWith('scp/events/dispatcher.ts')) return false;
      const src = strip(readFileSync(f, 'utf8'));
      if (!/\bemitSignalEvent\s*\(/.test(src)) return false;
      return routed.some((event) => new RegExp(`['\`"]${event}['\`"]`).test(src));
    });
    expect(emitters,
      `these now emit an agent-routed event type through the dispatcher: ${emitters.join(', ')}`)
      .toEqual([]);
  });

  it('leaves the agent-run branch with no producer, and says so where it is', () => {
    // The other half of the same fact. `processSignalEvent` DOES run in
    // production — a scheduled job and a dashboard route both drain pending
    // signals — and what it reads is `relevant_agents_json`. Only
    // `emitSignalEvent` ever writes that column; the fifteen other inserts into
    // `signal_events` do not mention it, so it arrives NULL and is read as `[]`.
    //
    // With the test above (nothing emits a routed event type) that pins the
    // branch: every call takes the empty-list early return, and the ~100 lines
    // after it have never executed. If a second writer of the column appears,
    // this fails — which is the moment to check whether an agent is now being
    // run by an event, deliberately or otherwise.
    const writers = sourceFiles().filter((f) => {
      if (f.endsWith('scp/events/dispatcher.ts')) return false;  // the one writer
      return /relevant_agents_json/.test(strip(readFileSync(f, 'utf8')));
    });
    expect(writers.filter((f) => /INSERT\s+INTO\s+signal_events|UPDATE\s+signal_events/i
      .test(strip(readFileSync(f, 'utf8')))),
    `these now write relevant_agents_json: ${writers.join(', ')}`).toEqual([]);

    const dispatcher = readFileSync('src/services/scp/events/dispatcher.ts', 'utf8');
    expect(dispatcher).toContain('NO AGENT HAS EVER BEEN');
  });

  it('says at the intake why there is only one, rather than leaving it inferred', () => {
    const src = readFileSync('src/services/institution/discovery.ts', 'utf8');
    expect(src).toContain('THE FOUR SAAS EVENT TYPES ARE GONE');
  });
});
