import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';

// =============================================================================
// A POLICY THAT FORBADE THE PRODUCT'S OWN PAGES.
//
// The enforced `script-src` allowed `'self'` and Clerk's own domain. Every page
// that loads Clerk gets it from somewhere else: the sign-up, sign-in and
// sign-out pages import it from `cdn.jsdelivr.net`, and the landing page loads
// it from `unpkg.com`. An enforcing browser blocks all four — which means
// authentication does not load, and the sign-in page falls into the catch
// handler that says "failed to load authentication".
//
// A second copy of the policy lived in `middleware/security.ts`, imported by
// nobody, allowing unpkg but not jsdelivr and carrying two directives the live
// one lacked. Two policies for one question, one of them enforced, and the dead
// one looked stricter.
//
// So this test does what neither could: it reads the origins the pages ACTUALLY
// load scripts from, and requires the live policy to name each one.
// =============================================================================

const CSP_FILE = 'src/middleware/security-headers.ts';
// COMMENTS STRIPPED, INCLUDING FROM THE POLICY ITSELF. The first version of
// this test took the first line containing 'script-src' — which was the comment
// ABOVE the directive, explaining the defect — so it read the prose and
// reported the origins missing. Eighth instance of prose being read as code
// this campaign, and the second inside a test written to catch that very class.
const csp = stripComments(readFileSync(CSP_FILE, 'utf8'), { lineComments: true });

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** Every https origin a served page pulls a script from. */
function scriptOrigins(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of tsFiles('src')) {
    // Comments stripped: this file and the CSP both NAME the origins in prose
    // explaining the defect, and a scanner that reads its own explanation
    // reports the problem as solved.
    const src = stripComments(readFileSync(file, 'utf8'), { lineComments: true });
    const patterns = [
      /import\(\s*["'](https:\/\/[^"'/]+)/g,
      /<script[^>]*\bsrc=["'](https:\/\/[^"'/]+)/g,
    ];
    for (const re of patterns) {
      for (const m of src.matchAll(re)) {
        const origin = m[1];
        found.set(origin, [...(found.get(origin) ?? []), file]);
      }
    }
  }
  return found;
}

describe('the content security policy', () => {
  it('names every origin the pages load a script from', () => {
    const scriptSrc = csp.split('\n').find((l) => l.includes('script-src')) ?? '';
    const missing: string[] = [];
    for (const [origin, files] of scriptOrigins()) {
      if (!scriptSrc.includes(origin)) missing.push(`${origin} (${files.join(', ')})`);
    }
    expect(missing, 'an origin the product loads and the policy forbids').toEqual([]);
  });

  it('finds the origins at all, so an empty result cannot pass this test', () => {
    // Zero is a finding only if the instrument can see.
    expect(scriptOrigins().size).toBeGreaterThan(0);
  });

  it('is the only one in the codebase', () => {
    const declaring = tsFiles('src').filter((f) =>
      stripComments(readFileSync(f, 'utf8'), { lineComments: true }).includes('Content-Security-Policy'));
    expect(declaring).toEqual([CSP_FILE]);
  });

  it('keeps the hardening the deleted copy carried', () => {
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });
});
