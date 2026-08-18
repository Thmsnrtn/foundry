// =============================================================================
// Tests: the doors that grant authority and dispatch effects ask who is asking
//
// Batch 51 gave `team_members`' permission columns their first readers, and
// batch 52 made membership the thing that makes a company VISIBLE. Together
// those turned a decorative permission into a live one — and left a gap that
// only exists because both landed: an accepted member can now reach every page
// of a company, and most mutating routes on those pages ask nothing.
//
// A scan of the dashboard found 116 mutating routes with no capability check.
// Most are ordinary company work an active member should be able to do. These
// are the ones that are not:
//
//   granting authority   agent authority level, assisting-authority grants,
//                        connection grants, and the autopilot dial — which,
//                        raised to 'act', RECORDS A CONSENT in the founder's
//                        name and is the single grant the whole autonomy stack
//                        reads
//   dispatching effects  the digest send, the letter reply send, the second
//                        approval surface for integration actions
//   erasure              scheduling deletion of the selected company
//   credentials          storing a third-party key against the company
//
// The observer role exists to watch. It must not vote, must not affect
// alignment, must not grant authority, must not execute effects.
//
// WHAT IS DELIBERATELY LEFT OPEN, and asserted here so it stays open: every
// route that only LOWERS what Foundry may do — panic, revoke, disconnect. A
// guard that refuses the legitimate principal is not extra secure. Making the
// emergency stop harder to reach than the accelerator would be the same defect
// wearing a safety label.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { nanoid } from 'nanoid';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

const OWNER = 'ad_owner';
const MANAGER = 'ad_manager';   // co-founder: manages and triggers
const OBSERVER = 'ad_observer'; // watches only
const P = 'ad_product';

let app: Hono;

/** The dashboard identifies the acting human through `c.get('founder')`, and
 *  the selected company through the `foundry_product` cookie. Both are what
 *  the real middleware sets; the guard resolves the principal from them. */
function as(founder: string) {
  return {
    'x-founder': founder,
    cookie: `foundry_product=${P}`,
    'content-type': 'application/x-www-form-urlencoded',
  };
}

async function post(path: string, founder: string, fields: Record<string, string> = {}) {
  return app.request(path, {
    method: 'POST', headers: as(founder), body: new URLSearchParams(fields),
  });
}

beforeAll(async () => {
  await runMigrations();
  for (const id of [OWNER, MANAGER, OBSERVER]) {
    await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
      [id, `clerk_${id}`, `${id}@test.local`]);
  }
  await query(
    `INSERT INTO products (id, name, owner_id, status, scp_status)
     VALUES (?, 'Authority Co', ?, 'active', 'active')`, [P, OWNER]);
  await query(
    `INSERT INTO team_members
       (id, product_id, founder_id, role, status,
        can_view_decisions, can_vote_decisions, can_trigger_actions, can_manage_company)
     VALUES (?, ?, ?, 'co_founder', 'active', 1, 1, 1, 1)`,
    [nanoid(), P, MANAGER]);
  await query(
    `INSERT INTO team_members
       (id, product_id, founder_id, role, status,
        can_view_decisions, can_vote_decisions, can_trigger_actions, can_manage_company)
     VALUES (?, ?, ?, 'investor_observer', 'active', 1, 0, 0, 0)`,
    [nanoid(), P, OBSERVER]);
  await query(
    `INSERT INTO agent_instances (id, product_id, agent_name, display_name, authority_level, version)
     VALUES (?, ?, 'atlas', 'Atlas', 0, 1)`, [nanoid(), P]);

  const [{ agentRoutes }, { letterRoutes }, { ambientRoutes }, { privacySettings },
    { agentExperimentRoutes }, { memoryGraph }, { connectionRoutes }] = await Promise.all([
      import('../../src/routes/dashboard/agents.js'),
      import('../../src/routes/dashboard/letter.js'),
      import('../../src/routes/dashboard/ambient.js'),
      import('../../src/routes/dashboard/privacy.js'),
      import('../../src/routes/dashboard/agents-experiments.js'),
      import('../../src/routes/dashboard/memory.js'),
      import('../../src/routes/dashboard/connections.js'),
    ]);

  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never, { id: c.req.header('x-founder') ?? OWNER } as never);
    c.set('csrfToken' as never, 'test' as never);
    await next();
  });
  app.route('/agents', agentRoutes);
  app.route('/', letterRoutes);
  app.route('/', ambientRoutes);
  app.route('/', privacySettings);
  app.route('/', agentExperimentRoutes);
  app.route('/', memoryGraph);
  app.route('/', connectionRoutes);
});

// A refusal is a 403 from the guard; anything else means the request reached
// the handler. Testing "not 403" rather than "302" keeps the assertion about
// the guard rather than about where each handler happens to redirect.
const REFUSED = 403;

describe('granting authority asks who is granting it', () => {
  it('refuses an observer setting an agent authority level', async () => {
    const res = await post('/agents/atlas/authority', OBSERVER, { level: '2' });
    expect(res.status).toBe(REFUSED);
    const row = (await query(
      `SELECT authority_level FROM agent_instances WHERE product_id = ?`, [P]))
      .rows[0] as Record<string, unknown>;
    expect(Number(row.authority_level), 'and nothing moved').toBe(0);
  });

  it('admits the co-founder who holds can_manage_company', async () => {
    const res = await post('/agents/atlas/authority', MANAGER, { level: '1' });
    expect(res.status).not.toBe(REFUSED);
    const row = (await query(
      `SELECT authority_level FROM agent_instances WHERE product_id = ?`, [P]))
      .rows[0] as Record<string, unknown>;
    expect(Number(row.authority_level)).toBe(1);
  });

  it('refuses an observer raising the autopilot dial', async () => {
    // The dial at 'act' records a consent in the acting founder's name. It is
    // the single grant the autopilot tick, the departments and the standing
    // orders all read.
    const res = await post('/autopilot/policy', OBSERVER,
      { category: 'customer_success', mode: 'act' });
    expect(res.status).toBe(REFUSED);
    const rows = await query(
      `SELECT mode FROM autopilot_policies WHERE product_id = ? AND category = ?`,
      [P, 'customer_success']);
    expect(rows.rows, 'no policy row, and no consent behind it').toHaveLength(0);
    const consents = await query(
      `SELECT id FROM autonomy_consents WHERE product_id = ?`, [P]);
    expect(consents.rows).toHaveLength(0);
  });

  it('admits the co-founder raising it, and records the consent behind it', async () => {
    const res = await post('/autopilot/policy', MANAGER,
      { category: 'customer_success', mode: 'act' });
    expect(res.status).not.toBe(REFUSED);
    const consents = (await query(
      `SELECT founder_id, to_mode FROM autonomy_consents WHERE product_id = ?`, [P]))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(consents).toHaveLength(1);
    expect(consents[0].founder_id, 'the consent names who actually gave it').toBe(MANAGER);
  });
});

describe('dispatching an effect asks who is dispatching it', () => {
  it('refuses an observer sending the company digest', async () => {
    const res = await post('/ambient/email/send', OBSERVER, { email: 'anywhere@example.com' });
    expect(res.status).toBe(REFUSED);
  });

  it('admits a member who holds can_trigger_actions', async () => {
    const res = await post('/ambient/email/send', MANAGER, { email: 'ok@example.com' });
    expect(res.status).not.toBe(REFUSED);
  });
});

describe('erasure is the exceptional boundary, not a capability', () => {
  it('refuses an observer', async () => {
    const res = await post('/privacy/delete', OBSERVER);
    expect(res.status).toBe(REFUSED);
  });

  it('refuses even a co-founder who holds every capability', async () => {
    // can_manage_company is ordinary company work. Erasing the company is not
    // ordinary company work, and nothing grants it.
    const res = await post('/privacy/delete', MANAGER);
    expect(res.status).toBe(REFUSED);
  });

  it('admits the owner', async () => {
    const res = await post('/privacy/delete', OWNER);
    expect(res.status).not.toBe(REFUSED);
  });
});

describe('the emergency stop stays reachable', () => {
  it('lets an observer pull the panic switch', async () => {
    // Panic only ever LOWERS autonomy. Gating it would make the brake harder
    // to reach than the accelerator — the same defect wearing a safety label.
    const res = await post('/autopilot/panic', OBSERVER);
    expect(res.status).not.toBe(REFUSED);
  });

  it('does not extend that to withdrawing an authority grant', async () => {
    // Taking authority back is still authority management, and it answers to
    // the same permission as giving it. The panic switch above is the
    // universal brake, so nobody is left without a way to stop the machine.
    const res = await post('/letter/responsibilities/nonexistent/permission/revoke', OBSERVER);
    expect(res.status).toBe(REFUSED);
  });
});

// ── the guard and the handler must name the same company ────────────────────

describe('the guard resolves the company the handler will act on', () => {
  it('does not refuse a founder whose browser has not set the selection cookie', async () => {
    // `getLayoutContext` resolves: explicit override, then the cookie, then the
    // first company this person can see. The guard stopped at the cookie, so a
    // fresh session, a client that drops it, or a direct POST got "No company
    // selected" on a route whose handler would have worked. A guard that
    // refuses the legitimate principal is not extra secure.
    const res = await app.request('/privacy/delete', {
      method: 'POST',
      headers: { 'x-founder': OWNER, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({}),
    });
    expect(res.status).not.toBe(400);
    expect(res.status).not.toBe(REFUSED);
  });

  it('ignores a cookie naming a company the caller cannot see', async () => {
    // The selection is a SELECTION, not an authorisation. An unreachable id
    // falls back exactly as the handler falls back, so the two cannot act on
    // different companies.
    const res = await app.request('/privacy/delete', {
      method: 'POST',
      headers: {
        'x-founder': OWNER, cookie: 'foundry_product=someone_elses_company',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({}),
    });
    expect(res.status).not.toBe(REFUSED);
  });

  it('reads the company named in the path when the route names one', async () => {
    const { actingSubject } = await import('../../src/middleware/rbac.js');
    const fake = {
      get: (k: string) => (k === 'founder' ? { id: OBSERVER } : undefined),
      req: {
        routePath: '/products/:id/revenue',
        param: (n: string) => (n === 'id' ? 'named_co' : undefined),
        raw: new Request('http://x/products/named_co/revenue', {
          headers: { cookie: `foundry_product=${P}` },
        }),
      },
    };
    const subject = await actingSubject(fake);
    expect(subject.productId,
      'the guard must ask about the company the handler will serve, not the cookie')
      .toBe('named_co');
  });
});

describe('an experiment runs on real customers, so it asks too', () => {
  it('refuses an observer starting one', async () => {
    const res = await post(`/products/${P}/agents/experiments/exp_x/start`, OBSERVER);
    expect(res.status).toBe(REFUSED);
  });

  it('admits a member who holds can_trigger_actions', async () => {
    // And the guard reads the company from the PATH here, not the cookie —
    // these handlers serve `:id`, so anything else would authorize one company
    // and act on another.
    const res = await post(`/products/${P}/agents/experiments/exp_x/start`, MANAGER);
    expect(res.status).not.toBe(REFUSED);
  });

  it('refuses a member of a different company naming this one in the path', async () => {
    const res = await post(`/products/${P}/agents/experiments/exp_x/start`, 'nobody_at_all');
    expect(res.status).toBe(REFUSED);
  });
});

// ── spending the company's money is not watching ────────────────────────────

describe('a paid model run asks who may spend', () => {
  // ~54 mutating routes reached a paid model call with no capability check at
  // all: every /synthesize, /generate, /scan, /assess, the institution chat,
  // voice transcription, the weekly brief. Any active member — an investor
  // observer included — could spend the company's AI budget by pressing a
  // button. Three representative doors, one per shape.
  for (const path of ['/memory/archaeology', '/memory/counterfactuals', '/ambient/audio/generate']) {
    it(`refuses an observer at ${path}`, async () => {
      expect((await post(path, OBSERVER)).status).toBe(REFUSED);
    });

    it(`admits a member who holds can_trigger_actions at ${path}`, async () => {
      expect((await post(path, MANAGER)).status).not.toBe(REFUSED);
    });
  }
});

describe('and the brake stays easier to reach than the accelerator', () => {
  // Every route that only LOWERS what Foundry may do stays open. Asserted so a
  // future sweep does not quietly take them with it.
  for (const path of ['/autopilot/panic', '/connections/mailer/disconnect',
    '/connections/grants/nonexistent/revoke']) {
    it(`leaves ${path} reachable by an observer`, async () => {
      expect((await post(path, OBSERVER)).status).not.toBe(REFUSED);
    });
  }
});
