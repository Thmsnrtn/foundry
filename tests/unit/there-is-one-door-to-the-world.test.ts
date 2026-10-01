import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JOB_REGISTRY, RETIRED_LOOPS, retiredLoopRefusal } from '../../src/jobs/index.js';

// =============================================================================
// THERE IS ONE DOOR TO THE WORLD (Roadmap 2027 R10, 1 October 2026; PENDING 16,
// "Retire them", which named the agents AND the legacy executors).
//
// R9 retired the agents and one of their two execute paths. The other,
// `scp/actions/executor.ts`, stayed because four "department" sweeps used it:
// customer success, outreach, product evolution and marketing. In this
// deployment none of them could ever find work. They loop over earned products
// only, need SaaS customers or champions there are none of, run at `shadow`,
// and their acting branch is capped at `suggest`; their drafts pointed at a
// page that no longer exists. And the executor was the last code that reached
// a provider around the gateway: Linear by raw `fetch`, and arbitrary webhooks.
//
// Now everything that reaches the world goes through the gateway, and the five
// jobs that fed the old path are refused by name.
// =============================================================================

const ROOT = resolve(import.meta.dirname, '../..');
const SRC = join(ROOT, 'src');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? tsFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

const RETIRED = ['customer_success_sweep', 'marketing_sweep', 'product_evolution_sweep', 'outreach_sweep', 'action_verify_sweep'];

describe('the legacy execute path is gone', () => {
  it('has no executor and no departments that fed it', () => {
    for (const gone of [
      'src/services/scp/actions/executor.ts', 'src/services/departments', 'src/services/outbound/action-verifier.ts',
    ]) expect(existsSync(join(ROOT, gone)), gone).toBe(false);
    const left = readdirSync(join(SRC, 'services/scp'), { recursive: true }).map(String).filter((f) => f.endsWith('.ts')).sort();
    expect(left).toEqual(['forecasting/runway.ts', 'types.ts']);
  });

  it('writes to Linear nowhere: the only path that did went around the gateway', () => {
    // Every Linear request is a GraphQL POST, reads included, so the test is
    // what the request asks for: a file that talks to Linear sends no mutation.
    const linear = tsFiles(SRC).filter((f) => readFileSync(f, 'utf8').includes('api.linear.app'));
    expect(linear.map((f) => f.slice(SRC.length + 1))).toEqual(['services/integrations/linear.ts']);
    const code = (f: string): string => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const file of linear) expect(code(file), file).not.toMatch(/\bmutation\b\s*[\w(]|\bissueCreate\s*\(/);
  });

  it('creates no execution row anywhere: nothing is left to carry one out', () => {
    for (const file of tsFiles(SRC)) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/INSERT\s+INTO\s+action_executions/i);
    }
  });
});

describe('the jobs that fed it are refused by name', () => {
  it('schedules none of them, and answers each with what it did', () => {
    for (const name of RETIRED) {
      expect(JOB_REGISTRY, name).not.toHaveProperty(name);
      expect(RETIRED_LOOPS, name).toHaveProperty(name);
      expect(retiredLoopRefusal(name)).toContain(RETIRED_LOOPS[name]!);
    }
  });
});
