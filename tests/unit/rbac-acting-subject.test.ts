// =============================================================================
// Tests: which identity a role check is looking at
//
// `requireRole` and `requirePermission` read `c.get('productId')` and
// `c.get('userId')`. Nothing sets those except the PUBLIC API's key
// middleware. Every dashboard route they guard therefore returned 401 to the
// founder who owns the company:
//
//   /checkout                       /settings/manage-subscription
//   /settings/pause-company         /settings/resume-company
//   /settings/api-keys              /settings/api-keys/:id/revoke
//   /settings/ingest-credentials    /settings/ingest-credentials/:id/revoke
//   /settings/generate-share        /settings/generate-ingest
//   /settings/wisdom-toggle
//
// Twelve founder-facing routes, guarded into unreachability by a check looking
// at the wrong surface's identity. The policy — "the acting user must hold this
// role on this company" — was implemented, enforced, and bound to a subject
// that does not exist on the surface it was mounted on. That is this batch's
// defect class in its purest form, and it is also why nobody noticed: a guard
// that refuses everyone looks exactly like a guard that works.
//
// The subject is resolved once now, for whichever surface the request arrived
// on, so the two guards cannot disagree about who is asking.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { requirePermission, requireRole } from '../../src/middleware/rbac.js';

const OWNER = 'rb_owner';
const STRANGER = 'rb_stranger';
const MEMBER = 'rb_member';
const PRODUCT = 'rb_product';

beforeAll(async () => {
  await runMigrations();
  for (const [id, email] of [[OWNER, 'owner@rb.test'], [STRANGER, 'stranger@rb.test'],
    [MEMBER, 'member@rb.test']] as const) {
    await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
      [id, `clerk_${id}`, email]);
  }
  await query(
    `INSERT INTO products (id, name, owner_id, status) VALUES (?,'RBAC Co',?, 'active')`,
    [PRODUCT, OWNER]);
});

/** A dashboard-shaped request: authMiddleware sets `founder`, and the selected
 * company arrives in a cookie. No `userId`/`productId` anywhere. */
function dashboardApp(founderId: string | null, guard: Parameters<Hono['use']>[1]) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (founderId) c.set('founder' as never, { id: founderId } as never);
    await next();
  });
  app.post('/x', guard, (c) => c.json({ ok: true }));
  return app;
}

/** An API-shaped request: the key middleware sets userId and productId. */
function apiApp(userId: string, productId: string, guard: Parameters<Hono['use']>[1]) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId' as never, userId as never);
    c.set('productId' as never, productId as never);
    await next();
  });
  app.post('/x', guard, (c) => c.json({ ok: true }));
  return app;
}

const withCompany = { headers: { cookie: `foundry_product=${PRODUCT}` }, method: 'POST' };

describe('a founder can reach their own guarded routes', () => {
  it('lets the owner through on the dashboard surface', async () => {
    const res = await dashboardApp(OWNER, requireRole('owner')).request('/x', withCompany);
    expect(res.status, 'the owner of the company was getting 401 from an owner check')
      .toBe(200);
  });

  it('lets the owner through a permission check too', async () => {
    const res = await dashboardApp(OWNER, requirePermission('experiments:manage'))
      .request('/x', withCompany);
    expect(res.status).toBe(200);
  });

  it('still works on the API surface, where the identity comes from a key', async () => {
    const res = await apiApp(OWNER, PRODUCT, requireRole('owner')).request('/x', { method: 'POST' });
    expect(res.status).toBe(200);
  });
});

describe('and the check still refuses everyone it should', () => {
  it('refuses a stranger who names the company in a cookie', async () => {
    // The cookie is a SELECTION, not an authorisation. Forging it names a
    // company; it does not confer a role on one.
    const res = await dashboardApp(STRANGER, requireRole('owner')).request('/x', withCompany);
    expect(res.status).toBe(403);
  });

  it('refuses a team member below the required role', async () => {
    // Roles live in `account_roles`, which is what getUserRole reads —
    // `team_members` carries a different vocabulary for a different purpose.
    await query(
      `INSERT INTO account_roles (id, product_id, founder_id, role, granted_by)
       VALUES ('rb_ar', ?, ?, 'viewer', ?)`, [PRODUCT, MEMBER, OWNER]);
    const res = await dashboardApp(MEMBER, requireRole('admin')).request('/x', withCompany);
    expect(res.status).toBe(403);
  });

  it('admits that team member to a role they do hold', async () => {
    const res = await dashboardApp(MEMBER, requireRole('viewer')).request('/x', withCompany);
    expect(res.status).toBe(200);
  });

  it('refuses an unauthenticated request', async () => {
    const res = await dashboardApp(null, requireRole('viewer')).request('/x', withCompany);
    expect(res.status).toBe(401);
  });

  it('says so plainly when no company is selected', async () => {
    // Distinguishable from "not signed in": the caller is known, the company is
    // not. Returning 401 for both is what hid the original defect.
    const res = await dashboardApp(OWNER, requireRole('owner')).request('/x', { method: 'POST' });
    expect(res.status).toBe(400);
  });
});
