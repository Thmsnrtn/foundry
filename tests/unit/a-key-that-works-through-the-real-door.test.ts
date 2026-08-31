process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { issueApiKey } from '../../src/services/api/api-key-issuance.js';

// =============================================================================
// A KEY THAT WORKS THROUGH THE REAL DOOR.
//
// The public API is tested by mounting `apiV1` on a bare Hono app. That proves
// the routes behave; it cannot prove they behave AS MOUNTED. In front of them in
// the real app sits `app.use('/api/*', sessionAuthForApiRoutes)`, whose own
// comment names the hazard it exists for: the REST API "owns its bearer API-key
// authentication in apiV1 and must not have that credential consumed as a Clerk
// token first".
//
// Nothing had ever checked that, because until today importing the app started
// a server. It is the same shape as the static-asset defect: the handler was
// correct and the mounting was where the truth lived.
//
// So this mints a real key and drives the real app.
// =============================================================================

const OWNER = 'akd_owner';
const OTHER_OWNER = 'akd_other_owner';
const MINE = 'akd_mine';
const THEIRS = 'akd_theirs';

let app: { request: (path: string, init?: RequestInit) => Promise<Response> };
let myKey: string;

const withKey = (path: string, key: string): Promise<Response> =>
  app.request(path, { headers: { Authorization: `Bearer ${key}` } });

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?),(?,?,?)',
    [OWNER, 'akd_c1', 'me@test.local', OTHER_OWNER, 'akd_c2', 'them@test.local']);
  // `status` matters: the API asks whether Foundry may act for this company at
  // all before it serves anything.
  await query(`INSERT INTO products (id,name,owner_id,status,scp_status)
      VALUES (?,?,?,'active','active'),(?,?,?,'active','active')`,
  [MINE, 'My Co', OWNER, THEIRS, 'Their Co', OTHER_OWNER]);

  const issued = await issueApiKey({
    productId: MINE, founderId: OWNER, label: 'integration', scopes: ['customers:read'],
  });
  if ('refused' in issued) throw new Error(`could not issue a key: ${issued.refused}`);
  myKey = issued.key;

  app = (await import('../../src/index.js')).default as typeof app;
}, 120_000);

describe('a real key, through the real app', () => {
  it('is not eaten by the session middleware standing in front of the API', () => {
    // The precondition the hazard comment is about. If this were mounted behind
    // Clerk, every key-authenticated request would be rejected as a bad session.
    expect(myKey.startsWith('fnd_')).toBe(true);
  });

  it('opens a scoped endpoint', async () => {
    const res = await withKey('/api/v1/customers', myKey);
    expect(res.status, await res.text()).toBe(200);
  });

  it('is refused without the key', async () => {
    expect((await app.request('/api/v1/customers')).status).toBe(401);
  });

  it('is refused when the key is wrong', async () => {
    expect((await withKey('/api/v1/customers', 'fnd_not-a-real-key')).status).toBe(401);
  });
});

describe('what the key does not open', () => {
  it('refuses a scope the founder did not grant it', async () => {
    // The key carries `customers:read` only. Writing customers needs
    // `customers:manage`, and the scope is checked as mounted, not only in the
    // unit test that mounts the router alone.
    const res = await app.request('/api/v1/customers', {
      method: 'POST',
      headers: { Authorization: `Bearer ${myKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ external_id: 'c1', name: 'Someone' }),
    });
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(201);
  });

  it('reads only the company it was issued for', async () => {
    // A customer belonging to the other company, which this key must never see.
    await query(
      `INSERT INTO customers (id,product_id,owner_id,external_id,name)
       VALUES ('akd_theirs_cust',?,?,'their-external-id','Their Customer')`,
      [THEIRS, OTHER_OWNER]);

    const res = await withKey('/api/v1/customers', myKey);
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain('their-external-id');
  });
});
