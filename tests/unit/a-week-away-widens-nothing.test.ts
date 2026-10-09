process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '8'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { mandateOf, readMandate, stateMandate } from '../../src/services/mandate/statements.js';
import { compileIntent, touchesAuthority } from '../../src/services/intent/compile.js';
import { thinkingCapFor } from '../../src/services/institution/spending.js';
import { proposeAct, setBoundary } from '../../src/services/institution/standing-intent.js';

// =============================================================================
// A WEEK AWAY WIDENS NOTHING (Institution V6b, 30 September 2026; the
// long-horizon directive's scenario 609, "the founder disappears for seven
// days"; INSTITUTION_MODEL §5.1 check-in style is not permission, §5.6
// inactivity must not block and silence is neither yes nor no).
//
// "I'm away until October 8" is a check-in style: Home says so first, with
// what Foundry carries and what waits, and one tap says the owner is back. It
// moves nothing that decides what Foundry may do, spend or send; a decision
// that was waiting is still waiting a week later, undecided; and the away
// statement lapses by itself.
// =============================================================================

const OWNER = 'f_away';
const NOW = new Date('2026-09-30T12:00:00Z');
let app: Hono;
let actId = '';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clk_away', 'owner@example.com', 'Owner']);
  await query(`INSERT INTO products (id,name,owner_id,status,scp_status,reality) VALUES ('p_away','Lamplight',?,'active','active','real')`, [OWNER]);
  await query(`INSERT INTO autopilot_policies (id, product_id, category, mode, set_by) VALUES ('ap_away','p_away','marketing','suggest','founder')`);
  await setBoundary({ productId: 'p_away', subject: 'set_prices', mode: 'ask_first', statement: 'Ask me before changing prices' });
  actId = await proposeAct({ productId: 'p_away', subject: 'set_prices', actionType: null, params: { price: 49 },
    summary: 'Raise the price to $49', why: 'Buyers asked', expectedEffect: 'More per sale', risk: 'Fewer sales',
    consequence: 'low', proposedBy: 'institution:test' });
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Owner' } as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', letterRoutes);
});

describe('the reading', () => {
  it('hears being away, for how long, being back, and how the owner wants to hear', () => {
    expect(readMandate("I'm away until October 8", NOW)).toMatchObject({ dimension: 'involvement', subject: 'away', until: '2026-10-09' });
    expect(readMandate("I'll be away for a week", NOW)).toMatchObject({ subject: 'away', until: '2026-10-07' });
    expect(readMandate('Away', NOW)).toMatchObject({ subject: 'away', until: '2026-10-07' });
    expect(readMandate("I'm back", NOW)).toMatchObject({ dimension: 'involvement', subject: 'present', until: null });
    expect(readMandate('Quiet CEO mode', NOW)).toMatchObject({ dimension: 'involvement', subject: 'quiet' });
    expect(readMandate("I'm away, email everyone that I'm out", NOW)).toBeNull();
  });

  it('is steering in the composer, never authority', () => {
    const p = compileIntent("I'm away until October 8", { searching: false, now: NOW });
    expect(p).toMatchObject({ kind: 'steer', destination: 'mandate' });
    expect(touchesAuthority(p)).toBe(false);
  });
});

describe('seven days away', () => {
  it('moves nothing that decides what Foundry may do, spend or send', async () => {
    const capBefore = await thinkingCapFor(OWNER, NOW);
    const modesBefore = (await query(`SELECT category, mode FROM autopilot_policies WHERE product_id = 'p_away' ORDER BY category`)).rows;
    await stateMandate(OWNER, readMandate("I'm away until October 8", NOW)!, 'direct', NOW);
    expect(await thinkingCapFor(OWNER, NOW)).toBe(capBefore);
    expect((await query(`SELECT category, mode FROM autopilot_policies WHERE product_id = 'p_away' ORDER BY category`)).rows).toEqual(modesBefore);
    expect((await query(`SELECT COUNT(*) AS n FROM owner_allowances`)).rows[0]).toMatchObject({ n: 0 });
  });

  it('leaves what was waiting undecided a week later: silence is neither yes nor no', async () => {
    const act = (await query(`SELECT decision FROM proposed_acts WHERE id = ?`, [actId])).rows[0] as Record<string, unknown>;
    expect(act.decision ?? null).toBeNull();
  });

  it('says so first on Home, with what waits and the way back, and lapses by itself', async () => {
    // HOME READS THE CLOCK. Written on 30 September against "until October 9", it
    // went red by itself on 9 October; the page is read at NOW, as the rest is.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    let html = '';
    try { html = await (await app.request('/foundry')).text(); } finally { vi.useRealTimers(); }
    const panel = /<section class="panel away" aria-label="You are away">[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
    expect(panel).toContain('You are away until 2026-10-09.');
    expect(panel).toContain('Being away lets me do nothing I could not already do.');
    expect(panel).toContain("I'm back");
    expect((await mandateOf(OWNER, new Date('2026-10-10T00:00:00Z'))).some((m) => m.subject === 'away')).toBe(false);
    const away = (await mandateOf(OWNER, NOW)).find((m) => m.subject === 'away')!;
    expect((await app.request(`/foundry/mandate/${away.id}/withdraw`, { method: 'POST' })).status).toBe(302);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    try { expect(await (await app.request('/foundry')).text()).not.toContain('class="panel away"'); } finally { vi.useRealTimers(); }
  });
});
