process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { openProposals, proposeAct, setBoundary } from '../../src/services/institution/standing-intent.js';

// =============================================================================
// WHAT IT WOULD TAKE TO UNDO.
//
// The owner asked that a request for authority show four things: what kind of
// consequence it carries, what it touches, what it costs, and whether it can be
// undone. The card showed one of them. It carried a low/medium/high consequence
// that was never rendered at all, and had no notion of cost or of reversal —
// so the question a person actually asks before saying yes ("and if this turns
// out to be wrong?") had no answer anywhere on the screen.
//
// Two of the four the institution already knew and was not saying. The rungs
// are a far better vocabulary than low/medium/high: `destructive` says in its
// own words that it cannot be undone, and `absorbable` says whether standing
// policy may ever pre-authorise the class at all.
// =============================================================================

const OWNER = 'undo_owner';
let app: Hono;
let productId = '';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_undo', 'owner@example.com', 'Thomas Norton']);
  const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never,
      { id: OWNER, email: 'owner@example.com', name: 'Thomas Norton' } as never);
    c.set('csrfToken' as never, 'test' as never);
    await next();
  });
  app.route('/', foundryShellRoutes);
  await app.request('/foundry/companies', { method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ name: 'Tidewater' }).toString() });
  productId = String(((await query(
    'SELECT id FROM products WHERE owner_id = ?', [OWNER])).rows[0] as Record<string, unknown>).id);
  // A PROPOSAL IS ONLY LEGITIMATE WHERE SOMETHING STANDING ASKED TO BE
  // CONSULTED. The database refuses one otherwise, because an ask the owner
  // never requested is an interruption manufactured out of nothing — so these
  // are the boundaries that make each ask below a real one.
  for (const subject of ['contact_people', 'move_money', 'change_software']) {
    await setBoundary({ productId, subject, mode: 'ask_first',
      statement: `ask me before you ${subject.replace('_', ' ')}` });
  }
});

describe('a request for authority', () => {
  it('carries the rung, what it costs, and what putting it back involves', async () => {
    await proposeAct({ productId, subject: 'contact_people', actionType: 'send_email',
      params: { to: 'one customer' }, summary: 'Email the customer who asked twice',
      why: 'they asked twice and nobody replied', expectedEffect: 'they get an answer',
      risk: 'the answer is wrong and they act on it', consequence: 'medium',
      rung: 'public', costCents: 0, proposedBy: 'foundry' });
    const [open] = await openProposals(productId);
    expect(open?.rung).toBe('public');
    expect(open?.puttingItBack).toContain('cannot be unread');
    expect(open?.costCents).toBe(0);
  });

  it('shows all four on the company page', async () => {
    const body = await (await app.request(`/foundry/companies/${productId}`)).text();
    expect(body).toContain('What kind of act');
    expect(body).toContain('publishes, messages or contacts someone outside');
    expect(body).toContain('Putting it back');
    expect(body).toContain('cannot be unread');
    expect(body).toContain('What it costs');
    expect(body).toContain('nothing');
  });

  it('says plainly when nothing could ever pre-authorise the class', async () => {
    await proposeAct({ productId, subject: 'move_money', actionType: null,
      params: {}, summary: 'Move the balance to the operating account',
      why: 'it is sitting where nothing can use it', expectedEffect: 'the money moves',
      risk: 'it was being held back for something', consequence: 'high',
      rung: 'destructive', costCents: null, proposedBy: 'foundry' });
    const body = await (await app.request(`/foundry/companies/${productId}`)).text();
    expect(body).toContain('putting it back is not available');
    expect(body).toContain('one act at a time, permanently');
    // And an unknown cost is said to be unknown rather than shown as zero.
    expect(body).toContain('I do not know');
  });

  it('treats an unclassified act as though it cannot be undone', async () => {
    // Acts proposed before the ladder reached this table have no rung, and
    // inventing one for them afterwards would assert a classification nobody
    // made. The safe reading is stated instead.
    await query(
      `INSERT INTO proposed_acts (id, product_id, subject, action_type,
         params_fingerprint, summary, why, expected_effect, risk, consequence,
         proposed_by, expires_at)
       VALUES ('old_act', ?, 'change_software', NULL, 'abc', 'An older proposal',
         'it predates the ladder', 'something happens', 'unclear', 'low',
         'foundry', datetime('now', '+72 hours'))`, [productId]);
    const body = await (await app.request(`/foundry/companies/${productId}`)).text();
    expect(body).toContain('have not classified what kind of act');
    expect(body).toContain('as though it cannot be undone');
  });

  it('refuses a rung that is not on the ladder', async () => {
    await expect(proposeAct({ productId, subject: 'contact_people', actionType: null,
      params: { n: 1 }, summary: 's', why: 'w', expectedEffect: 'e', risk: 'r',
      consequence: 'low', rung: 'catastrophic', proposedBy: 'foundry' }))
      .rejects.toThrow(/unknown_rung/);
  });

  it('refuses a cost that would hide money coming back', async () => {
    await expect(proposeAct({ productId, subject: 'contact_people', actionType: null,
      params: { n: 2 }, summary: 's', why: 'w', expectedEffect: 'e', risk: 'r',
      consequence: 'low', rung: 'financial', costCents: -500, proposedBy: 'foundry' }))
      .rejects.toThrow(/negative_cost/);
  });
});
