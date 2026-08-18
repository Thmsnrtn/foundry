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
import { requireCompanyCapability, requireOwner } from '../../src/middleware/rbac.js';


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
    const res = await dashboardApp(OWNER, requireOwner()).request('/x', withCompany);
    expect(res.status, 'the owner of the company was getting 401 from an owner check')
      .toBe(200);
  });

  it('lets the owner through a capability check too', async () => {
    // The owner holds every company capability by virtue of being the owner,
    // not because they sit at the top of a ladder — they have no membership
    // row at all.
    const res = await dashboardApp(OWNER, requireCompanyCapability('can_manage_company'))
      .request('/x', withCompany);
    expect(res.status).toBe(200);
  });

  it('does NOT accept an API key in place of the person who minted it', async () => {
    // `api_keys.created_by` names the founder who created the credential. Read
    // as the acting user, a scoped, revocable, expiring key issued to post
    // metrics would satisfy an owner check and could pause the company.
    //
    // A role is a property of a person. A key is not a person, even when the
    // same row names one.
    const res = await apiApp(OWNER, PRODUCT, requireOwner()).request('/x', { method: 'POST' });
    expect(res.status,
      'a machine credential must not inherit its creator\'s human authority')
      .toBe(401);
  });
});

describe('and the check still refuses everyone it should', () => {
  it('refuses a stranger who names the company in a cookie', async () => {
    // The cookie is a SELECTION, not an authorisation. Forging it names a
    // company; it does not confer a role on one.
    const res = await dashboardApp(STRANGER, requireOwner()).request('/x', withCompany);
    expect(res.status).toBe(403);
  });

  it('refuses a member a capability their membership does not carry', async () => {
    // There is one company authorization model now. `account_roles` held a
    // second one that nothing ever wrote to, so the guards were reading an
    // always-empty table; membership in `team_members` is what the invite flow
    // writes and what these now ask.
    await query(
      `INSERT INTO team_members
         (id, product_id, founder_id, role, status, can_view_decisions, can_manage_company)
       VALUES ('rb_tm', ?, ?, 'investor_observer', 'active', 1, 0)`, [PRODUCT, MEMBER]);
    const res = await dashboardApp(MEMBER, requireCompanyCapability('can_manage_company'))
      .request('/x', withCompany);
    expect(res.status).toBe(403);
  });

  it('admits that member to a capability they do carry', async () => {
    const res = await dashboardApp(MEMBER, requireCompanyCapability('can_view_decisions'))
      .request('/x', withCompany);
    expect(res.status).toBe(200);
  });

  it('refuses a member at the ownership boundary, whatever they carry', async () => {
    // Ownership is not the top of the ladder. Nothing grants it.
    await query(
      `UPDATE team_members SET can_manage_company = 1 WHERE id = 'rb_tm'`);
    const res = await dashboardApp(MEMBER, requireOwner()).request('/x', withCompany);
    expect(res.status).toBe(403);
  });

  it('refuses an unauthenticated request', async () => {
    const res = await dashboardApp(null, requireCompanyCapability('can_view_decisions')).request('/x', withCompany);
    expect(res.status).toBe(401);
  });

  it('says so plainly when no company is selected', async () => {
    // Distinguishable from "not signed in": the caller is known, the company is
    // not. Returning 401 for both is what hid the original defect.
    const res = await dashboardApp(OWNER, requireOwner()).request('/x', { method: 'POST' });
    expect(res.status).toBe(400);
  });
});

// =============================================================================
// §2: transport, principal and authority are three things. These are the
// adversarial cases — what must NOT be able to satisfy a human role check, and
// what must not be granted by one.
// =============================================================================

describe('one principal per request, and no borrowing between kinds', () => {
  function withPrincipal(principal: unknown, guard: Parameters<Hono['use']>[1]) {
    const app = new Hono();
    app.use('*', async (c, next) => {
      if (principal) c.set('principal' as never, principal as never);
      await next();
    });
    app.post('/x', guard, (c) => c.json({ ok: true }));
    return app;
  }

  it('refuses an ingest credential at a human role check', async () => {
    const res = await withPrincipal(
      { kind: 'ingest', credentialId: 'ic_1', productId: PRODUCT, purpose: 'metrics' },
      requireCompanyCapability('can_view_decisions')).request('/x', withCompany);
    expect(res.status).toBe(401);
  });

  it('refuses a service principal at a human role check', async () => {
    // A job acting for a company is not a person with a role. Its authority is
    // its declared capability, checked where that is checked.
    const res = await withPrincipal(
      { kind: 'service', service: 'scp_scheduler', capability: 'run_agents', productId: PRODUCT },
      requireCompanyCapability('can_view_decisions')).request('/x', withCompany);
    expect(res.status).toBe(401);
  });

  it('refuses an API-key principal even with every scope', async () => {
    // Scope is authority over the API surface. It is not a human role, and a
    // wildcard scope must not become one.
    const res = await withPrincipal(
      { kind: 'api_key', keyOwnerId: OWNER, productId: PRODUCT, scopes: ['*'] },
      requireOwner()).request('/x', withCompany);
    expect(res.status).toBe(401);
  });

  it('refuses a non-human principal even when it happens to carry a founder id', async () => {
    // The kind is what the guard must read, not the shape. Today an
    // ApiKeyPrincipal has no `founderId` field, so dropping the kind check
    // still refuses — by accident. If a future field ever names a founder on a
    // credential principal, that accident stops holding and this case is what
    // notices.
    const res = await withPrincipal(
      { kind: 'api_key', keyOwnerId: OWNER, founderId: OWNER, productId: PRODUCT, scopes: ['*'] },
      requireOwner()).request('/x', withCompany);
    expect(res.status, 'the discriminant decides, not the presence of a field')
      .toBe(401);
  });

  it('refuses a request carrying two mechanisms at once', async () => {
    // Session cookie AND API key. Picking the stronger is how escalation by
    // header stuffing works; two principals is not a principal.
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('founder' as never, { id: OWNER } as never);
      c.set('userId' as never, OWNER as never);
      c.set('productId' as never, PRODUCT as never);
      await next();
    });
    app.post('/x', requireOwner(), (c) => c.json({ ok: true }));
    const res = await app.request('/x', withCompany);
    expect(res.status, 'ambiguity fails closed').toBe(401);
  });

  it('gives a founder session no API scopes', async () => {
    // The other direction: being the owner does not mint credentials. A human
    // session carries no scopes at all, so a scope check cannot pass on one.
    const { principalOf } = await import('../../src/middleware/principal.js');
    const app = new Hono();
    let seen: unknown = null;
    app.use('*', async (c, next) => {
      c.set('founder' as never, { id: OWNER } as never);
      seen = principalOf(c);
      await next();
    });
    app.post('/x', (c) => c.json({ ok: true }));
    await app.request('/x', { method: 'POST' });
    expect((seen as Record<string, unknown>).kind).toBe('human_session');
    expect(seen).not.toHaveProperty('scopes');
  });

  it('fails closed on no principal at all', async () => {
    const res = await withPrincipal(null, requireCompanyCapability('can_view_decisions')).request('/x', withCompany);
    expect(res.status).toBe(401);
  });
});
