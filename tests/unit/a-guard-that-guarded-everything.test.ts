process.env.TURSO_DATABASE_URL = 'file::memory:';

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { issueApiKey } from '../../src/services/api/api-key-issuance.js';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';

// =============================================================================
// A GUARD THAT GUARDED EVERYTHING.
//
// Five dashboard routers are mounted at '/' and each registered
// `use('*', requireCompanyCapability(...))`. In Hono a sub-app's middleware is
// merged under its MOUNT PATH, so at '/' those guards applied to every path in
// the application.
//
// Two whole surfaces died of it. The REST API answered
// `{"error":"Unauthorized"}` to every request with a valid key — a financial
// capability check written for `/roi` running in front of `/api/v1`. The
// transcript webhooks did the same: mounted alone one answers 400 "No
// transcript in payload" to a valid key, and through the real app it answered
// 401 to the same request.
//
// All five of those routers, and both transcript webhooks, were Commercial
// Foundry and were deleted on 13 September 2026. The defect they caused did
// not go with them: the next router mounted at '/' with a `use('*')` inside it
// would do the same thing to the owner's own surface. So the behavioural half
// of this file now rests on the REST API, the one shadowed surface still here,
// and the structural half — which is the part that prevents the next one —
// reads the composition root and is unchanged.
//
// Owners never saw it — `memberMay` short-circuits for the owner, and
// `can_view_financials` defaults TRUE for members — so the damage landed exactly
// where there is no session at all: machine-facing callers.
//
// Each guard is scoped to its own router's paths now. The structural assertion
// below is what stops the next one, because the next one will not look like a
// bug either: `use('*')` inside a router reads as "this router's routes".
// =============================================================================

const ROOT = resolve(__dirname, '../..');
const OWNER = 'gge_owner';
const PRODUCT = 'gge_product';

let app: { request: (path: string, init?: RequestInit) => Promise<Response> };
let key: string;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
    [OWNER, 'gge_c', 'o@test.local']);
  await query(`INSERT INTO products (id,name,owner_id,status,scp_status)
    VALUES (?,?,?,'active','active')`, [PRODUCT, 'Co', OWNER]);
  key = (await issueApiKey({
    productId: PRODUCT, founderId: OWNER, label: 'webhook', scopes: ['agents:read'],
  }) as { key: string }).key;
  app = (await import('../../src/index.js')).default as typeof app;
}, 180_000);

describe('a surface with no session', () => {
  it('still reaches the API the guard was shadowing', async () => {
    // WHAT IS LEFT TO PROVE IT WITH. The two transcript webhooks and the
    // voice-reply intake were the other surfaces this guard killed, and all
    // three were Commercial Foundry routers deleted on 13 September 2026. The
    // REST API is the one shadowed surface that is still here, so it carries
    // the behavioural half of this file on its own.
    // The key is issued with `agents:read`, and `/api/v1/agents` is the route
    // that honours it — a 401 here would mean the credential was refused
    // before its own scope was ever consulted, which is exactly the failure.
    const res = await app.request('/api/v1/agents', { headers: { Authorization: `Bearer ${key}` } });
    expect(res.status, 'a valid key must not be answered 401').not.toBe(401);
  });
});

describe('no router mounted at the root guards everything', () => {
  it('is true of every one of them', () => {
    // THE ASSERTION THAT PREVENTS THE NEXT ONE. A `use('*')` inside a router
    // reads as "this router's routes" and means "every path in the app" once
    // that router is mounted at '/'. Nothing about the line looks wrong, which
    // is why three surfaces had to die before anybody looked at it.
    const index = stripComments(readFileSync(join(ROOT, 'src/index.ts'), 'utf8'));

    const imports = new Map<string, string>();
    for (const m of index.matchAll(/import\s*\{\s*([\w\s,]+?)\s*\}\s*from\s*'(\.[^']+)'/g)) {
      for (const name of m[1].split(',').map((n) => n.trim()).filter(Boolean)) {
        imports.set(name, m[2]);
      }
    }

    const offenders: string[] = [];
    for (const m of index.matchAll(/app\.route\('\/',\s*(\w+)\)/g)) {
      const rel = imports.get(m[1]);
      if (!rel) continue;
      const file = resolve(dirname(join(ROOT, 'src/index.ts')), rel.replace(/\.js$/, '.ts'));
      let src: string;
      try { src = stripComments(readFileSync(file, 'utf8')); } catch { continue; }
      // Built from fragments so this file does not match its own needle.
      if (src.includes([".use('", "*'"].join(''))) offenders.push(`${m[1]} (${rel})`);
    }
    expect(offenders, 'a router mounted at / applies its middleware to every path').toEqual([]);
  });
});
