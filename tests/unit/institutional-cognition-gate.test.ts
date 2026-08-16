import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// =============================================================================
// Institutional cognition gate.
//
// The constitution says every subsystem and every cognition step must pay rent,
// and that a simpler equivalent architecture wins. Today the institutional
// kernel honours both by construction: it makes no model calls at all. Every
// judgment, disposition, verification, and authority decision in it is
// deterministic, which is why its frozen benchmarks can set a model-cost
// ceiling of zero and mean it.
//
// That is a property worth keeping deliberately rather than by accident.
// Introducing model cognition here is a legitimate future decision — the
// roadmap's executive-cognition work is exactly that — but it is a decision
// with a price: latency, spend, non-determinism, and a new way for evidence to
// be fabricated rather than observed. This gate makes that decision explicit.
// It does not forbid cognition; it forbids cognition arriving unnoticed,
// unmeasured, and unaccounted.
//
// If you are here because this test failed: do not add an exception. Run the
// marginal-value comparison first — decision quality, error rate, latency,
// cost, and founder attention against the deterministic baseline that already
// exists — record the result in IMPLEMENTATION_STATE, and only then change
// this gate in the same commit as the evidence.
// =============================================================================

const ROOT = resolve(__dirname, '../..');

/** The deterministic kernel. The outbound gateway is included: it is the
 * boundary every consequential effect crosses, and a model call inside the
 * thing that authorises effects would be a very expensive mistake. */
const DETERMINISTIC = ['src/services/institution', 'src/services/outbound'];

/** Forbidden module specifiers, matched against every import in the file —
 * static `from '...'` AND dynamic `await import('...')` alike. The institution
 * reaches almost everything dynamically, so a static-only check would pass
 * while a model call sat one `await import` away. */
const MODEL_MODULE = [
  { name: 'ai client', pattern: /(?:^|\/)ai\// },
  { name: 'anthropic sdk', pattern: /^@?anthropic/i },
  { name: 'openai sdk', pattern: /^openai/i },
  { name: 'openrouter client', pattern: /openrouter/i },
];

/** Forbidden regardless of imports: a model reached by raw HTTP, or a local
 * helper that wraps one. */
const MODEL_TEXT = [
  { name: 'model http endpoint', pattern: /https?:\/\/[^'"\s]*(anthropic|openai|openrouter)/i },
  { name: 'model invocation helper', pattern: /\b(callModel|completeWithModel|runPrompt|generateWithAI|complete)\s*\(\s*\{/ },
];

function moduleSpecifiers(source: string): Array<{ specifier: string; line: number }> {
  const out: Array<{ specifier: string; line: number }> = [];
  source.split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    const re = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) out.push({ specifier: m[1], line: i + 1 });
  });
  return out;
}

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = resolve(dir, entry);
    return statSync(path).isDirectory() ? tsFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

describe('institutional cognition', () => {
  it('the institutional kernel and the effect boundary make no model calls', () => {
    const offenders: string[] = [];
    for (const dir of DETERMINISTIC) {
      for (const file of tsFiles(resolve(ROOT, dir))) {
        const source = readFileSync(file, 'utf8');
        for (const { specifier, line } of moduleSpecifiers(source)) {
          for (const { name, pattern } of MODEL_MODULE) {
            if (pattern.test(specifier)) offenders.push(`${relative(ROOT, file)}:${line} → ${name} (${specifier})`);
          }
        }
        source.split('\n').forEach((raw, i) => {
          const trimmed = raw.trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
          for (const { name, pattern } of MODEL_TEXT) {
            if (pattern.test(raw)) offenders.push(`${relative(ROOT, file)}:${i + 1} → ${name}`);
          }
        });
      }
    }
    expect(offenders,
      'Model cognition entered the deterministic kernel. Measure its marginal value against ' +
      'the deterministic baseline first, record the comparison, and change this gate in the ' +
      'same commit as the evidence — do not allowlist it:\n' + offenders.join('\n'),
    ).toEqual([]);
  });

  it('the frozen development benchmark still means its zero-cost ceiling', async () => {
    // The gate above and the benchmark's model-cost threshold are the same
    // claim stated twice — in code and in the frozen contract. If one is ever
    // relaxed without the other, the benchmark would be scoring a system that
    // no longer matches its own assumptions.
    const { DEVELOPMENT_BENCHMARK_THRESHOLDS } = await import(
      '../../src/services/institution/development-benchmark.js');
    expect(DEVELOPMENT_BENCHMARK_THRESHOLDS.maxModelCostUsd).toBe(0);
  });
});
