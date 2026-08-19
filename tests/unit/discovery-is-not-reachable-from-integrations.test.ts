// =============================================================================
// Tests: which door the responsibility ladder actually has.
//
// `discovery.ts` maps four event types straight onto responsibilities —
// `payment_failed` → billing recovery, `churn_detected`, `support_spike`,
// `activation_failure`. Read on its own, that says Foundry notices a company's
// billing and support problems and takes them up.
//
// It does not. `emitSignalEvent` is the ONLY function that runs discovery, and
// it has exactly one caller: the founder-and-company report path. Three of
// those event types appear nowhere else in the repository at all, and
// `payment_failed` appears only in billing and customer-lifecycle code that
// writes its own rows and never reaches the dispatcher. Sixteen places insert
// into `signal_events`; one of them goes through the dispatcher.
//
// The map is kept because the institution's own suite entered through it —
// twenty test files when this was written, which is itself the finding. That is
// being unwound file by file under `check-ladder-fixture-door.mjs`, which may
// only shrink; when it reaches zero the map can go. Sweeping the references
// while deleting something is not how that gets fixed.
//
// So the unreachability is asserted instead. CODE EXISTS IS NOT PRODUCTION
// REACHABLE, and the most convincing form of that mistake is a passing test on
// a path nothing can trigger. This file is the correction: if an integration
// ever does reach discovery, it fails, and the claim gets remade against
// evidence rather than inherited.
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

  it('is not reached by the four event types the map names', () => {
    // If an integration ever emits one of these THROUGH the dispatcher, this
    // fails — and the map stops being a dead branch, which would be good news
    // that should be noticed rather than assumed.
    const emitters = sourceFiles().filter((f) => {
      // The dispatcher DEFINES emitSignalEvent and carries an agent-routing
      // map keyed by event type; naming a type there is not emitting one.
      if (f.endsWith('scp/events/dispatcher.ts')) return false;
      const src = strip(readFileSync(f, 'utf8'));
      if (!/\bemitSignalEvent\s*\(/.test(src)) return false;
      return /payment_failed|churn_detected|support_spike|activation_failure/.test(src);
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

  it('says so where the map is written, rather than leaving it to be inferred', () => {
    const src = readFileSync('src/services/institution/discovery.ts', 'utf8');
    expect(src).toContain('NOTHING IN PRODUCTION CAN TRIGGER THESE FOUR');
  });
});
