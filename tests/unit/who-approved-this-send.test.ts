process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// AN OUTBOUND ACTION MAY NOT BE BORN APPROVED, AND ITS APPROVER IS A PERSON.
//
// Two things met on the legacy outbound path.
//
// FIRST: `proposeAction` writes `status='approved'` when the caller passes
// `authorityLevel === 0`, and executes it there and then. Agents reach this
// with a level taken from their own model output. It is contained today only
// because `integrationName` is set to the AGENT'S name, so `executeAction`
// falls through to its log-only branch and never reaches a real integration —
// an accident of one parameter, holding up the outbound boundary. `queueEmail`
// was the same door with `integrationName` hard-coded to 'resend', and it was
// deleted rather than guarded.
//
// SECOND: `approveAction(actionId, 'ceo')` recorded the literal string 'ceo' as
// the approver for every approval by every founder of every company. The route
// verifies ownership properly and then throws away who it verified. That is the
// same fiction as a consent ledger recording a mode nobody was ever in: the
// field that exists to make an authorisation attributable, not attributed.
// =============================================================================

const P = 'wa_product';
const OWNER = 'wa_owner';
let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email,tier) VALUES (?,'wa_c','o@example.com','growth')`, [OWNER]);
  await query(`INSERT INTO products (id,name,owner_id,status) VALUES (?,'Fold Street Dance',?,'active')`, [P, OWNER]);
});

describe('an outbound action for a real integration', () => {
  it('cannot be born approved', async () => {
    // The exact shape `queueEmail` produced and `proposeAction` would produce
    // if anyone passed a real integration name with authority level zero.
    await expect(query(
      `INSERT INTO outbound_actions
         (id,product_id,agent_name,integration_name,action_type,authority_level,status,
          parameters_json,preview_text,rationale)
       VALUES ('wa_born',?,'beacon','resend','send_email',0,'approved','{}','p','r')`,
      [P])).rejects.toThrow(/outbound_action:born_approved/);
  });

  it('is fine when it is born waiting for a person', async () => {
    await query(
      `INSERT INTO outbound_actions
         (id,product_id,agent_name,integration_name,action_type,authority_level,status,
          parameters_json,preview_text,rationale)
       VALUES ('wa_pending',?,'beacon','resend','send_email',2,'pending_approval','{}','p','r')`,
      [P]);
    expect((await query("SELECT status FROM outbound_actions WHERE id='wa_born'")).rows).toHaveLength(0);
  });

  it('is fine when the institution plans it, because that carries a responsibility', async () => {
    // The governed path writes `approved` at birth and is allowed to: the
    // responsibility, the exact consent and the scope are all checked by
    // `assisted_action_plan_guard` in the same insert.
    const guard = (await query(
      "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='outbound_action_birth_guard'"))
      .rows[0] as Record<string, unknown>;
    expect(String(guard.sql)).toContain('responsibility_id IS NULL');
  });
});

describe('approving an action', () => {
  beforeAll(async () => {
    const { agentIntegrationRoutes } = await import('../../src/routes/dashboard/agents-integrations.js');
    app = new Hono();
    app.use('*', async (c, next) => {
      c.set('founder' as never,
        { id: OWNER, email: 'o@example.com', tier: 'growth', preferences: {} } as never);
      c.set('csrfToken' as never, 't' as never);
      await next();
    });
    app.route('/', agentIntegrationRoutes);
  });

  it('records the person who rejected it too, and no invented reason', async () => {
    await query(
      `INSERT INTO outbound_actions
         (id,product_id,agent_name,integration_name,action_type,authority_level,status,
          parameters_json,preview_text,rationale)
       VALUES ('wa_reject',?,'beacon','slack','post_message',2,'pending_approval','{}','p','r')`,
      [P]);
    const res = await app.request('/agents/integrations/actions/wa_reject/reject', { method: 'POST' });
    expect([200, 302]).toContain(res.status);
    const row = (await query(
      'SELECT approved_by,feedback_data_json FROM outbound_actions WHERE id=?', ['wa_reject']))
      .rows[0] as Record<string, unknown>;
    expect(row.approved_by).toBe(OWNER);
    // "Rejected by CEO" attributed a reason to a role nobody holds. Silence is
    // silence.
    expect(String(row.feedback_data_json)).not.toContain('CEO');
  });

  it('records the person who approved it, not the word ceo', async () => {
    await query(
      `INSERT INTO outbound_actions
         (id,product_id,agent_name,integration_name,action_type,authority_level,status,
          parameters_json,preview_text,rationale)
       VALUES ('wa_approve',?,'beacon','slack','post_message',2,'pending_approval','{}','p','r')`,
      [P]);

    const res = await app.request('/agents/integrations/actions/wa_approve/approve', { method: 'POST' });
    expect([200, 302]).toContain(res.status);

    const row = (await query('SELECT approved_by FROM outbound_actions WHERE id=?', ['wa_approve']))
      .rows[0] as Record<string, unknown>;
    expect(row.approved_by).toBe(OWNER);
  });
});
