// =============================================================================
// Tests: a voice approval approved whichever action happened to be newest
//
// ...or rather, it would have. `routeApproval` in the voice-reply processor
// did this:
//
//   SELECT id FROM action_executions
//    WHERE product_id = ? AND status = 'pending_approval'
//    ORDER BY created_at DESC LIMIT 1
//   → UPDATE ... SET status = 'approved'
//
// `action_executions.status` permits pending / approved / executing /
// completed / failed / cancelled. 'pending_approval' is `outbound_actions`'s
// spelling, a different table. So the query matched no rows, ever, and fell
// through to filing the founder's approval as a note — silently, because that
// fall-through is also what happens when there is genuinely nothing to
// approve. The feature has never worked.
//
// And the first time it did work it would have approved the wrong thing.
// `context` — documented as "what briefing item this is replying to" — was
// never read. It is caller-supplied free text and defaults to the empty
// string, so there was nothing to bind to and nothing tried. A founder saying
// "yes, go ahead" in reply to briefing item A approved whichever outbound
// action was most recently created, which is not necessarily A. The effect was
// then dispatched on an approval that had never been given for it.
//
// An approval is authority over ONE effect. Binding it to "the latest" is not
// a loose match — it is a different decision, made on the founder's behalf.
//
// The whole thing sat inside `catch { // action_executions table may not exist
// or have different schema }`, so failing to bind and the table being absent
// looked identical from outside.
//
// TWO MORE LAYERS, FOUND LATER BY ASKING WHERE THE EDGE IS.
//
// Setting `status = 'approved'` was never enough: nothing in the system picks
// an approved execution up again — the only transition out of 'approved' lives
// inside `approveAndExecute`, two lines after its own claim. So the founder
// said "yes, go ahead", the row stopped being pending, the effect never
// happened, and the action left the pending queue, which is the only place the
// dashboard would have let them approve it properly. It did not merely fail to
// act; it stranded the action out of reach of the path that works. And a
// direct UPDATE asks the kill switch nothing.
//
// And WHOSE approval? The click path runs through `can_trigger_actions`
// middleware. This path asked nothing and recorded the approver as the
// constant string 'voice:founder' — not a principal, a category. Two other
// doors reach the same routing: the dashboard voice route and an API-key
// webhook for the mobile app, the second of which is not a human session at
// all. A key acts as the person who issued it, bounded by its scopes.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

const F = 'va_f';
const OBSERVER = 'va_observer';
const MINE = 'va_mine';
const THEIRS = 'va_theirs';
const PAUSED = 'va_paused';

const slackSpy = vi.fn(async () => ({
  certainty: 'provider_acknowledged' as const, providerMessageTs: '1.0',
}));
vi.mock('../../src/services/integration/slack.js', () => ({
  sendSlackNotification: (...args: unknown[]) => slackSpy(...(args as [])),
}));

vi.mock('../../src/services/ai/client.js', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return {
    ...actual,
    callSonnet: vi.fn(async () => ({
      content: JSON.stringify({ action_type: 'approval', confidence: 0.9 }),
      usage: { input_tokens: 5, output_tokens: 5 },
    })),
  };
});

async function pendingAction(productId: string, when: string): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO action_executions
       (id, product_id, action_type, integration, payload_json, status, created_at)
     VALUES (?, ?, 'post_slack', 'slack', ?, 'pending', ?)`,
    [id, productId,
      JSON.stringify({ action_type: 'post_slack', channel: '#a', text: 'hi' }), when]);
  return id;
}

async function statusOf(id: string): Promise<Record<string, unknown>> {
  return (await query(
    'SELECT status, approved_by FROM action_executions WHERE id = ?', [id]))
    .rows[0] as Record<string, unknown>;
}

beforeAll(async () => {
  await runMigrations();
  for (const [id, clerk] of [[F, 'clerk_va'], [OBSERVER, 'clerk_va_obs']]) {
    await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
      [id, clerk, `${id}@test.local`]);
  }
  for (const [p, n] of [[MINE, 'Mine'], [THEIRS, 'Theirs'], [PAUSED, 'Paused']]) {
    await query(`INSERT INTO products (id, name, owner_id) VALUES (?,?,?)`, [p, n, F]);
  }
  await query(`UPDATE products SET scp_status = 'paused' WHERE id = ?`, [PAUSED]);
  // A member whose access to the company deliberately excludes executing
  // effects. They may leave notes and ask questions; they may not send.
  await query(
    `INSERT INTO team_members
       (id, product_id, founder_id, role, status, can_view_decisions, can_trigger_actions)
     VALUES (?, ?, ?, 'investor_observer', 'active', 1, 0)`,
    [nanoid(), MINE, OBSERVER]);
});

beforeEach(async () => {
  slackSpy.mockClear();
  await query('DELETE FROM action_executions');
  await query('DELETE FROM decisions');
});

// `routeApproval` is internal; the reachable path is processVoiceReply, and
// transcription is a paid provider call. Driving the routing directly is the
// honest way to test the binding without inventing a fake audio pipeline.
async function approve(productId: string, id?: string, speaker = F): Promise<string> {
  const mod = await import('../../src/services/scp/briefing/voice-reply.js');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mod as any).__routeApprovalForTest(
    productId, speaker, 'yes, go ahead', 'briefing item A', id);
}

describe('an approval binds to the action it names', () => {
  it('approves exactly that action', async () => {
    const target = await pendingAction(MINE, '2026-01-01T00:00:00Z');
    const newer = await pendingAction(MINE, '2026-06-01T00:00:00Z');

    const routed = await approve(MINE, target);
    expect(routed).toBe(`action_executions:${target}`);

    // Approved AND DISPATCHED. Setting the status alone left the action in a
    // state nothing ever picks up, and out of the pending queue that is the
    // only place the dashboard would have let the founder approve it properly.
    expect((await statusOf(target)).status).toBe('completed');
    expect(slackSpy).toHaveBeenCalledTimes(1);
    expect((await statusOf(target)).approved_by,
      'and records WHO approved it, not merely that a voice did').toBe(`voice:${F}`);
    expect((await statusOf(newer)).status,
      'the newest action is the one the old code would have approved')
      .toBe('pending');
  });

  it('approves nothing when no action is named', async () => {
    const only = await pendingAction(MINE, '2026-01-01T00:00:00Z');
    const routed = await approve(MINE);

    expect((await statusOf(only)).status,
      'an unbound approval is not authority over anything').toBe('pending');
    expect(routed).toMatch(/^decisions:/);

    // The founder's words are not lost — they land as a note that says what
    // they were.
    const note = await query(
      `SELECT what FROM decisions WHERE product_id = ?`, [MINE]);
    expect(String((note.rows[0] as Record<string, unknown>).what))
      .toContain('approval_unbound');
  });

  it('refuses an action belonging to another company', async () => {
    const theirs = await pendingAction(THEIRS, '2026-01-01T00:00:00Z');
    const routed = await approve(MINE, theirs);

    expect((await statusOf(theirs)).status,
      'a voice reply on one company may not approve another company’s effect')
      .toBe('pending');
    expect(routed).toMatch(/^decisions:/);
  });

  it('refuses an action that is no longer pending', async () => {
    const already = await pendingAction(MINE, '2026-01-01T00:00:00Z');
    await query(
      `UPDATE action_executions SET status='completed' WHERE id = ?`, [already]);

    const routed = await approve(MINE, already);
    expect((await statusOf(already)).status,
      're-approving a dispatched effect is not a no-op, it is a second decision')
      .toBe('completed');
    expect(routed).toMatch(/^decisions:/);
  });
});

describe('an approval binds to a principal who may give it', () => {
  it('refuses a member whose access excludes executing effects', async () => {
    const target = await pendingAction(MINE, '2026-01-01T00:00:00Z');
    const routed = await approve(MINE, target, OBSERVER);

    expect((await statusOf(target)).status,
      'saying it out loud is not a way around can_trigger_actions').toBe('pending');
    expect(slackSpy).not.toHaveBeenCalled();
    expect(routed).toMatch(/^decisions:/);
    const note = await query(`SELECT what FROM decisions WHERE product_id = ?`, [MINE]);
    expect(String((note.rows[0] as Record<string, unknown>).what))
      .toContain('approval_not_permitted');
  });

  it('refuses a speaker who names nobody', async () => {
    // An API key with no issuer on record resolves to the empty string. Absence
    // must not read as consent.
    const target = await pendingAction(MINE, '2026-01-01T00:00:00Z');
    await approve(MINE, target, '');
    expect((await statusOf(target)).status).toBe('pending');
  });

  it('lets a member without the capability still leave the words on record', async () => {
    // A guard that refuses the legitimate principal is not extra secure. The
    // observer may not send; they may still be heard.
    const target = await pendingAction(MINE, '2026-01-01T00:00:00Z');
    await approve(MINE, target, OBSERVER);
    const note = await query(`SELECT why_now FROM decisions WHERE product_id = ?`, [MINE]);
    expect(note.rows).toHaveLength(1);
  });
});

describe('an approval reaches the kill switch', () => {
  it('does not dispatch for a company Foundry is not acting for', async () => {
    const target = await pendingAction(PAUSED, '2026-01-01T00:00:00Z');
    const routed = await approve(PAUSED, target);

    expect(slackSpy).not.toHaveBeenCalled();
    expect((await statusOf(target)).status,
      'the executor refuses before the claim, so it does not stay pending silently')
      .toBe('cancelled');
    expect(routed).toMatch(/^decisions:/);
    const note = await query(`SELECT what FROM decisions WHERE product_id = ?`, [PAUSED]);
    expect(String((note.rows[0] as Record<string, unknown>).what))
      .toContain('approval_refused');
  });
});
