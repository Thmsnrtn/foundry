process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { declaredRoutes } from '../helpers/declared-routes.js';

// =============================================================================
// EVERY DECLARED ROUTE IS REGISTERED, AT THE PATH THIS SUITE THINKS IT HAS.
//
// An earlier probe asked this over HTTP and concluded "475 declared routes, zero
// unanswered". That was weaker than it sounded: it treated a non-404 as proof a
// route exists, and authentication answers 401 BEFORE routing resolves — so an
// unknown path under a guarded prefix is indistinguishable from a real one. It
// showed no route is missing from the app; it did not show every declared route
// is reachable, and it could not have.
//
// Hono exposes its own route table, which answers the question directly and
// with no auth in the way.
//
// The real work this does is guarding the POPULATION every other route test
// rests on. `agentRoutes` is mounted at `/agents`, so its `.get('/:name')` is
// `/agents/:name`; when the helper derived that as `/:name`, twenty-seven routes
// were probed at doors that do not exist and passed everything for the wrong
// reason. A prefix derived wrongly now fails here, loudly, instead of quietly
// making other assertions vacuous.
// =============================================================================

type Registered = { method: string; path: string };

let registered: Set<string>;
let declared: ReturnType<typeof declaredRoutes>;

beforeAll(async () => {
  const app = (await import('../../src/index.js')).default as unknown as { routes: Registered[] };
  // `.use()` registrations appear as ALL; they are middleware, not routes.
  registered = new Set(
    app.routes
      .filter((r) => r.method !== 'ALL')
      .map((r) => `${r.method.toUpperCase()} ${r.path.replace(/:[A-Za-z0-9_]+/g, 'probe-value')}`),
  );
  declared = declaredRoutes();
}, 120_000);

describe('the route table and the source agree', () => {
  it('resolved every mount prefix', () => {
    expect(declared.unresolved, 'a route could not be resolved to a path').toEqual([]);
    expect(declared.routes.length).toBeGreaterThan(400);
  });

  it('registers every route the source declares, at the path it is declared to have', () => {
    const missing = declared.routes
      .filter((r) => !registered.has(`${r.method} ${r.path}`))
      .map((r) => `${r.method} ${r.path}  (${r.file})`);
    expect(missing, 'declared in source, not registered on the app at that path').toEqual([]);
  });
});
