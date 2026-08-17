import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_AGENTS, isLoadableAgentName } from '../../src/services/scp/types.js';

// =============================================================================
// The dynamic-loader blind spot.
//
// The static reachability gate resolves literal relative imports. Three places
// load an agent with `` import(`.../${name}.js`) ``, so that gate sees the whole
// agent family as unreachable while it is live — an orphan report built on it
// confidently named ~160KB of running code as dead, and deleting it would have
// been a production outage.
//
// The fix is not to exempt the directory. It is to make the ACTUAL architecture
// checkable: names come from a closed vocabulary, and the vocabulary and the
// modules on disk must agree in both directions.
//
//   registry entry  →  an implementation that exists
//   implementation  →  a dispatcher that can select it, or an explicit status
//
// "It exists in the directory" is not a classification.
// =============================================================================

const AGENTS_DIR = resolve(__dirname, '../../src/services/scp/agents');
const modules = readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.ts')).map((f) => f.replace(/\.ts$/, ''));

/**
 * Every dynamically loadable module, classified. Exactly one status each, and
 * a reason that names real evidence.
 *
 * Retirement of the named-agent architecture in favour of institutional
 * responsibility is the confirmed direction, so most of these are retirement
 * candidates. A candidate is not a corpse: none may be deleted until its class
 * says so on evidence.
 */
const CLASSIFICATION: Record<string, { status: string; why: string }> = {
  // Selected by EVENT_AGENT_MAP in the signal dispatcher, and by the agents
  // dashboard route. Live.
  atlas: { status: 'production-reachable', why: 'selected by EVENT_AGENT_MAP for activation_failure and performance_degradation' },
  beacon: { status: 'production-reachable', why: 'selected by EVENT_AGENT_MAP for competitor_signal' },
  compass: { status: 'production-reachable', why: 'selected by EVENT_AGENT_MAP for revenue_milestone, competitor_signal, experiment_result' },
  forge: { status: 'production-reachable', why: 'selected by EVENT_AGENT_MAP for churn_detected, expansion_signal, revenue_milestone, payment_failed' },
  harbor: { status: 'production-reachable', why: 'selected by EVENT_AGENT_MAP for churn, expansion, nps_drop, activation_failure, support_spike' },
  ledger: { status: 'production-reachable', why: 'selected by EVENT_AGENT_MAP for revenue_milestone and payment_failed' },
  oracle: { status: 'production-reachable', why: 'selected by EVENT_AGENT_MAP for churn_detected, nps_drop, experiment_result' },
  prism: { status: 'production-reachable', why: 'selected by EVENT_AGENT_MAP for nps_drop, activation_failure, support_spike' },
  sentinel: { status: 'production-reachable', why: 'selected by EVENT_AGENT_MAP for support_spike and performance_degradation' },

  // In the vocabulary and loadable on demand by the dashboard route and by
  // agent_instances scheduling, but no event map entry selects them.
  scribe: { status: 'production-reachable', why: 'no event selects it, but the roster route and agent_instances scheduling both load it by name' },
  shield: { status: 'production-reachable', why: 'no event selects it, but the roster route and agent_instances scheduling both load it by name' },
  crucible: { status: 'production-reachable', why: 'no event selects it, but the roster route and agent_instances scheduling both load it by name' },

  // Not a loadable agent — the shared base class every agent extends. It is
  // reached by ordinary static import from the agents themselves.
  base: { status: 'compatibility-retained', why: 'shared base class extended by every agent module; never loaded by name' },

  // Present on disk, absent from the vocabulary. The loaders now refuse them,
  // so they cannot run — but they are not proven dead either, because nothing
  // has established whether they were removed deliberately or dropped.
  challenger: { status: 'evidence-insufficient', why: 'outside ALL_AGENTS so no loader can select it; whether it was retired deliberately is unestablished' },
  synthesizer: { status: 'evidence-insufficient', why: 'outside ALL_AGENTS so no loader can select it; whether it was retired deliberately is unestablished' },
};

const VALID_STATUSES = [
  'production-reachable', 'compatibility-retained',
  'migration-in-progress', 'owner-deferred', 'proven-dead', 'evidence-insufficient',
];

describe('dynamic agent reachability', () => {
  it('classifies every dynamically loadable module, exactly once and in both directions', () => {
    const unclassified = modules.filter((m) => !(m in CLASSIFICATION));
    expect(unclassified,
      'A module can be loaded by name with no recorded status. "It exists in the directory" '
      + 'is not a classification:\n' + unclassified.join('\n')).toEqual([]);

    const phantom = Object.keys(CLASSIFICATION).filter((m) => !modules.includes(m));
    expect(phantom,
      `Classified modules that no longer exist:\n${phantom.join('\n')}`).toEqual([]);

    for (const [name, { status, why }] of Object.entries(CLASSIFICATION)) {
      expect(VALID_STATUSES, `${name} has an unknown status`).toContain(status);
      expect(why.length, `${name} needs a reason naming real evidence`).toBeGreaterThan(30);
    }
  });

  it('every registry entry resolves to an implementation that exists', () => {
    // The failure this catches: a vocabulary naming an agent with no module.
    // The loader would throw at import time, in production, for whichever
    // event happened to select it.
    const missing = ALL_AGENTS.filter((name) => !modules.includes(name));
    expect(missing,
      `ALL_AGENTS names agents with no module on disk:\n${missing.join('\n')}`).toEqual([]);
  });

  it('every event-map name is in the closed vocabulary', () => {
    // The dispatcher's map is the main selector. A typo there would be a name
    // that can never load, silently, for exactly one event type.
    const source = readFileSync(
      resolve(__dirname, '../../src/services/scp/events/dispatcher.ts'), 'utf8');
    const map = source.slice(source.indexOf('EVENT_AGENT_MAP'), source.indexOf('emitSignalEvent'));
    const names = [...map.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(10);
    const unknown = [...new Set(names)].filter((n) => !isLoadableAgentName(n));
    expect(unknown,
      `EVENT_AGENT_MAP selects names outside the vocabulary:\n${unknown.join('\n')}`).toEqual([]);
  });

  it('refuses a name that is not in the vocabulary, however it arrives', () => {
    // The hardening this locks in: a module specifier resolves paths, so an
    // unvalidated stored string is a directory traversal rather than a missing
    // agent. Two of the three loaders previously passed a database value
    // straight through.
    expect(isLoadableAgentName('harbor')).toBe(true);
    for (const hostile of [
      '../../../etc/passwd', '../institution/responsibility', './base',
      'Atlas', 'HARBOR', '', 'harbor.js', 'harbor/../base', null, undefined, 42, {},
    ]) {
      expect(isLoadableAgentName(hostile), `${String(hostile)} must not be loadable`).toBe(false);
    }
  });

  it('every loader narrows through the vocabulary before importing', () => {
    // Structural, so a fourth loader added later cannot skip the check.
    const loaders = [
      'src/services/scp/events/dispatcher.ts',
      'src/services/scp/instance.ts',
      'src/routes/dashboard/agents.ts',
    ];
    for (const rel of loaders) {
      const source = readFileSync(resolve(__dirname, '../..', rel), 'utf8');
      expect(source, `${rel} imports an agent by name without validating it`)
        .toMatch(/isLoadableAgentName|isValidAgentName/);
    }
  });

  it('finds no dynamic agent import outside the known loaders', () => {
    // If a new site starts loading agents by name, it must be classified and
    // hardened like the others rather than inheriting nothing.
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = resolve(dir, e.name);
      return e.isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });
    const sites = walk(resolve(__dirname, '../../src'))
      .filter((f) => /import\s*\(\s*`[^`]*agents\/\$\{/.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(resolve(__dirname, '../..') + '/', ''));
    expect(sites.sort()).toEqual([
      'src/routes/dashboard/agents.ts',
      'src/services/scp/events/dispatcher.ts',
      'src/services/scp/instance.ts',
    ]);
  });
});
