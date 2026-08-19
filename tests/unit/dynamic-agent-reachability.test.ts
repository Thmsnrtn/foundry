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
const SRC = resolve(__dirname, '../../src');

function walkSrc(dir: string = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? walkSrc(path) : path.endsWith('.ts') ? [path] : [];
  });
}
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
  // THESE NINE WERE CLASSIFIED ON A REASON THAT DOES NOT HOLD.
  //
  // Each said `selected by EVENT_AGENT_MAP for <event types>`. The map exists
  // and names them, but nothing in production emits any of its ten keys through
  // `emitSignalEvent` — the only function that reads it — whose one caller emits
  // `founder_reported:<kind>` and `external_company_reported:<kind>`. So
  // `relevant_agents_json` is always empty and no agent has ever been selected
  // by an event. `discovery-is-not-reachable-from-integrations.test.ts` asserts
  // that, derived from the map rather than listed here.
  //
  // The conclusion survives on OTHER evidence: the roster route's
  // `POST /agents/:name/run` and `agent_instances` scheduling both load any
  // vocabulary name on demand, and that is a live path a founder can take.
  // Every one of these twelve is reachable the same way, which is why they now
  // carry the same reason — an inventory whose entries differ only in a
  // justification that turned out to be false was telling itself a story about
  // an event pipeline it does not have.
  atlas: { status: 'production-reachable', why: 'roster route POST /agents/:name/run and agent_instances scheduling both load it by name; no event selects it' },
  beacon: { status: 'production-reachable', why: 'roster route POST /agents/:name/run and agent_instances scheduling both load it by name; no event selects it' },
  compass: { status: 'production-reachable', why: 'roster route POST /agents/:name/run and agent_instances scheduling both load it by name; no event selects it' },
  forge: { status: 'production-reachable', why: 'roster route POST /agents/:name/run and agent_instances scheduling both load it by name; no event selects it' },
  harbor: { status: 'production-reachable', why: 'roster route POST /agents/:name/run and agent_instances scheduling both load it by name; no event selects it' },
  ledger: { status: 'production-reachable', why: 'roster route POST /agents/:name/run and agent_instances scheduling both load it by name; no event selects it' },
  oracle: { status: 'production-reachable', why: 'roster route POST /agents/:name/run and agent_instances scheduling both load it by name; no event selects it' },
  prism: { status: 'production-reachable', why: 'roster route POST /agents/:name/run and agent_instances scheduling both load it by name; no event selects it' },
  sentinel: { status: 'production-reachable', why: 'roster route POST /agents/:name/run and agent_instances scheduling both load it by name; no event selects it' },
  scribe: { status: 'production-reachable', why: 'roster route POST /agents/:name/run and agent_instances scheduling both load it by name; no event selects it' },
  shield: { status: 'production-reachable', why: 'roster route POST /agents/:name/run and agent_instances scheduling both load it by name; no event selects it' },
  crucible: { status: 'production-reachable', why: 'roster route POST /agents/:name/run and agent_instances scheduling both load it by name; no event selects it' },

  // Not a loadable agent — the shared base class every agent extends. It is
  // reached by ordinary static import from the agents themselves.
  base: { status: 'compatibility-retained', why: 'shared base class extended by every agent module; never loaded by name' },

  // NOT agents, despite living here. Both say so in their own first lines:
  // "NOT a BaseAgent subclass — runs on demand during debate orchestration."
  // They export standalone functions with no `run(productId)`, so no loader
  // could instantiate them even if the vocabulary named them — and the debate
  // orchestrator reaches both by ordinary static import, from the scheduler and
  // from a dashboard route.
  //
  // They were first classified `evidence-insufficient` on the reasoning "outside
  // ALL_AGENTS, so no loader can select it". That was true and irrelevant: it
  // inferred deadness from the DIRECTORY rather than from reachability, which is
  // the same category error the orphan report made when it named live
  // dynamically-loaded code as dead. Being in `agents/` is not what makes
  // something an agent.
  challenger: { status: 'production-reachable', why: 'standalone debate function, statically imported by debate/orchestrator.ts which the scheduler and a dashboard route both call' },
  synthesizer: { status: 'production-reachable', why: 'standalone debate function, statically imported by debate/orchestrator.ts which the scheduler and a dashboard route both call' },
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

  it('distinguishes "loadable by name" from "reachable at all"', () => {
    // The error this prevents. Two modules in `agents/` are not agents: they
    // export standalone debate functions with no `run(productId)`, and they are
    // reached by ordinary static import. Classifying them from the directory
    // rather than from reachability produced a wrong `evidence-insufficient`
    // verdict that would have justified deleting live code.
    //
    // A module in this directory is an AGENT only if the vocabulary names it.
    // Everything else here must be reachable some other way, or it really is
    // dead — and the difference has to be checked, not assumed.
    const notAgents = modules.filter((m) => !isLoadableAgentName(m) && m !== 'base');
    expect(notAgents.sort()).toEqual(['challenger', 'synthesizer']);

    for (const m of notAgents) {
      const source = readFileSync(resolve(AGENTS_DIR, `${m}.ts`), 'utf8');
      // No runnable export, so no loader could use it even if named.
      expect(source, `${m} must not look like a loadable agent`).not.toMatch(/\brun\s*\(\s*productId/);
      // And something outside this directory must actually import it.
      const importers = walkSrc()
        .filter((f) => !f.includes('/agents/'))
        .filter((f) => new RegExp(`agents/${m}\\.js`).test(readFileSync(f, 'utf8')));
      expect(importers, `${m} is classified production-reachable but nothing imports it`).not.toEqual([]);
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
