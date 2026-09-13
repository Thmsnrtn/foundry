process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { approveAction, rejectAction } from '../../src/services/outbound/executor.js';

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
// the approver for every approval by every founder of every company. The page
// verified ownership properly and then threw away who it verified. That is the
// same fiction as a consent ledger recording a mode nobody was ever in: the
// field that exists to make an authorisation attributable, not attributed.
//
// That page was part of the Commercial Foundry surface and is gone, and its
// rendering of the approver went with it. The fix did not live in the page: it
// is that `approveAction` and `rejectAction` REFUSE an approver that is not a
// principal reference, so no caller — a page, a job, a future door — can write
// a role where a person belongs. That is what is asserted below, one level
// under where the defect was found.
// =============================================================================

const P = 'wa_product';
const OWNER = 'wa_owner';

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
  async function pending(id: string): Promise<void> {
    await query(
      `INSERT INTO outbound_actions
         (id,product_id,agent_name,integration_name,action_type,authority_level,status,
          parameters_json,preview_text,rationale)
       VALUES (?,?,'beacon','slack','post_message',2,'pending_approval','{}','p','r')`,
      [id, P]);
  }

  it('records the person who approved it, not the word ceo', async () => {
    await pending('wa_approve');
    // Slack has no executor registered, so the dispatch itself refuses rather
    // than claiming a post it did not make — that refusal is its own test
    // elsewhere. WHO APPROVED is written before any of that and survives it,
    // which is the point: the authorisation is attributable even when the thing
    // it authorised could not be carried out.
    await expect(approveAction('wa_approve', `founder:${OWNER}`))
      .rejects.toThrow(/No executor registered/);

    const row = (await query('SELECT status, approved_by FROM outbound_actions WHERE id=?', ['wa_approve']))
      .rows[0] as Record<string, unknown>;
    // A principal reference, in the same vocabulary as `institution:assisting`
    // and `autopilot:<category>` — this column already held prefixed principals
    // and a bare id would have been the odd one out.
    expect(row.approved_by).toBe(`founder:${OWNER}`);
    expect(row.status, 'and the record says it did not go out').toBe('failed');
  });

  it('refuses a role where a person belongs, rather than storing it', async () => {
    // THE ORIGINAL DEFECT, ASSERTED AT THE DOOR THAT LET IT THROUGH. 'ceo' is
    // not a principal: nobody can be held to it. The old code passed exactly
    // this string and it was written for every founder of every company.
    await pending('wa_ceo');
    await expect(approveAction('wa_ceo', 'ceo'))
      .rejects.toThrow(/not a principal reference/);
    const row = (await query('SELECT status, approved_by FROM outbound_actions WHERE id=?', ['wa_ceo']))
      .rows[0] as Record<string, unknown>;
    expect(row.status, 'and the action did not go out anyway').toBe('pending_approval');
    expect(row.approved_by).toBeNull();
  });

  it('records the person who rejected it too, and no invented reason', async () => {
    await pending('wa_reject');
    await rejectAction('wa_reject', `founder:${OWNER}`);

    const row = (await query(
      'SELECT approved_by,feedback_data_json FROM outbound_actions WHERE id=?', ['wa_reject']))
      .rows[0] as Record<string, unknown>;
    expect(row.approved_by).toBe(`founder:${OWNER}`);
    // "Rejected by CEO" attributed a reason to a role nobody holds. Silence is
    // silence.
    expect(String(row.feedback_data_json)).not.toContain('CEO');
  });

  it('refuses a role on the rejection side as well', async () => {
    await pending('wa_reject_ceo');
    await expect(rejectAction('wa_reject_ceo', 'ceo'))
      .rejects.toThrow(/not a principal reference/);
    expect((await query('SELECT status FROM outbound_actions WHERE id=?', ['wa_reject_ceo']))
      .rows[0] as Record<string, unknown>).toMatchObject({ status: 'pending_approval' });
  });
});
