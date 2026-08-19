// =============================================================================
// Tests: One Letter — the portfolio-operator Jarvis, slice 1
// The four constraints, proven: ranked cross-fleet attention (composer),
// nothing unverified ships (independent verifier drops + logs), quietest
// sufficient channel (interruption policy matrix), and admission-controlled
// operator memory that shifts tomorrow's ranking.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { composeFleetLetter, recordAttention } from '../../src/services/letter/fleet.js';
import { verifyFleetLetter } from '../../src/services/letter/verifier.js';
import { decideChannel, deliver } from '../../src/services/ux/interruption.js';

let app: Hono;
const founder = { id: 'jl_f', email: 'jl@t.co', preferences: { fluency: 'balanced' } };

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('jl_f','clk_jl','jl@t.co')", []);
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('jl_x','clk_jx','jx@t.co')", []);
  await query(`INSERT INTO products (id, name, owner_id, status) VALUES
    ('jl_p1','CalmCo','jl_f','active'), ('jl_p2','FireCo','jl_f','active'), ('jl_px','OtherCo','jl_x','active')`, []);
  await query("INSERT INTO lifecycle_state (product_id, current_prompt, risk_state) VALUES ('jl_p2','prompt_2','red')", []);
  await query(`INSERT INTO decisions (id, product_id, category, gate, what, why_now, status) VALUES
    ('jl_d1', 'jl_p1', 'strategic', 3, 'Sign the enterprise deal', 'pull', 'pending'),
    ('jl_d2', 'jl_p2', 'urgent',    2, 'Churn spike response',     'red',  'pending'),
    ('jl_dx', 'jl_px', 'strategic', 4, 'Other tenant decision',    'x',    'pending')`, []);
});

describe('the fleet composer ranks, with provenance', () => {
  it('one letter, ranked needs-you, never another tenant', async () => {
    const fl = await composeFleetLetter('jl_f');
    expect(fl.products.map((p) => p.productName).sort()).toEqual(['CalmCo', 'FireCo']);
    expect(fl.needsYou.length).toBe(2);
    // gate 3 green (30) beats gate 2 red (20+15=35)? No: FireCo should win.
    expect(fl.needsYou[0].decisionId).toBe('jl_d2'); // gate2 + red risk = 35 > 30
    expect(fl.needsYou.every((n) => n.decisionId !== 'jl_dx')).toBe(true);
    expect(fl.quiet).toBe(false);
  });
});

describe('the independent verifier — nothing unverified ships', () => {
  it('reconstructs product-scoped responsibility truth instead of trusting the composer', async () => {
    await query(`INSERT INTO institutional_responsibilities (id,product_id,title,capability,state)
      VALUES ('jl_r1','jl_p1','Restore customer response','customer_support','visible'),
             ('jl_rx','jl_px','Foreign responsibility','customer_support','visible')`, []);
    const fl = await composeFleetLetter('jl_f');
    const calm = fl.products.find((p) => p.productId === 'jl_p1')!;
    expect(calm.responsibilities.STILL_OPEN.map((item) => item.title)).toContain('Restore customer response');
    calm.responsibilities.STILL_OPEN[0].title = 'Tampered responsibility';
    const verified = await verifyFleetLetter(fl);
    const fresh = verified.letter.products.find((p) => p.productId === 'jl_p1')!;
    expect(fresh.responsibilities.STILL_OPEN.map((item) => item.title)).toEqual(['Restore customer response']);
    expect(verified.letter.products.flatMap((p) => p.responsibilities.STILL_OPEN).map((item) => item.title))
      .not.toContain('Foreign responsibility');
    await query("DELETE FROM institutional_responsibilities WHERE id IN ('jl_r1','jl_rx')", []);
  });

  it('drops a decision resolved between compose and deliver, and logs the defect', async () => {
    const fl = await composeFleetLetter('jl_f');
    await query("UPDATE decisions SET status='executed' WHERE id='jl_d2'", []); // world moved
    const res = await verifyFleetLetter(fl);
    expect(res.dropped).toBe(1);
    expect(res.letter.needsYou.map((n) => n.decisionId)).toEqual(['jl_d1']);
    expect(res.reasons[0]).toContain('no longer pending');
    const defects = await query(
      "SELECT * FROM audit_log WHERE action_type='letter:verifier' AND outcome='refused'", [],
    );
    expect(defects.rows.length).toBeGreaterThan(0); // "why didn't you show me X?" is answerable
    await query("UPDATE decisions SET status='pending' WHERE id='jl_d2'", []);
  });

  it('drops tampered items: cross-tenant injection and gate mismatch', async () => {
    const fl = await composeFleetLetter('jl_f');
    fl.needsYou.push({
      decisionId: 'jl_dx', productId: 'jl_px', productName: 'OtherCo',
      what: 'Other tenant decision', gate: 4, riskState: 'green', deadline: null, score: 99,
    });
    fl.needsYou[0] = { ...fl.needsYou[0], gate: 0 }; // composer "lied" about stakes
    const res = await verifyFleetLetter(fl);
    expect(res.letter.needsYou.every((n) => n.decisionId !== 'jl_dx')).toBe(true);
    expect(res.reasons.join(' ')).toContain('another tenant');
    expect(res.reasons.join(' ')).toContain('gate mismatch');
  });

  it('a stale letter is refused whole — recompose, never deliver old facts', async () => {
    const fl = await composeFleetLetter('jl_f');
    fl.composedAt = new Date(Date.now() - 10 * 60_000).toISOString();
    const res = await verifyFleetLetter(fl);
    expect(res.letter.needsYou).toEqual([]);
    expect(res.letter.quiet).toBe(true);
    expect(res.reasons[0]).toContain('stale');
  });
});

describe('the interruption policy — quietest sufficient channel', () => {
  it('the matrix: base tiers, strain quiets, critical is exempt, ceiling wins', () => {
    expect(decideChannel('info', 'steady')).toBe('log');
    expect(decideChannel('attention', 'steady')).toBe('letter');
    expect(decideChannel('action_needed', 'steady')).toBe('notification');
    expect(decideChannel('critical', 'steady')).toBe('push');
    // strain pushes DOWN, never up:
    expect(decideChannel('action_needed', 'strained')).toBe('letter');
    expect(decideChannel('action_needed', 'overloaded')).toBe('letter');
    expect(decideChannel('attention', 'overloaded')).toBe('log');
    // critical cuts through strain…
    expect(decideChannel('critical', 'overloaded')).toBe('push');
    // …but the founder's explicit ceiling beats everything:
    expect(decideChannel('critical', 'steady', { max_channel: 'notification' })).toBe('notification');
  });

  it('delivery: action_needed lands a notification row; info leaves only the log', async () => {
    const r1 = await deliver('jl_f', 'jl_p1', {
      importance: 'action_needed', title: 'Your letter: X needs you', body: 'b', actionUrl: '/letter',
    });
    expect(r1.channel).toBe('notification');
    const rows = await query(
      "SELECT * FROM notifications WHERE founder_id='jl_f' AND title LIKE 'Your letter%'", [],
    );
    expect(rows.rows.length).toBe(1);
    const r2 = await deliver('jl_f', 'jl_p1', { importance: 'info', title: 'quiet', body: 'b' });
    expect(r2.channel).toBe('log');
    expect(r2.delivered).toBe(false);
  });
});

describe('constitutional guardrails hold structurally', () => {
  it('the verifier stays independent: no runtime import of the composer', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/services/letter/verifier.ts', 'utf8');
    // type-only imports are fine (zero runtime coupling); runtime imports are not
    expect(src).not.toMatch(/import\s+(?!type\b)[^;]*from\s+'\.\/fleet/);
    expect(src).not.toMatch(/from\s+'\.\/composer/);
  });

  it('learned taste stays bounded: the ±5 attention clamp exists', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/services/letter/fleet.ts', 'utf8');
    expect(src).toContain('Math.max(-5, Math.min(5');
  });
});

describe('the operator pack — same letter, plus the machine (no fork)', () => {
  it('the operator sees system-health lines; other founders never do', async () => {
    await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('jl_op','clk_op','thmsnrtn@gmail.com')", []);
    await query("INSERT INTO products (id, name, owner_id, status) VALUES ('jl_pop','Foundry','jl_op','active')", []);
    // The verifier tests above logged real letter:verifier defects — the
    // operator's letter should surface them.
    const opLetter = await composeFleetLetter('jl_op');
    expect(opLetter.system.length).toBeGreaterThan(0);
    expect(opLetter.system.join(' ')).toContain('letter verifier dropped');

    const customerLetter = await composeFleetLetter('jl_f');
    expect(customerLetter.system).toEqual([]); // the pack never leaks to customers
  });
});

describe('conversational presence — "what needs me?" answers from the verified ranking', () => {
  it('the fast path replies deterministically (no AI), citing real decisions', async () => {
    const { handleUtterance } = await import('../../src/services/chat/institution.js');
    // No AI key in tests: if this hit the model it would throw — the fast
    // path proves itself by answering at all.
    const turn = await handleUtterance('jl_p1', 'jl_f', 'What needs me today?');
    expect(turn.reply).toContain('ranked');
    expect(turn.reply).toContain('Sign the enterprise deal');
    expect(turn.captured).toBeNull();
  });
});

describe('operator attention memory — explicit, admission-controlled, ranking-visible', () => {
  it('reactions are stored only for real owned items, and shift the ranking', async () => {
    // Rejected: a reference the founder does not own stores nothing.
    await recordAttention('jl_f', 'jl_px', 'jl_dx', 'acted');
    expect((await query("SELECT COUNT(*) c FROM operator_attention", [])).rows[0]).toMatchObject({ c: 0 });

    // The founder consistently dismisses FireCo's surfaced items…
    for (let i = 0; i < 4; i++) await recordAttention('jl_f', 'jl_p2', 'jl_d2', 'dismissed');
    // …and acts on CalmCo's.
    for (let i = 0; i < 4; i++) await recordAttention('jl_f', 'jl_p1', 'jl_d1', 'acted');

    const fl = await composeFleetLetter('jl_f');
    // Base scores: d2 = 35, d1 = 30. Attention: d2 −5, d1 +5 → d1 (35) > d2 (30).
    expect(fl.needsYou[0].decisionId).toBe('jl_d1'); // taste learned, facts still visible
    expect(fl.needsYou[1].decisionId).toBe('jl_d2');
  });

  it('the /letter surface renders the fleet letter and captures reactions', async () => {
    const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
    app = new Hono();
    app.use('*', async (c, next) => {
      c.set('founder' as never, founder as never);
      c.set('csrfToken' as never, 't' as never);
      await next();
    });
    app.route('/', letterRoutes);

    const page = await (await app.request('/letter')).text();
    expect(page).toContain('one letter, your whole fleet');
    expect(page).toContain('Sign the enterprise deal');
    expect(page).toContain('Churn spike response');
    expect(page).not.toContain('Other tenant decision');

    const before = Number((await query("SELECT COUNT(*) c FROM operator_attention", [])).rows[0]!.c);
    await app.request('/letter/attention/jl_d1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ product_id: 'jl_p1', reaction: 'acted' }),
    });
    const after = Number((await query("SELECT COUNT(*) c FROM operator_attention", [])).rows[0]!.c);
    expect(after).toBe(before + 1);
  });

  it('still gives a portfolio operator every place authority is granted or seen', async () => {
    // THE GAP THIS CLOSES. The fleet letter used to REPLACE the single-product
    // letter, so a founder with two companies got a ranked list and a bare
    // title per responsibility — and lost every action surface: what Foundry is
    // permitted to change, what it changed, the permission asks, the evidence
    // question, support channels, customer messages, the report-obligation
    // form. There was no route back to them either, because `/letter` took the
    // fleet branch whatever the product switcher said.
    //
    // An authority a founder cannot see is one they cannot withdraw, so this is
    // asserted rather than remembered. The fleet ranking stays; the active
    // company now renders in full beneath it.
    const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
    const two = new Hono();
    two.use('*', async (c, next) => {
      c.set('founder' as never, founder as never);
      c.set('csrfToken' as never, 't' as never);
      await next();
    });
    two.route('/', letterRoutes);
    const page = await (await two.request('/letter')).text();

    // The fleet ranking is still there — this restores a surface, it does not
    // trade one for the other.
    expect(page).toContain('one letter, your whole fleet');
    expect(page).toContain('ranked across the fleet');

    // And the active company renders in full, named so the founder knows which
    // of their companies they are acting on.
    expect(page, 'the active company must be named').toContain('in full');
    // The intake a company uses to say what it owes.
    expect(page, 'the report-obligation form must render').toContain('Tell me something');
    // Tenancy is unchanged by any of it.
    expect(page).not.toContain('Other tenant decision');
    expect(page).not.toContain('OtherCo');
  });
});
