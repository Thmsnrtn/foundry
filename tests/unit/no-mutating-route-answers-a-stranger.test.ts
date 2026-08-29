process.env.TURSO_DATABASE_URL = 'file::memory:';

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';

// =============================================================================
// NO MUTATING ROUTE ANSWERS A STRANGER.
//
// `check-route-guards.mjs` baselines 112 "unguarded mutating routes" — routes
// carrying no explicit per-route capability check. That is a STATIC count, and
// it cannot see the authentication middleware that stands in front of them, so
// it reads far more alarming than the product is.
//
// This asks the question the other way, by firing an unauthenticated request at
// every mutating route the source declares and checking what actually comes
// back. It could not be asked before: `src/index.ts` started a server at module
// scope, so no test could import the app.
//
// The route list is DERIVED FROM SOURCE at test time rather than written down,
// so a route added tomorrow is covered by this tomorrow. A list would only ever
// prove things about the day somebody last edited it.
// =============================================================================

const ROOT = resolve(__dirname, '../..');
const METHODS = ['post', 'put', 'patch', 'delete'] as const;

/** Every mutating route path the source declares, with parameters filled in. */
function declaredMutatingRoutes(): string[] {
  const files: string[] = [];
  (function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts')) files.push(p);
    }
  })(join(ROOT, 'src/routes'));

  const found = new Set<string>();
  for (const file of files) {
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const method of METHODS) {
      for (const m of src.matchAll(new RegExp(`\\.${method}\\('(/[^']*)'`, 'g'))) {
        // A parameter needs some value; which value cannot matter, because a
        // stranger must be refused before anything looks it up.
        found.add(m[1].replace(/:[A-Za-z0-9_]+/g, 'probe-value'));
      }
    }
  }
  return [...found].sort();
}

let app: { request: (path: string, init?: RequestInit) => Promise<Response> };
let routes: string[];

beforeAll(async () => {
  app = (await import('../../src/index.js')).default as typeof app;
  routes = declaredMutatingRoutes();
}, 60_000);

describe('a request with no session', () => {
  it('finds a substantial mutating surface to check', () => {
    // A regex that quietly matched nothing would make every assertion below
    // vacuous, which is the failure mode of a test like this.
    expect(routes.length).toBeGreaterThan(100);
  });

  it('is refused by every one of them', async () => {
    const answered: Array<{ route: string; status: number }> = [];
    for (const route of routes) {
      let status: number;
      try {
        status = (await app.request(route, { method: 'POST' })).status;
      } catch {
        // A handler that throws has not served the stranger either, and the
        // gateway of last resort is the framework's own error response.
        continue;
      }
      if (status >= 200 && status < 300) answered.push({ route, status });
    }
    expect(answered, 'a mutating route answered a request with no session').toEqual([]);
  }, 300_000);
});
