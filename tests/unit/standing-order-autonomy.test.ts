// =============================================================================
// Tests: a standing order is autonomy, and answers to the same authority
//
// `execution_playbooks.auto_execute` is a checkbox that said "no approval
// required" and meant it literally: the evaluator created an action_execution
// and approved it in the same breath, under the approver id `system:playbook`.
// It reached none of the machinery that governs every other autonomous act —
// the trust ladder, the platform cap, or the consent ledger whose own doc
// comment reads "the gate: no autonomous 'act' without this."
//
// So the three things a founder or operator does to stop Foundry acting on its
// own — turn the dial down, revoke consent, let a time-boxed grant lapse — all
// left a standing order sending exactly as before. The consent ledger existed,
// was believed by three call sites, and had no edge to a fourth.
//
// These tests bind the edge to the consequence: they assert on the STATUS OF
// THE EXECUTION ROW, not on whether a helper was called.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  autoExecuteVerdict,
  createExecutionPlaybook,
  deletePlaybook,
  evaluatePlaybooksForProduct,
  listExecutionPlaybooks,
  playbookCapability,
  togglePlaybook,
  PLAYBOOK_CATEGORY,
} from '../../src/services/scp/playbooks/execution-engine.js';

vi.mock('../../src/services/integration/slack.js', () => ({
  sendSlackNotification: vi.fn(async () => ({
    certainty: 'provider_acknowledged' as const, providerMessageTs: '1.0',
  })),
}));
const { sendSlackNotification: slackSpy } = await import('../../src/services/integration/slack.js') as
  { sendSlackNotification: ReturnType<typeof vi.fn> };

const OWNER = 'so_owner';
const MEMBER = 'so_member';
const STRANGER = 'so_stranger';
const P = 'so_product';
const OTHER = 'so_other_product';

/** A playbook whose condition is always met on the snapshot below. */
async function playbook(opts: {
  actionType?: string; autoExecute?: boolean; productId?: string;
} = {}): Promise<string> {
  return createExecutionPlaybook(opts.productId ?? P, {
    name: 'NPS alarm',
    description: null,
    trigger_type: 'metric_threshold',
    trigger_config: { logic: 'AND', conditions: [{ metric: 'nps', operator: 'lt', value: 50 }] },
    action_type: opts.actionType ?? 'post_slack',
    action_config: { integration: 'slack', channel: '#alerts', text: 'NPS dropped' },
    auto_execute: opts.autoExecute ?? true,
    execution_budget_weekly: null,
  });
}

async function grant(capability: string, opts: { expiresAt?: string | null } = {}): Promise<void> {
  await query(
    `INSERT INTO autonomy_consents
       (id, founder_id, product_id, capability, from_mode, to_mode,
        disclosure_version, expires_at)
     VALUES (?, ?, ?, ?, 'suggest', 'act', 'v1', ?)`,
    [nanoid(), OWNER, P, capability, opts.expiresAt ?? null]);
}

async function dial(capability: string, mode: string): Promise<void> {
  await query(
    `INSERT INTO autopilot_policies (id, product_id, category, mode, set_by)
     VALUES (?, ?, ?, ?, 'test')
     ON CONFLICT(product_id, category) DO UPDATE SET mode = excluded.mode`,
    [nanoid(), P, capability, mode]);
}

async function executions(): Promise<Array<Record<string, unknown>>> {
  return (await query(
    `SELECT status, approved_by FROM action_executions WHERE product_id = ?
      ORDER BY created_at`, [P])).rows as unknown as Array<Record<string, unknown>>;
}

async function triggerResults(): Promise<string[]> {
  return ((await query(
    `SELECT evaluation_result FROM playbook_trigger_log WHERE product_id = ?
      ORDER BY triggered_at`, [P])).rows as unknown as Array<{ evaluation_result: string }>)
    .map((r) => r.evaluation_result);
}

beforeAll(async () => {
  await runMigrations();
  for (const [id, email] of [[OWNER, 'so_owner@x.com'], [MEMBER, 'so_member@x.com'], [STRANGER, 'so_stranger@x.com']]) {
    await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`, [id, `clerk_${id}`, email]);
  }
  await query(
    `INSERT INTO products (id, name, owner_id, status, scp_status)
     VALUES (?, 'Standing Co', ?, 'active', 'active')`, [P, OWNER]);
  await query(
    `INSERT INTO products (id, name, owner_id, status, scp_status)
     VALUES (?, 'Other Co', ?, 'active', 'active')`, [OTHER, STRANGER]);
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, nps_score)
     VALUES (?, ?, date('now'), 10)`, [nanoid(), P]);
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, nps_score)
     VALUES (?, ?, date('now'), 10)`, [nanoid(), OTHER]);
});

beforeEach(async () => {
  slackSpy.mockClear();
  await query(`DELETE FROM playbook_trigger_log WHERE product_id IN (?, ?)`, [P, OTHER]);
  await query(`DELETE FROM execution_playbooks WHERE product_id IN (?, ?)`, [P, OTHER]);
  await query(`DELETE FROM action_executions WHERE product_id IN (?, ?)`, [P, OTHER]);
  await query(`DELETE FROM autonomy_consents WHERE product_id = ?`, [P]);
  await query(`DELETE FROM autopilot_policies WHERE product_id = ?`, [P]);
  await query(`DELETE FROM audit_log WHERE product_id = ?`, [P]);
});

// ── which authority a standing order spends ─────────────────────────────────

describe('a playbook names the capability it exercises', () => {
  it('treats anything that leaves the founder tools as outreach', () => {
    for (const t of ['send_email', 'schedule_call', 'custom_webhook', 'mcp_tool']) {
      expect(playbookCapability(t), t).toBe('outreach');
    }
  });

  it('keeps work inside the connected workspace on its own dial', () => {
    for (const t of ['post_slack', 'create_ticket', 'update_crm']) {
      expect(playbookCapability(t), t).toBe(PLAYBOOK_CATEGORY);
    }
  });

  it('treats an action type it has never seen as reaching out', () => {
    // A new integration is not trusted by virtue of being new. The default
    // must be the conservative side, or every future action type arrives
    // pre-authorized.
    expect(playbookCapability('teleport_customer')).toBe('outreach');
  });
});

// ── the verdict ──────────────────────────────────────────────────────────────

describe('the auto-execute verdict asks all three questions', () => {
  it('refuses when the dial has never been raised', async () => {
    const v = await autoExecuteVerdict(P, 'post_slack');
    expect(v.allowed).toBe(false);
  });

  it('refuses an act dial with no consent on record', async () => {
    await dial(PLAYBOOK_CATEGORY, 'act');
    const v = await autoExecuteVerdict(P, 'post_slack');
    expect(v.allowed).toBe(false);
    expect(v.allowed === false && v.reason).toMatch(/consent/i);
  });

  it('allows an act dial with a live consent', async () => {
    await dial(PLAYBOOK_CATEGORY, 'act');
    await grant(PLAYBOOK_CATEGORY);
    const v = await autoExecuteVerdict(P, 'post_slack');
    expect(v.allowed).toBe(true);
  });

  it('refuses once the grant has run out', async () => {
    await dial(PLAYBOOK_CATEGORY, 'act');
    await grant(PLAYBOOK_CATEGORY, { expiresAt: new Date(Date.now() - 3600_000).toISOString() });
    expect((await autoExecuteVerdict(P, 'post_slack')).allowed).toBe(false);
  });

  it('refuses once the grant is revoked', async () => {
    await dial(PLAYBOOK_CATEGORY, 'act');
    await grant(PLAYBOOK_CATEGORY);
    await query(
      `UPDATE autonomy_consents SET revoked_at = datetime('now') WHERE product_id = ?`, [P]);
    expect((await autoExecuteVerdict(P, 'post_slack')).allowed).toBe(false);
  });

  it('refuses outreach even with the dial at act and a live consent', async () => {
    // The platform cap is the operator-controlled ceiling, and a checkbox on a
    // customer-facing form does not get to raise it. This is the same rail the
    // outreach department already holds: no auto-send in v1.
    await dial('outreach', 'act');
    await grant('outreach');
    const v = await autoExecuteVerdict(P, 'send_email');
    expect(v.allowed).toBe(false);
    expect(v.allowed === false && v.reason).toMatch(/platform/i);
  });

  it('does not write while answering', async () => {
    // The list page renders the real ceiling from this. A page render that
    // writes is a page render that can be replayed into state.
    const before = (await query('SELECT COUNT(*) AS n FROM autopilot_policies WHERE product_id = ?', [P]))
      .rows[0] as Record<string, unknown>;
    await autoExecuteVerdict(P, 'post_slack');
    const after = (await query('SELECT COUNT(*) AS n FROM autopilot_policies WHERE product_id = ?', [P]))
      .rows[0] as Record<string, unknown>;
    expect(Number(after.n)).toBe(Number(before.n));
  });
});

// ── the consequence path ─────────────────────────────────────────────────────

describe('evaluation binds the verdict to the execution row', () => {
  it('leaves the action pending when consent is missing', async () => {
    await playbook();
    const r = await evaluatePlaybooksForProduct(P);
    expect(r.triggered).toBe(1);
    expect(r.held).toBe(1);
    const rows = await executions();
    expect(rows).toHaveLength(1);
    expect(rows[0].status, 'a refused auto-execute must not approve itself').toBe('pending');
    expect(rows[0].approved_by).toBeNull();
    expect(slackSpy).not.toHaveBeenCalled();
  });

  it('says so in the trigger log rather than reporting a plain trigger', async () => {
    // A founder reading "triggered" next to an Auto-execute badge concludes it
    // sent. The log has to be able to say "it triggered and is waiting".
    await playbook();
    await evaluatePlaybooksForProduct(P);
    expect(await triggerResults()).toEqual(['held_for_approval']);
  });

  it('executes when the company genuinely holds the authority', async () => {
    await dial(PLAYBOOK_CATEGORY, 'act');
    await grant(PLAYBOOK_CATEGORY);
    await playbook();
    const r = await evaluatePlaybooksForProduct(P);
    expect(r.held).toBe(0);
    const rows = await executions();
    expect(rows[0].status).toBe('completed');
    expect(rows[0].approved_by).toBe('system:playbook');
    expect(slackSpy).toHaveBeenCalledTimes(1);
  });

  it('stops the moment consent is revoked', async () => {
    await dial(PLAYBOOK_CATEGORY, 'act');
    await grant(PLAYBOOK_CATEGORY);
    await playbook();
    await evaluatePlaybooksForProduct(P);
    expect((await executions())[0].status).toBe('completed');

    await query(
      `UPDATE autonomy_consents SET revoked_at = datetime('now') WHERE product_id = ?`, [P]);
    await evaluatePlaybooksForProduct(P);
    const rows = await executions();
    expect(rows).toHaveLength(2);
    expect(rows[1].status, 'revoking consent must stop a standing order').toBe('pending');
    expect(slackSpy).toHaveBeenCalledTimes(1);
  });

  it('stops the moment the dial drops below act', async () => {
    await dial(PLAYBOOK_CATEGORY, 'act');
    await grant(PLAYBOOK_CATEGORY);
    await playbook();
    await evaluatePlaybooksForProduct(P);
    await dial(PLAYBOOK_CATEGORY, 'suggest');
    await evaluatePlaybooksForProduct(P);
    const rows = await executions();
    expect(rows[1].status).toBe('pending');
  });

  it('never auto-sends a customer email, whatever the founder set', async () => {
    await dial('outreach', 'act');
    await grant('outreach');
    await playbook({ actionType: 'send_email' });
    const r = await evaluatePlaybooksForProduct(P);
    expect(r.held).toBe(1);
    expect((await executions())[0].status).toBe('pending');
  });

  it('leaves a non-auto playbook exactly as it was', async () => {
    // The gate must not turn an ordinary queued action into a held one — the
    // fix for a fail-open must not become a second, quieter failure mode.
    await playbook({ autoExecute: false });
    const r = await evaluatePlaybooksForProduct(P);
    expect(r.held).toBe(0);
    expect(await triggerResults()).toEqual(['triggered']);
    expect((await executions())[0].status).toBe('pending');
  });

  it('records who it acted under, not merely that it acted', async () => {
    await dial(PLAYBOOK_CATEGORY, 'act');
    await grant(PLAYBOOK_CATEGORY);
    await playbook();
    await evaluatePlaybooksForProduct(P);
    const consentId = String(((await query(
      'SELECT id FROM autonomy_consents WHERE product_id = ?', [P])).rows[0] as Record<string, unknown>).id);
    const audit = (await query(
      `SELECT reasoning FROM audit_log WHERE product_id = ? AND action_type = 'attribution:playbook'`,
      [P])).rows as unknown as Array<{ reasoning: string }>;
    expect(audit).toHaveLength(1);
    expect(audit[0].reasoning).toContain(consentId);
  });

  it('records the refusal too, with the reason', async () => {
    await playbook();
    await evaluatePlaybooksForProduct(P);
    const audit = (await query(
      `SELECT reasoning, outcome FROM audit_log WHERE product_id = ? AND action_type = 'attribution:playbook'`,
      [P])).rows as unknown as Array<{ reasoning: string; outcome: string }>;
    expect(audit).toHaveLength(1);
    expect(audit[0].outcome).toBe('held');
    expect(audit[0].reasoning).toMatch(/refused/i);
  });

  it('makes the dial visible so the founder has somewhere to grant it', async () => {
    await playbook();
    const before = (await query(
      `SELECT mode FROM autopilot_policies WHERE product_id = ? AND category = ?`,
      [P, PLAYBOOK_CATEGORY])).rows[0] as Record<string, unknown> | undefined;
    expect(before, 'creating a standing order surfaces its dial in Controls').toBeTruthy();
    expect(before?.mode).toBe('shadow');
  });
});

// ── who may arm and disarm one ───────────────────────────────────────────────

describe('the emergency stop is reachable by the people who need it', () => {
  it('pauses within the authorized company', async () => {
    const id = await playbook();
    await togglePlaybook(id, false, P);
    expect((await listExecutionPlaybooks(P))[0].is_active).toBe(false);
  });

  it('refuses a company the caller was not authorized on', async () => {
    const id = await playbook();
    await togglePlaybook(id, false, OTHER);
    expect((await listExecutionPlaybooks(P))[0].is_active,
      'a foreign scope must change nothing').toBe(true);
  });

  it('deletes within the authorized company and nowhere else', async () => {
    const id = await playbook();
    await deletePlaybook(id, OTHER);
    expect(await listExecutionPlaybooks(P)).toHaveLength(1);
    await deletePlaybook(id, P);
    expect(await listExecutionPlaybooks(P)).toHaveLength(0);
  });

  it('does not scope on ownership', async () => {
    // The defect: `product_id IN (SELECT id FROM products WHERE owner_id=?)`.
    // A standing order is the one thing that keeps acting after everyone stops
    // watching it, and the co-founder watching the queue could not turn it off.
    const src = (await import('fs')).readFileSync(
      new URL('../../src/services/scp/playbooks/execution-engine.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
    expect(src).not.toMatch(/owner_id\s*=\s*\?/);
  });
});
