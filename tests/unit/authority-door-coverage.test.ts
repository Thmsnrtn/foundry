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
//   granting authority   assisting-authority grants, connection grants, and the
//                        autopilot dial — which, raised to 'act', RECORDS A
//                        CONSENT in the founder's name and is the single grant
//                        the whole autonomy stack reads
//   dispatching effects  the letter reply send
//   spending             any door that reaches a paid model call
//   erasure              scheduling deletion of the selected company
//
// The Commercial Foundry surface is gone and took several of the doors this
// file used to exercise with it — the agent authority dial, the digest send, the
// agent-experiment start, the memory pages that each opened with a paid model
// call. Their guards went with the handlers they guarded. Every category above
// still has at least one live door, and each is asserted against that door
// rather than against the deleted one, because the guarantee was never about
// any single URL: it is that an observer cannot grant, dispatch, spend or
// erase.
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
  const [{ letterRoutes }, { privacySettings }, { connectionRoutes }] =
    await Promise.all([
      import('../../src/routes/dashboard/letter.js'),
      import('../../src/routes/dashboard/privacy.js'),
      import('../../src/routes/dashboard/connections.js'),
    ]);

  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never, { id: c.req.header('x-founder') ?? OWNER } as never);
    c.set('csrfToken' as never, 'test' as never);
    await next();
  });
  app.route('/', letterRoutes);
  app.route('/', privacySettings);
  app.route('/', connectionRoutes);
});

// A refusal is a 403 from the guard; anything else means the request reached
// the handler. Testing "not 403" rather than "302" keeps the assertion about
// the guard rather than about where each handler happens to redirect.
const REFUSED = 403;

describe('granting authority asks who is granting it', () => {
  // THE DOOR THIS USED TO ASK ABOUT IS RETIRED, AND THE CATEGORY IS NOT.
  //
  // It was the per-category autopilot dial, which at 'act' recorded a consent
  // in the acting founder's name. Every one of its twelve policy rows in
  // production sits at watching, no owner ever moved one, and the only code
  // that reads such a grant is off the timer — so the page and its POST are
  // gone. The guarantee was never about that URL: it is that an observer
  // cannot grant. The live granting doors are a standing permission on a
  // responsibility and a grant to a connected provider, and both are asked
  // here.
  it('refuses an observer granting a standing permission on a responsibility', async () => {
    const res = await post('/letter/responsibilities/nonexistent/permission/grant',
      OBSERVER, { days: '7' });
    expect(res.status).toBe(REFUSED);
    // Stopped by the guard, before the handler ever looked at what was asked.
    expect(await res.text()).toContain('Not permitted for your access to this company');
  });

  it('refuses an observer granting a connected provider something to do', async () => {
    const res = await post('/connections/grant', OBSERVER,
      { service: 'mailer', capability: 'send' });
    expect(res.status).toBe(REFUSED);
  });

  it('admits the co-founder at both', async () => {
    // Past the guard at each. What the handler then says about a
    // responsibility that does not exist, or a provider that is not connected,
    // is a different refusal and not what this test is about.
    // The permission door refuses a responsibility that does not exist, and
    // that refusal is also a 403 — so the BODY is what says which one answered.
    // The guard's refusal names the access; the handler's does not.
    const granted = await post('/letter/responsibilities/nonexistent/permission/grant',
      MANAGER, { days: '7' });
    expect(await granted.text()).toBe('Refused');
    expect((await post('/connections/grant', MANAGER,
      { service: 'mailer', capability: 'send' })).status).not.toBe(REFUSED);
  });
});

describe('dispatching an effect asks who is dispatching it', () => {
  // The letter reply send is the door that puts a message in front of a real
  // recipient. It is guarded, and then the handler checks ownership of the
  // action itself — so both refusals are 403 and the BODY is what says which
  // one answered. That distinction is the assertion: the observer is stopped by
  // the guard, the co-founder is not.
  const SEND = '/letter/replies/nonexistent/send';

  it('refuses an observer sending a letter reply', async () => {
    const res = await post(SEND, OBSERVER);
    expect(res.status).toBe(REFUSED);
    expect(await res.text()).toContain('Not permitted for your access to this company');
  });

  it('admits a member who holds can_trigger_actions', async () => {
    const res = await post(SEND, MANAGER);
    // Past the guard. The handler then refuses an action that is not theirs,
    // which is a different refusal and the one this test is not about.
    expect(await res.text()).toBe('Refused');
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

// ── spending the company's money is not watching ────────────────────────────

describe('a paid model run asks who may spend', () => {
  // ~54 mutating routes reached a paid model call with no capability check at
  // all: every /synthesize, /generate, /scan, /assess, the institution chat,
  // voice transcription, the weekly brief. Any active member — an investor
  // observer included — could spend the company's AI budget by pressing a
  // button.
  //
  // THERE IS NOW NO SUCH DOOR, WHICH IS A STRONGER GUARANTEE THAN GUARDING ONE.
  // The Commercial pages took most of them; the institution chat at `/talk` was
  // the last, and it is retired. Every model call this institution makes now
  // happens in a scheduled routine, under the ceilings, where no request from a
  // browser can start one.
  //
  // So the question moves from "who may press the button" to "is there a
  // button", asserted from the source rather than by guarding a URL — because
  // the failure to catch is somebody adding the fifty-fifth one, and a test
  // against a door that no longer exists could never see it.
  it('leaves no mutating route that reaches a model call at all', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join, resolve } = await import('node:path');
    const dir = resolve(import.meta.dirname, '../../src/routes');
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true })
      .flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
    const spenders = walk(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /\bcall(Opus|Sonnet|Haiku|Claude|ClaudeMultiTurn)\s*\(/
        .test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(dir.length + 1));
    expect(spenders, 'a route spends on a model — it needs a capability guard')
      .toEqual([]);
  });
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
