import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// =============================================================================
// Institutional reachability gate.
//
// The constitution says no orphan abstractions, and that every subsystem must
// pay rent. Both were being broken silently: an audit found that deterministic
// institutional judgment, its later-reality evaluation, and the owner
// disposition loop had no production writer at all — machinery, a founder
// surface, and a benchmark, exercised only by their own tests.
//
// That defect was found by hand. This gate finds it automatically. Every module
// under src/services/institution must be reachable from a real production entry
// point, or be declared DARK with an honest reason.
//
// The list is enforced EXACTLY in both directions, like the architectural
// ratchets: a newly orphaned module fails, and a module that has since been
// wired fails until it is removed from the list. Darkness can only be recorded
// deliberately, and it can only be paid down — never quietly accumulated.
//
// What this gate does NOT prove, stated plainly so its passing is not read as
// more than it is: reachability is measured per module, not per behaviour. A
// module counts as reachable when production imports it at all — including
// when a founder surface imports it only to READ. Several institution modules
// are reachable in exactly that way while their write paths remain undriven,
// so this gate cannot tell you the ladder is being climbed in production. That
// is tracked as proof debt in IMPLEMENTATION_STATE, not here.
// =============================================================================

const ROOT = resolve(__dirname, '../..');

// Real production entry points. Routes, middleware, and services are reachable
// from the server; jobs from the scheduler; the CLI is an operator surface.
const ENTRY_POINTS = ['src/index.ts', 'src/jobs/index.ts', 'src/cli/index.ts'];

/**
 * Modules with no production path, each with the reason it is honest for them
 * to have none. A reason like "for later" is not honest — that is speculative
 * architecture, and the answer is deletion until the consumer exists.
 */
const DARK: Record<string, string> = {
  // Benchmarks are gates. Being exercised only by the test suite is what they
  // are for; a production caller would make the gate part of the thing it
  // measures.
  'development-benchmark.ts': 'frozen gate — exercised by its benchmark test by design',
  'institutional-judgment-benchmark.ts': 'frozen gate — exercised by its benchmark test by design',
  'production-reachability-benchmark.ts': 'frozen gate — exercised by its benchmark test by design',
  'reconstruction-benchmark.ts': 'frozen gate — exercised by its benchmark test by design',
  'responsibility-assisting-benchmark.ts': 'frozen gate — exercised by its benchmark test by design',
  'responsibility-recognition-benchmark.ts': 'frozen gate — exercised by its benchmark test by design',
  'responsibility-shadowing-benchmark.ts': 'frozen gate — exercised by its benchmark test by design',
  'responsibility-understanding-benchmark.ts': 'frozen gate — exercised by its benchmark test by design',

  // Understanding left this list when migration 125 gave the founder a way to
  // supply the facts no connected system observes. Shadowing has not: it needs
  // an independent observer of the same reality, and for a customer's company
  // that supply does not exist yet. Wiring a driver now would mean inventing
  // the evidence, which is the one thing the evidence ladder forbids.
  'development-observation.ts': 'blocked — development responsibilities are not discovered in production',
  'development-shadowing.ts': 'blocked — development responsibilities are not discovered in production',
};

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = resolve(dir, entry);
    return statSync(path).isDirectory() ? tsFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

/** Static `from '...'` and dynamic `import('...')` alike — the institution is
 * reached almost entirely through dynamic imports, so a static-only graph
 * would report the whole subsystem as dark and prove nothing. */
function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const out: string[] = [];
  const re = /(?:from\s*|import\s*\(\s*)['"](\.[^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const target = resolve(dirname(file), m[1].replace(/\.js$/, '.ts'));
    out.push(target);
  }
  return out;
}

function reachable(): Set<string> {
  const seen = new Set<string>();
  const queue = ENTRY_POINTS.map((e) => resolve(ROOT, e));
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    let exists = false;
    try { exists = statSync(file).isFile(); } catch { exists = false; }
    if (!exists) continue;
    seen.add(file);
    queue.push(...importsOf(file));
  }
  return seen;
}

describe('institutional reachability', () => {
  it('every institution module is production-reachable or declared dark, exactly', () => {
    const live = reachable();
    const modules = tsFiles(resolve(ROOT, 'src/services/institution'))
      .map((f) => relative(resolve(ROOT, 'src/services/institution'), f));

    const orphans = modules.filter((m) =>
      !live.has(resolve(ROOT, 'src/services/institution', m)) && !(m in DARK));
    const wired = Object.keys(DARK).filter((m) =>
      live.has(resolve(ROOT, 'src/services/institution', m)));
    const missing = Object.keys(DARK).filter((m) => !modules.includes(m));

    expect(orphans,
      'Institution modules with no production path and no declared reason. ' +
      'Wire it to something real, or delete it — "for later" is speculative architecture:\n' +
      orphans.join('\n')).toEqual([]);
    expect(wired,
      'These are declared dark but are now production-reachable. Good news: ' +
      'remove them from DARK in this commit so the darkness can only shrink:\n' +
      wired.join('\n')).toEqual([]);
    expect(missing,
      `DARK names modules that no longer exist:\n${missing.join('\n')}`).toEqual([]);
  });

  it('the reasons are load-bearing, not decoration', () => {
    // A reason that says "later" is exactly the speculative architecture the
    // constitution forbids. Every entry must name a real blocker or a real
    // design intent.
    for (const [module, reason] of Object.entries(DARK)) {
      expect(reason.length, `${module} needs a real reason`).toBeGreaterThan(20);
      expect(reason, `${module}: "for later" is not a reason to keep an orphan`)
        .not.toMatch(/\b(later|future|eventually|someday|will be used)\b/i);
    }
  });
});
