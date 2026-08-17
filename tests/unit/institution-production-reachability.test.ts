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
  'support-pilot-readiness.ts': 'prospective readiness contract — scored by its own gate, never by production',
  'support-drafting-benchmark.ts': 'frozen prospective contract (E1) — no model exists to score against it yet',
  'reconstruction-benchmark.ts': 'frozen gate — exercised by its benchmark test by design',
  'responsibility-assisting-benchmark.ts': 'frozen gate — exercised by its benchmark test by design',
  'responsibility-recognition-benchmark.ts': 'frozen gate — exercised by its benchmark test by design',
  'responsibility-shadowing-benchmark.ts': 'frozen gate — exercised by its benchmark test by design',
  'responsibility-understanding-benchmark.ts': 'frozen gate — exercised by its benchmark test by design',

  // `development-observation.ts` left this list when Foundry began observing
  // its own repository. That was always the honest blocker: development
  // Shadowing needs an independent view of the same reality, and for a
  // CUSTOMER's company Foundry has none — it would be checking an expectation
  // against its own say-so. For the Foundry company the supply genuinely
  // exists, so the scheduled pass now records a real deterministic check
  // through the ordinary intake.
  //
  // `development-shadowing.ts` stays dark, and the distinction is the point:
  // observations are now supplied, but nothing in production yet *opens* a
  // development expectation for them to resolve. Wiring a driver that invents
  // expectations to consume the observations would be manufacturing the
  // prediction to fit the evidence.
  'development-shadowing.ts': 'blocked — no production path opens a development expectation, only observations are supplied',
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

  it('the institution has a production evidence intake that something calls', () => {
    // The gate above scans institution modules, and by doing so it missed the
    // worst orphan in the system: `emitSignalEvent` — the only function that
    // records a company signal AND runs responsibility discovery — lived in
    // src/services/scp and had no caller anywhere. Discovery was reachable and
    // never fed, so nothing in production ever reached the first rung.
    //
    // Module-level reachability could not see that, so this asserts the intake
    // directly. If the last caller is ever removed, the ladder loses its
    // supply, and that must fail here rather than in silence.
    const callers = tsFiles(resolve(ROOT, 'src'))
      .filter((f) => !f.endsWith('services/scp/events/dispatcher.ts'))
      .filter((f) => /\bemitSignalEvent\b/.test(readFileSync(f, 'utf8')));
    expect(callers,
      'Nothing produces company evidence. The institution cannot recognise a ' +
      'responsibility it is never told about.').not.toEqual([]);
  });

  it('every link in the support chain has a real production caller', () => {
    // The chain's callers were previously asserted inside the vertical test.
    // That proves the chain worked once; it does not stop a link going dark
    // later. This is the permanent version.
    //
    // Only `src/` is scanned, so a test-only or benchmark-only caller cannot
    // satisfy a link — which is exactly the failure mode this program keeps
    // finding. Each entry names the module that DEFINES the symbol, so a module
    // referring to itself never counts as its own caller.
    const CHAIN: Array<[string, string, string]> = [
      ['company evidence intake', 'emitSignalEvent', 'services/scp/events/dispatcher.ts'],
      ['responsibility discovery', 'discoverResponsibilityFromSignal', 'services/institution/discovery.ts'],
      ['founder evidence', 'recordFounderEvidenceAnswer', 'services/institution/founder-evidence.ts'],
      // Without a production caller for the declaration, a company could never
      // tell Foundry what to listen for, and independent observation would
      // silently remain SaaS-only however general the machinery underneath.
      ['company observation channel', 'registerObservationChannel', 'services/institution/company-observation.ts'],
      ['company observation intake', 'recordCompanyObservations', 'services/institution/company-observation.ts'],
      ['understanding advancement', 'earnResponsibilityUnderstanding', 'services/institution/responsibility-understanding.ts'],
      ['expectation + shadowing entry', 'beginExternalMetricShadowing', 'services/institution/external-shadowing.ts'],
      ['independent observation', 'recordExternalMetricObservations', 'services/institution/external-observation.ts'],
      ['shadow comparison', 'resolveExternalMetricShadowing', 'services/institution/external-shadowing.ts'],
      ['authority grant', 'grantAssistingAuthority', 'services/institution/assisting-admission.ts'],
      ['authority revocation', 'revokeAssistingAuthority', 'services/institution/assisting-admission.ts'],
      ['assisting admission', 'enterResponsibilityAssisting', 'services/institution/responsibility-assisting.ts'],
      ['customer message intake', 'ingestCustomerMessage', 'services/institution/customer-message-intake.ts'],
      ['responsibility/channel association', 'registerSupportChannel', 'services/institution/customer-message-intake.ts'],
      ['founder reply proposal', 'proposeSupportReply', 'services/institution/support-reply.ts'],
      // The second effect kind must have a real founder behind it, or migration
      // 136 widened the boundary for nobody.
      ['founder notice authoring', 'proposeResponsibilityNotice', 'services/institution/responsibility-notice.ts'],
      ['notice planning', 'planResponsibilityNotice', 'services/institution/responsibility-notice.ts'],
      ['action planning', 'planProposedReply', 'services/institution/support-reply.ts'],
      ['assisted plan writer', 'planAssistedSupportEmail', 'services/institution/responsibility-assisted-email.ts'],
      ['governed execution', 'executeAssistedSupportEmail', 'services/institution/responsibility-assisted-email.ts'],
    ];
    const files = tsFiles(resolve(ROOT, 'src'));
    const dark: string[] = [];
    for (const [link, symbol, definedIn] of CHAIN) {
      // Invocation, not mention. Import lines are stripped first, and the
      // symbol must appear in call position — otherwise renaming a call while
      // leaving the import behind would keep the gate green on a dead link,
      // which is exactly the brittleness this program keeps paying for.
      const callers = files
        .filter((f) => !f.endsWith(definedIn))
        .filter((f) => {
          const source = readFileSync(f, 'utf8')
            .split('\n')
            .filter((line) => !/^\s*(import|export)\s/.test(line) && !/^\s*[\w,{} ]+\}?\s*from\s/.test(line))
            .join('\n');
          return new RegExp(`\\b${symbol}\\s*\\(`).test(source);
        });
      if (!callers.length) dark.push(`${link} — nothing in src/ calls ${symbol}()`);
    }
    expect(dark,
      'A link in the support chain exists but nothing production-facing reaches it. ' +
      'A service in src/ is not enough; a test-only caller is not enough:\n' + dark.join('\n'),
    ).toEqual([]);
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
