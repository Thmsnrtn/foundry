process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '8'.repeat(64);

// =============================================================================
// WHAT CAN WAIT FOR THE WEEK, WAITS (F1, 9 October 2026).
//
// The year in the twin put about 14 minutes a week on the owner, and the
// largest share was not decisions: it was items he had already read, seen
// again every day — advice he may take up, something Foundry noticed and could
// look after, designs the forge could not seal. Each says "if you do nothing:
// nothing happens", has no date of its own, and resolves or keeps without him.
// INSTITUTION_MODEL §5.1 lets the check-in style set the batching; this is
// the batching:
//   * such an item reaches Needs you once a week, on his batch day (the weekday
//     he began, so it is the same day every week), and waits under "Put off
//     until later" with the day it comes back the rest of the week;
//   * a decision, an obligation, the charter, mail, a held file and a test to
//     allow are NEVER batched: they reach him the day they arise;
//   * "hands-on" turns batching off.
// Nothing is decided for him and nothing is closed: the item is his, on a
// weekly rhythm instead of a daily one.
// =============================================================================
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import type { AttentionItem } from '../../src/services/founder/attention.js';

const Q = await import('../../src/services/needs-you/queue.js');
const OWNER = 'f_week';

const item = (kind: AttentionItem['kind'], id = 'x'): AttentionItem => ({ kind, id, productId: 'p', companyName: 'C', summary: 'S', detail: 'D',
  yes: { label: 'Yes', action: '/y' }, no: { label: 'No', action: '/n' }, why: null, href: '/h' } as AttentionItem);

describe('which items may wait for the week', () => {
  it('advice, something noticed and the designs the forge could not seal: yes', () => {
    expect(Q.waitsForTheWeek(item('advice'))).toBe(true);
    expect(Q.waitsForTheWeek(item('noticed'))).toBe(true);
    expect(Q.waitsForTheWeek(item('experiment', 'forge-designs-waiting'))).toBe(true);
  });
  it('names the forge\'s item by the forge\'s own id, so the two cannot drift', async () => {
    const { DESIGNS_WAITING } = await import('../../src/services/venture/forge-deliberation.js');
    expect(Q.waitsForTheWeek(item('experiment', DESIGNS_WAITING))).toBe(true);
  });
  it('a decision, an obligation, the charter, a test to allow, a held file, the Workshop: never', () => {
    for (const i of [item('act'), item('obligation'), item('charter'), item('experiment', 'exp_1'), item('experiment', 'printable-held:exp_1'), item('experiment', 'workshop')]) {
      expect(Q.waitsForTheWeek(i), `${i.kind}:${i.id}`).toBe(false);
    }
  });
});

describe('the week, through the real queue', () => {
  beforeAll(async () => {
    await runMigrations();
    await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clk_week', 'owner@example.com', 'Owner']);
    await query(`INSERT INTO products (id,name,owner_id,status,scp_status,reality) VALUES ('p_week','Lamplight',?,'active','active','real')`, [OWNER]);
  });

  it('his batch day is the weekday he began, every seventh day after', async () => {
    await query(`UPDATE founders SET created_at = datetime('now', '-14 days') WHERE id = ?`, [OWNER]);
    expect((await Q.theWeeksBatch(OWNER)).today).toBe(true);
    await query(`UPDATE founders SET created_at = datetime('now', '-16 days') WHERE id = ?`, [OWNER]);
    const w = await Q.theWeeksBatch(OWNER);
    expect(w.today).toBe(false);
    // Five days to the next one.
    expect(Math.round((Date.parse(w.next) - Date.now()) / 86_400_000)).toBe(5);
  });

  it('off the batch day an item that may wait is put off until the batch, and a decision is not', () => {
    const week = { today: false, next: '2099-01-05T00:00:00.000Z', handsOn: false };
    expect(Q.whenItAsks(item('advice'), week)).toBe('2099-01-05T00:00:00.000Z');
    expect(Q.whenItAsks(item('act'), week)).toBe('now');
    expect(Q.whenItAsks(item('advice'), { ...week, today: true })).toBe('now');
    expect(Q.whenItAsks(item('advice'), { ...week, handsOn: true })).toBe('now');
  });

  it('hands-on turns the batch off', async () => {
    const { stateMandate, readMandate } = await import('../../src/services/mandate/statements.js');
    expect((await Q.theWeeksBatch(OWNER)).handsOn).toBe(false);
    await stateMandate(OWNER, readMandate('hands-on', new Date())!, 'direct', new Date());
    expect((await Q.theWeeksBatch(OWNER)).handsOn).toBe(true);
  });
});

// ─── THROUGH needsYou ITSELF, OFF THE BATCH DAY (F2 audit of F1) ─────────────
// The checks above call the pure pieces. A founder made in a test begins
// today, so every other suite meets needsYou ON his batch day, where nothing
// is held back at all: rewriting needsYou to hold back EVERY item off the
// batch day — decisions, obligations and the charter with it — stayed green
// across all nine suites that read the queue. This drives the real queue on a
// day that is not his batch day, with a decision and advice both waiting.
describe('off the batch day, through the real queue', () => {
  const OFF = 'f_offday';
  beforeAll(async () => {
    await query('INSERT INTO founders (id,clerk_user_id,email,name,created_at) VALUES (?,?,?,?,datetime(\'now\',\'-16 days\'))', [OFF, 'clk_off', 'off@example.com', 'Off']);
    await query(`INSERT INTO products (id,name,owner_id,status,scp_status,reality) VALUES ('p_off','Offday',?,'active','active','real')`, [OFF]);
    await query(`INSERT INTO owner_boundaries (id, product_id, subject, statement, mode)
       VALUES ('ob_off','p_off','spend_money','Ask me before spending','ask_first')`, []);
    await query(
      `INSERT INTO proposed_acts (id, product_id, subject, params_fingerprint, summary, why, expected_effect, risk, consequence, proposed_by, expires_at)
       VALUES ('pa_off','p_off','spend_money','fp','buy the thing','because','it arrives','it does not','low','foundry',datetime('now','+3 days'))`, []);
    await query(`INSERT INTO company_situations (id, product_id, situation, headline, evidence_mode, began_at)
       VALUES ('cs_off','p_off','needs_attention','it keeps needing something','real',datetime('now','-10 day'))`, []);
    await query(`INSERT INTO situation_recommendations (id, situation_id, product_id, kind, summary, why, would_need, raised_at)
       VALUES ('sr_off','cs_off','p_off','advice','tidy the shelf','because','a decision from you',datetime('now','-1 day'))`, []);
  });

  it('a decision reaches him today; advice waits, marked as batched, until his batch day', async () => {
    expect((await Q.theWeeksBatch(OFF)).today).toBe(false);
    const { items, later } = await Q.needsYou(OFF);
    const keys = items.map((i) => i.key);
    expect(keys).toContain('act:pa_off');
    expect(keys).not.toContain('advice:sr_off');
    const held = later.find((i) => i.key === 'advice:sr_off');
    expect(held?.batched).toBe(true);
    expect(later.some((i) => i.key === 'act:pa_off')).toBe(false);
  });

  it('on his batch day the advice reaches him too', async () => {
    await query(`UPDATE founders SET created_at = datetime('now', '-14 days') WHERE id = ?`, [OFF]);
    const { items } = await Q.needsYou(OFF);
    expect(items.map((i) => i.key)).toEqual(expect.arrayContaining(['act:pa_off', 'advice:sr_off']));
  });
});
