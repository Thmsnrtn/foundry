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
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

const F = 'va_f';
const MINE = 'va_mine';
const THEIRS = 'va_theirs';

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
     VALUES (?, ?, 'send_email', 'resend', '{}', 'pending', ?)`,
    [id, productId, when]);
  return id;
}

async function statusOf(id: string): Promise<Record<string, unknown>> {
  return (await query(
    'SELECT status, approved_by FROM action_executions WHERE id = ?', [id]))
    .rows[0] as Record<string, unknown>;
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [F, 'clerk_va', 'va@test.local']);
  for (const [p, n] of [[MINE, 'Mine'], [THEIRS, 'Theirs']]) {
    await query(`INSERT INTO products (id, name, owner_id) VALUES (?,?,?)`, [p, n, F]);
  }
});

beforeEach(async () => {
  await query('DELETE FROM action_executions');
  await query('DELETE FROM decisions');
});

// `routeApproval` is internal; the reachable path is processVoiceReply, and
// transcription is a paid provider call. Driving the routing directly is the
// honest way to test the binding without inventing a fake audio pipeline.
async function approve(productId: string, id?: string): Promise<string> {
  const mod = await import('../../src/services/scp/briefing/voice-reply.js');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mod as any).__routeApprovalForTest(productId, 'yes, go ahead', 'briefing item A', id);
}

describe('an approval binds to the action it names', () => {
  it('approves exactly that action', async () => {
    const target = await pendingAction(MINE, '2026-01-01T00:00:00Z');
    const newer = await pendingAction(MINE, '2026-06-01T00:00:00Z');

    const routed = await approve(MINE, target);
    expect(routed).toBe(`action_executions:${target}`);

    expect((await statusOf(target)).status).toBe('approved');
    expect((await statusOf(target)).approved_by,
      'and records that a voice reply is what approved it').toBe('voice:founder');
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
