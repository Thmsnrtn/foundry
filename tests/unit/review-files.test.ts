// =============================================================================
// Tests: Audit review-file selection (Phase 2.3)
// =============================================================================

import { describe, it, expect } from 'vitest';
import { selectReviewFiles } from '../../src/services/audit/review-files.js';

function bigFile(marker: string, kb: number): string {
  return `// ${marker}\n` + 'x'.repeat(kb * 1024);
}

describe('selectReviewFiles', () => {
  it('covers each high-stakes category when files exist', () => {
    const files = new Map<string, string>([
      ['src/middleware/auth.ts', 'auth code'],
      ['src/services/billing/stripe.ts', 'billing code'],
      ['src/lib/error-reporter.ts', 'error code'],
      ['fly.toml', 'config'],
      ['README.md', 'not relevant'],
    ]);
    const selected = selectReviewFiles(files);
    const paths = selected.map((f) => f.path);
    expect(paths).toContain('src/middleware/auth.ts');
    expect(paths).toContain('src/services/billing/stripe.ts');
    expect(paths).toContain('src/lib/error-reporter.ts');
    expect(paths).toContain('fly.toml');
    // Irrelevant files are excluded.
    expect(paths).not.toContain('README.md');
  });

  it('caps the number of files and total size', () => {
    const files = new Map<string, string>();
    for (let i = 0; i < 40; i++) files.set(`src/auth/mod${i}.ts`, bigFile(`m${i}`, 5));
    const selected = selectReviewFiles(files);
    expect(selected.length).toBeLessThanOrEqual(8);
    const total = selected.reduce((n, f) => n + f.content.length, 0);
    expect(total).toBeLessThanOrEqual(14_000);
  });

  it('truncates individual large files', () => {
    const files = new Map<string, string>([['src/auth/big.ts', bigFile('big', 20)]]);
    const [file] = selectReviewFiles(files);
    expect(file.content.length).toBeLessThanOrEqual(2500);
  });

  it('skips empty files and returns nothing when no relevant files', () => {
    const files = new Map<string, string>([
      ['README.md', 'docs'],
      ['src/auth/empty.ts', '   '],
    ]);
    expect(selectReviewFiles(files)).toEqual([]);
  });
});
