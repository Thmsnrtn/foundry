// =============================================================================
// Tests: three doors resolve a decision, and none of them asked who was asking
//
// Resolving a decision is the institution's central act. `can_vote_decisions`
// is the permission that exists to say who has a say in one. The two never met.
//
//   POST /decisions/:id/resolve   scoped `p.owner_id = ?`, no capability check.
//                                 A co-founder holding the permission could not
//                                 resolve; the permission answered nothing.
//   foundry_resolve_decision      an MCP client through an API key. The
//                                 transport proved the scope and that Foundry
//                                 may act for the company — neither answers
//                                 whether the key's ISSUER may decide for it.
//   runAutopilotTick              governed by the ladder, the platform cap and
//                                 the consent ledger. This one was fine.
//
// And every human door wrote the same four letters. `decisions.decided_by`
// holds a KIND — 'founder' or 'second_self' — and must keep holding one: the
// shadow ledger measures agreement on founder-decided rows, and demotion fires
// only on autopilot-decided ones. So a company with three founders recorded
// 'founder' for all of them, and the record of its most consequential act named
// a category rather than a person. Migration 153 puts the identity beside the
// kind instead of inside it.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { nanoid } from 'nanoid';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { executeLoopTool } from '../../src/mcp/loop-tools.js';

const OWNER = 'dr_owner';
const VOTER = 'dr_voter';       // co-founder who has a say
const OBSERVER = 'dr_observer'; // watches only
const P = 'dr_product';

let app: Hono;

async function pendingDecision(): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO decisions (id, product_id, what, why_now, category, gate, status)
     VALUES (?, ?, 'Ship or hold', 'The window closes Friday', 'strategic', 1, 'pending')`,
    [id, P]);
  return id;
}

async function decisionRow(id: string): Promise<Record<string, unknown>> {
  return (await query(
    `SELECT status, decided_by, decided_by_founder_id FROM decisions WHERE id = ?`, [id]))
    .rows[0] as Record<string, unknown>;
}

function resolveAs(founder: string, id: string) {
  return app.request(`/decisions/${id}/resolve`, {
    method: 'POST',
    headers: {
      'x-founder': founder, cookie: `foundry_product=${P}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ chosen_option: 'Ship' }),
  });
}

beforeAll(async () => {
  await runMigrations();
  for (const id of [OWNER, VOTER, OBSERVER]) {
    await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
      [id, `clerk_${id}`, `${id}@test.local`]);
  }
  await query(
    `INSERT INTO products (id, name, owner_id, status, scp_status)
     VALUES (?, 'Decision Co', ?, 'active', 'active')`, [P, OWNER]);
  await query(
    `INSERT INTO team_members (id, product_id, founder_id, role, status,
       can_view_decisions, can_vote_decisions)
     VALUES (?, ?, ?, 'co_founder', 'active', 1, 1)`, [nanoid(), P, VOTER]);
  await query(
    `INSERT INTO team_members (id, product_id, founder_id, role, status,
       can_view_decisions, can_vote_decisions)
     VALUES (?, ?, ?, 'investor_observer', 'active', 1, 0)`, [nanoid(), P, OBSERVER]);

  const { decisionRoutes } = await import('../../src/routes/dashboard/decisions.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never, { id: c.req.header('x-founder') ?? OWNER } as never);
    c.set('csrfToken' as never, 'test' as never);
    await next();
  });
  app.route('/', decisionRoutes);
});

beforeEach(async () => {
  await query('DELETE FROM decisions WHERE product_id = ?', [P]);
});

describe('the dashboard door asks who has a say', () => {
  it('refuses an observer', async () => {
    const id = await pendingDecision();
    const res = await resolveAs(OBSERVER, id);
    expect(res.status).toBe(403);
    expect((await decisionRow(id)).status, 'and nothing was decided').toBe('pending');
  });

  it('admits a co-founder who holds the vote', async () => {
    // The defect this replaces: `p.owner_id = ?`. The permission that exists to
    // say who has a say in a decision was not what decided who could resolve
    // one — a guard that refuses the legitimate principal is not extra secure.
    const id = await pendingDecision();
    const res = await resolveAs(VOTER, id);
    expect(res.status).toBe(200);
    expect((await decisionRow(id)).status).toBe('approved');
  });

  it('records WHICH founder resolved it, beside the kind', async () => {
    const id = await pendingDecision();
    await resolveAs(VOTER, id);
    const row = await decisionRow(id);
    expect(row.decided_by, 'the kind stays a kind — the shadow ledger reads it').toBe('founder');
    expect(row.decided_by_founder_id, 'and the person is on the record too').toBe(VOTER);
  });

  it('does not resolve a decision belonging to another company', async () => {
    const stranger = nanoid();
    await query(
      `INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
      [stranger, `clerk_${stranger}`, `${stranger}@x.com`]);
    await query(
      `INSERT INTO products (id, name, owner_id, status) VALUES (?, 'Other', ?, 'active')`,
      [`p_${stranger}`, stranger]);
    const foreign = nanoid();
    await query(
      `INSERT INTO decisions (id, product_id, what, why_now, category, gate, status)
       VALUES (?, ?, 'Theirs', 'Now', 'strategic', 1, 'pending')`,
      [foreign, `p_${stranger}`]);

    const res = await resolveAs(VOTER, foreign);
    expect(res.status).toBe(404);
    expect((await decisionRow(foreign)).status).toBe('pending');
  });
});

describe('the MCP door asks the same question of the key issuer', () => {
  it("refuses a key whose issuer has no say", async () => {
    const id = await pendingDecision();
    const result = await executeLoopTool(
      'foundry_resolve_decision',
      { decision_id: id, chosen_option: 'Ship' },
      { productId: P, founderId: OBSERVER });
    expect(result.content[0]?.text).toMatch(/^Error/);
    expect((await decisionRow(id)).status).toBe('pending');
  });

  it('refuses a key with no issuer on record', async () => {
    // `api_keys.created_by` can be empty. Nobody holds a permission, so absence
    // must not read as consent.
    const id = await pendingDecision();
    await executeLoopTool(
      'foundry_resolve_decision',
      { decision_id: id, chosen_option: 'Ship' },
      { productId: P, founderId: '' });
    expect((await decisionRow(id)).status).toBe('pending');
  });

  it('admits a key issued by someone who does, and names them', async () => {
    const id = await pendingDecision();
    const result = await executeLoopTool(
      'foundry_resolve_decision',
      { decision_id: id, chosen_option: 'Ship' },
      { productId: P, founderId: VOTER });
    expect(result.content[0]?.text).not.toMatch(/^Error/);
    const row = await decisionRow(id);
    expect(row.status).toBe('approved');
    expect(row.decided_by_founder_id).toBe(VOTER);
  });
});

describe('the autopilot door stays a kind with no person behind it', () => {
  it('leaves the resolver null rather than naming the owner', async () => {
    // NULL means "not recorded". A row the machine decided has no human
    // resolver, and writing the owner's id there would manufacture one.
    const { resolveDecision } = await import('../../src/services/decisions/queue.js');
    const id = await pendingDecision();
    await resolveDecision(id, P, 'Ship', 'second_self');
    const row = await decisionRow(id);
    expect(row.decided_by).toBe('second_self');
    expect(row.decided_by_founder_id).toBeNull();
  });
});

// ── the vocabulary the schema comment got wrong ─────────────────────────────

describe('decided_by holds only values something writes', () => {
  it('refuses a decider that has never existed', async () => {
    // Migration 001's comment named the vocabulary as "founder, system_gate_0,
    // system_gate_1". Two of those three have never been written by anything —
    // and the comment was not inert: the Letter asked for `decided_by IN
    // ('system_gate_0','second_self')`, so half of "what Foundry handled for
    // you" was a term that cannot match. It survived review because the schema
    // said it was real. A comment is not a vocabulary.
    const id = await pendingDecision();
    // check-vocabulary:expected-refusal
    await expect(query(
      `UPDATE decisions SET decided_by = 'system_gate_0' WHERE id = ?`, [id]))
      .rejects.toThrow(/CHECK/i);
  });

  it('accepts both values that are written', async () => {
    const a = await pendingDecision();
    const b = await pendingDecision();
    const { resolveDecision } = await import('../../src/services/decisions/queue.js');
    await resolveDecision(a, P, 'Ship', 'founder', OWNER);
    await resolveDecision(b, P, 'Ship', 'second_self');
    expect((await decisionRow(a)).decided_by).toBe('founder');
    expect((await decisionRow(b)).decided_by).toBe('second_self');
  });

  it('leaves a pending decision undecided rather than inventing a decider', async () => {
    // NULL is permitted on purpose: a pending decision has not been decided by
    // anybody, and an undo sets it back to NULL deliberately.
    const id = await pendingDecision();
    expect((await decisionRow(id)).decided_by).toBeNull();
  });

  it('is not read anywhere with a value nothing writes', async () => {
    const { readdirSync, readFileSync, statSync } = await import('fs');
    const { join } = await import('path');
    const walk = (d: string): string[] => readdirSync(d).flatMap((e) => {
      const p = join(d, e);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });
    for (const file of walk('src')) {
      const src = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
      expect(src, file).not.toMatch(/system_gate_[01]/);
    }
  });
});
