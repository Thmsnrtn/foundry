process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  DEGRADED_ENV, FATAL_ENV, inspectEnvironment, validateEnvironment,
} from '../../src/env.js';

// =============================================================================
// THREE ENVIRONMENT VALIDATORS, TWO OF WHICH RAN, AND THEY DISAGREED.
//
// `src/env.ts` was called at boot and treated an AI key as OPTIONAL. A few
// lines after the call, `index.ts` carried its own pair of lists which treated
// it as FATAL. `src/lib/env.ts` was a third, imported by nothing, which
// required `STRIPE_SECRET_KEY` and `ANTHROPIC_API_KEY` with no OpenRouter
// alternative and named two Stripe price IDs no code reads.
//
// The disagreement printed itself on every broken boot: this file's
// "✓ Environment validated" landed first, then the inline block's "FATAL:
// required config missing" — and outside production the fatal line only warns,
// so the operator's takeaway from a boot with no AI key was a green tick.
//
// One list now, and the tick is conditional on it.
// =============================================================================

function walk(dir: string): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (entry.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Every `process.env.X` the product reads. */
const SRC_ENV_VARS = new Set(
  walk('src')
    .flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)])
    .map((m) => m[1]!),
);

describe('there is one environment validator', () => {
  it('the zod copy nothing imported is gone', () => {
    expect(existsSync('src/lib/env.ts')).toBe(false);
  });

  it('index.ts states no second list of its own', async () => {
    // Comments stripped, per the house rule for any test that greps source:
    // `index.ts`'s comment at the call site NAMES the two lists it used to
    // carry, which is the record of why they are gone. A test that matched
    // prose would be measuring the explanation instead of the code.
    const { stripComments } = await import('../../scripts/lib/strip-comments.mjs');
    const index = stripComments(readFileSync('src/index.ts', 'utf8'), { lineComments: true });
    expect(index).not.toContain('FATAL_ENV_VARS');
    expect(index).not.toContain('DEGRADED_ENV_VARS');
    expect(index).toContain("from './env.js'");
  });
});

describe('the list names variables the code actually reads', () => {
  it('every fatal and degraded name appears as a process.env read in src/', () => {
    for (const req of [...FATAL_ENV, ...DEGRADED_ENV]) {
      for (const name of req.names) {
        expect(SRC_ENV_VARS.has(name), `${name} is listed but nothing reads it`).toBe(true);
      }
    }
  });

  it('the two abandoned Stripe tiers are not among them', () => {
    // `src/lib/env.ts` required a founding-cohort price and a Scale price. The
    // product sells Solo, Growth and Investor-Ready.
    const listed = [...FATAL_ENV, ...DEGRADED_ENV].flatMap((r) => r.names);
    expect(listed).not.toContain('STRIPE_FOUNDING_COHORT_PRICE_ID');
    expect(listed).not.toContain('STRIPE_SCALE_PRICE_ID');
  });

  it('ENCRYPTION_KEY is on it, which the live validator never mentioned', () => {
    const listed = [...FATAL_ENV, ...DEGRADED_ENV].flatMap((r) => r.names);
    expect(listed).toContain('ENCRYPTION_KEY');
  });
});

describe('what it says about an environment', () => {
  const full: NodeJS.ProcessEnv = {
    TURSO_DATABASE_URL: 'x', CLERK_SECRET_KEY: 'x', CLERK_PUBLISHABLE_KEY: 'x',
    OPENROUTER_API_KEY: 'x',
  };

  it('an AI key is fatal, and either gateway satisfies it', () => {
    expect(inspectEnvironment(full).fatalMissing).toEqual([]);
    const anthropic = { ...full, OPENROUTER_API_KEY: undefined, ANTHROPIC_API_KEY: 'x' };
    expect(inspectEnvironment(anthropic).fatalMissing).toEqual([]);
    const neither = { ...full, OPENROUTER_API_KEY: undefined };
    expect(inspectEnvironment(neither).fatalMissing)
      .toEqual(['OPENROUTER_API_KEY or ANTHROPIC_API_KEY']);
  });

  it('names the consequence of each absence, not just the absence', () => {
    const verdict = inspectEnvironment(full);
    const stripe = verdict.degradedMissing.find((d) => d.name === 'STRIPE_SECRET_KEY');
    expect(stripe?.consequence).toMatch(/billing/i);
    for (const d of verdict.degradedMissing) expect(d.consequence.length).toBeGreaterThan(10);
  });

  it('does not claim the environment is validated when something fatal is missing', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      validateEnvironment({ ...full, OPENROUTER_API_KEY: undefined, NODE_ENV: 'development' });
      expect(log.mock.calls.flat().join(' ')).not.toContain('Environment validated');
      expect(error.mock.calls.flat().join(' ')).toContain('required config missing');

      log.mockClear();
      validateEnvironment({ ...full, NODE_ENV: 'development' });
      expect(log.mock.calls.flat().join(' ')).toContain('Environment validated');
    } finally {
      log.mockRestore(); warn.mockRestore(); error.mockRestore();
    }
  });
});
