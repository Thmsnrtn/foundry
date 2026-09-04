process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { declaredRoutes } from '../helpers/declared-routes.js';
import { runMigrations } from '../../src/db/migrate.js';

// =============================================================================
// WHAT A STRANGER CAN SEE, AND WHAT BREAKS WHEN THEY LOOK.
//
// The companion to `no-mutating-route-answers-a-stranger`. That one asks whether
// an unauthenticated caller can CHANGE anything; this asks what they can read,
// and whether asking breaks anything.
//
// Two invariants, both previously unaskable — `src/index.ts` started a server at
// module scope, so no test could drive the app:
//
//   • No readable route answers a stranger with a server error. A route that
//     throws on every request is the "quiet week that was really a broken week"
//     defect at the surface level: nobody is told, because nobody who could
//     tell is looking.
//   • The set of routes that answer a stranger AT ALL is exactly the marketing
//     and auth pages. A route accidentally made public is named here rather
//     than discovered later.
//
// The public set is written down rather than derived, because that is the point
// — it is a decision about what the world may see, and a decision has to be
// stated somewhere a change to it shows up in review.
// =============================================================================

/** Pages the world is meant to reach without an account. */
const PUBLIC = [
  '/',
  // Declared at `apiV1.get('/health')` BEFORE `apiV1.use('*', apiKeyAuth)`, so
  // it is public by construction — Hono does not apply middleware to a route
  // registered above it. It carries a status, a version and a timestamp, and no
  // company data.
  //
  // It appeared here the moment the API was mounted above the routers that were
  // shadowing it, which is this test doing its job: the public surface changed
  // and had to be justified rather than absorbed.
  '/api/v1/health',
  // The PWA pair. A browser fetches both unauthenticated — it cannot install an
  // app whose manifest or service worker require a session — and they carry no
  // company data. Both are declared in `index.ts` itself rather than a router,
  // which is why they only appeared here once the population learned to read
  // that file.
  '/manifest.json',
  '/sw.js',
  // The deploy has to be able to ask whether a route his screens post to is in
  // the release, and it cannot do that under /foundry: the session middleware
  // answers 401 before routing, so a missing route and a live one are
  // indistinguishable — which is exactly how a form pointing at a route that
  // did not exist once shipped.
  //
  // It ANSWERS rather than PUBLISHES. It used to return the whole inventory,
  // and the reasoning was that every path is already visible to him in the HTML
  // of his own pages — true for him, and he is the only one who can load them.
  // To a stranger, who gets 401 from all of them, that list was the one place
  // to get a map. This test is what caught it. Now it takes the routes you name
  // and says which are missing, so a guess can be confirmed and nothing can be
  // harvested.
  '/internal/routes',
  '/auth/login',
  '/auth/logout',
  '/auth/signup',
  '/case-studies',
  '/help',
  '/manifesto',
  '/pricing',
  '/privacy-policy',
  '/terms',
].sort();

/** Reports whether the service is healthy, so an unhealthy 503 is its job. */
const HEALTH = '/internal/health';

let app: { request: (path: string) => Promise<Response> };
let seen: Array<{ path: string; status: number }>;

beforeAll(async () => {
  // Migrations first. Without them a public route that reads the database
  // answers 500 for want of a table, which reads exactly like the defect this
  // is looking for — the first run of this probe reported three.
  await runMigrations();
  app = (await import('../../src/index.js')).default as typeof app;

  const declared = declaredRoutes();
  expect(declared.unresolved, 'a route could not be resolved to a path').toEqual([]);

  seen = [];
  for (const path of declared.routes.filter((r) => r.method === 'GET').map((r) => r.path)) {
    try {
      seen.push({ path, status: (await app.request(path)).status });
    } catch {
      seen.push({ path, status: 599 });
    }
  }
}, 180_000);

describe('a reader with no account', () => {
  it('finds a substantial readable surface to check', () => {
    // A regex that matched nothing would make everything below vacuous.
    expect(seen.length).toBeGreaterThan(200);
  });

  it('breaks nothing by looking', () => {
    const broken = seen.filter((r) => r.status >= 500 && r.path !== HEALTH);
    expect(broken, 'a route answered a stranger with a server error').toEqual([]);
  });

  it('sees exactly the pages meant for the world', () => {
    const answered = seen.filter((r) => r.status >= 200 && r.status < 300).map((r) => r.path).sort();
    expect(answered).toEqual(PUBLIC);
  });
});
