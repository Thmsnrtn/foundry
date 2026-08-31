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

/** The ranked DECISIONS, in order. The fleet list holds two canonical kinds
 *  now, so a test about decision ranking says so rather than indexing into a
 *  mixed list and depending on nothing else being in it. */
const decisionsOf = (fl: { needsYou: Array<Record<string, unknown>> }): string[] =>
  fl.needsYou.filter((n) => n.kind === 'decision').map((n) => String(n.decisionId));

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

describe('the fleet ranks over BOTH canonical sources', () => {
  it('puts a passed date the company gave above any pending decision', async () => {
    // THE FLEET HALF OF A DEFECT THE SINGLE-PRODUCT LETTER HAD ALREADY FIXED.
    // `composer.ts` projects "the one thing" over the decision queue AND the
    // institution's own NEEDS_YOU, and orders overdue first. Across the fleet
    // it read decisions alone, so a founder with two companies could not be
    // told at the top that a date they themselves gave had passed.
    //
    // The date is stated BY THE FOUNDER — migration 166 refuses one Foundry
    // authored — which is exactly why it outranks a gate: it is the one ask
    // that is late rather than merely open.
    await query(`INSERT INTO institutional_responsibilities
      (id,product_id,title,capability,state,due_at,due_stated_by)
      VALUES ('jl_late','jl_p1','Deliver the quarterly figures','operations','visible',
              datetime('now','-2 days'),'jl_f')`, []);

    const fl = await composeFleetLetter('jl_f');
    expect(fl.needsYou[0]).toMatchObject({
      kind: 'responsibility', responsibilityId: 'jl_late', because: 'overdue', productName: 'CalmCo',
    });
    // And it did not displace the decisions — it ranked above them.
    expect(fl.needsYou.some((n) => n.kind === 'decision' && n.decisionId === 'jl_d2')).toBe(true);
    // Still never another tenant.
    expect(fl.needsYou.every((n) => n.productId !== 'jl_px')).toBe(true);
  });

  it('verifies a responsibility ask as strictly as a decision, and drops it when it stops being true', async () => {
    // An item class that ships less verified than its neighbour is how a
    // verifier stops being one. The classification is RECOMPUTED from the
    // ledger, never trusted from the composer.
    const fl = await composeFleetLetter('jl_f');
    const ask = fl.needsYou.find((n) => n.kind === 'responsibility')!;
    expect(ask).toBeTruthy();
    expect((await verifyFleetLetter(fl)).letter.needsYou
      .some((n) => n.kind === 'responsibility' && n.responsibilityId === 'jl_late')).toBe(true);

    // A tampered reason is a claim the ledger does not make.
    const tampered = await composeFleetLetter('jl_f');
    const item = tampered.needsYou.find((n) => n.kind === 'responsibility') as { because: string };
    item.because = 'permission_withdrawn';
    const checked = await verifyFleetLetter(tampered);
    expect(checked.letter.needsYou.some((n) => n.kind === 'responsibility')).toBe(false);
    expect(checked.reasons.join(' ')).toContain('reason changed');

    // And once the company is no longer late, it stops being delivered.
    const still = await composeFleetLetter('jl_f');
    await query(`UPDATE institutional_responsibilities
      SET due_at=datetime('now','+30 days') WHERE id='jl_late'`, []);
    const after = await verifyFleetLetter(still);
    expect(after.letter.needsYou.some((n) => n.kind === 'responsibility')).toBe(false);
    expect(after.reasons.join(' ')).toMatch(/no longer needs the founder|due date mismatch/);

    // Put it back so later tests see the fleet as it was.
    await query(`UPDATE institutional_responsibilities
      SET due_at=datetime('now','-2 days') WHERE id='jl_late'`, []);
  });
});

describe('the third canonical store reaches the ranking too', () => {
  it('lets a judgment Foundry raised be the one thing, and verifies it as strictly', async () => {
    // `strategic_decisions_log` holds the judgments Foundry raised about the
    // company — two responsibilities wanting the same resource, and the owner
    // having to allocate or change capacity. They rendered in their own section
    // and could never be the one thing, however material, so the headline
    // projected over two of the three stores that can hold something needing
    // the founder.
    //
    // An OPEN judgment is real and is not late, so it ranks below the founder's
    // own decision queue and below the overdue obligation — but it is there,
    // and it is the one thing when nothing else is.
    await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
      VALUES ('jl_j_sig','jl_p2','operations','capacity_observed','medium','{}','Evidence')`, []);
    // The judgment's referenced responsibilities must be real and on this
    // product — migration guard `institutional_judgment:tenant_invalid` refuses
    // a judgment that names rows it cannot see, which is exactly right.
    await query(`INSERT INTO institutional_responsibilities (id,product_id,title,capability,state) VALUES
      ('jl_ra','jl_p2','Urgent support obligation','customer_support','understood'),
      ('jl_rb','jl_p2','Planned development','development','understood')`, []);
    await query(`INSERT INTO strategic_decisions_log
      (id,product_id,decision_title,decision_description,decision_category,made_by,status,
       agent_context_json,responsibility_refs_json,evidence_refs_json)
      VALUES ('jl_j','jl_p2','Two things want the same week','Allocate or change capacity',
              'operations','agent_recommendation','active','{}','["jl_ra","jl_rb"]',
              '["signal_event:jl_j_sig"]')`, []);

    const fl = await composeFleetLetter('jl_f');
    const judgment = fl.needsYou.find((n) => n.kind === 'judgment');
    expect(judgment, 'a material judgment must be rankable').toMatchObject({
      judgmentId: 'jl_j', productName: 'FireCo',
    });
    // Below the decisions, because nothing about it is late.
    const positions = fl.needsYou.map((n) => n.kind);
    expect(positions.indexOf('judgment')).toBeGreaterThan(positions.indexOf('decision'));

    // Verified against a fresh read like everything else: once the owner has
    // said which way to go, it stops being delivered.
    expect((await verifyFleetLetter(fl)).letter.needsYou
      .some((n) => n.kind === 'judgment')).toBe(true);

    const tampered = await composeFleetLetter('jl_f');
    const item = tampered.needsYou.find((n) => n.kind === 'judgment') as { evaluationState: string | null };
    item.evaluationState = 'contradicted';
    const checked = await verifyFleetLetter(tampered);
    expect(checked.letter.needsYou.some((n) => n.kind === 'judgment')).toBe(false);
    expect(checked.reasons.join(' ')).toContain('evaluation changed');

    await query("DELETE FROM strategic_decisions_log WHERE id='jl_j'", []);
    await query("DELETE FROM institutional_responsibilities WHERE id IN ('jl_ra','jl_rb')", []);
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
    expect(decisionsOf(res.letter)).toEqual(['jl_d1']);
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
      kind: 'decision', decisionId: 'jl_dx', productId: 'jl_px', productName: 'OtherCo',
      what: 'Other tenant decision', gate: 4, riskState: 'green', deadline: null, score: 99,
    });
    // The lie has to be planted on a DECISION — the gate check is what is under
    // test, and a responsibility has no gate to misstate.
    const firstDecision = fl.needsYou.findIndex((n) => n.kind === 'decision');
    fl.needsYou[firstDecision] = { ...fl.needsYou[firstDecision], gate: 0 } as typeof fl.needsYou[number];
    const res = await verifyFleetLetter(fl);
    expect(decisionsOf(res.letter)).not.toContain('jl_dx');
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
    expect(decisionsOf(fl)).toEqual(['jl_d1', 'jl_d2']); // taste learned, facts still visible
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

    // AND THE ACTIVE COMPANY IS NOT SHOWN TWICE. The fleet list renders a card
    // per company; the active one renders in full below. Leaving it in both
    // would make the page say the same thing twice, which is the defect this
    // letter spent several commits removing from its own headline.
    //
    // Asserted on the CARD, not on how often the name appears: the product
    // switcher names every company, and counting occurrences would have made
    // this a test about the switcher.
    const card = (name: string) =>
      `<span style="font-weight:600;color:var(--text-primary);">${name}</span>`;
    expect(page, 'the active company must not also have a fleet card')
      .not.toContain(card('CalmCo'));
    expect(page, 'the other companies still do').toContain(card('FireCo'));
  });

  it('shows a portfolio founder every section a solo founder gets, derived rather than listed', async () => {
    // The test above names a few surfaces it must not lose. This one does not
    // name any: it renders the SAME company for a founder who owns one, then
    // for a founder who owns two, and requires the second to contain every
    // section heading the first had.
    //
    // Listed assertions go stale the moment somebody adds a section. A founder
    // with two companies losing a surface added next year would pass the test
    // above and fail this one, which is the right way round.
    const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
    const app2 = (id: string) => {
      const a = new Hono();
      a.use('*', async (c, next) => {
        c.set('founder' as never, { id, email: `${id}@t.co`, preferences: {} } as never);
        c.set('csrfToken' as never, 't' as never);
        await next();
      });
      a.route('/', letterRoutes);
      return a;
    };

    // A founder with exactly one company, holding real institutional state.
    await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('jl_solo','clk_solo','jl_solo@t.co')", []);
    await query("INSERT INTO products (id, name, owner_id, status) VALUES ('jl_only','OnlyCo','jl_solo','active')", []);
    await query(`INSERT INTO decisions (id, product_id, category, gate, what, why_now, status) VALUES
      ('jl_solo_d','jl_only','strategic',3,'Decide the thing','pull','pending')`, []);
    const solo = await (await app2('jl_solo').request('/letter')).text();

    // The SECTION HEADINGS the single-product letter rendered for them.
    const headings = [...solo.matchAll(/text-transform:uppercase;color:var\(--text-muted\);margin-bottom:0\.6rem;">([^<]+)</g)]
      .map((m) => m[1].trim());
    expect(headings.length, 'the solo letter must render sections to compare against')
      .toBeGreaterThan(0);

    // The same person gains a second company and must lose nothing.
    await query("INSERT INTO products (id, name, owner_id, status) VALUES ('jl_second','SecondCo','jl_solo','active')", []);
    const portfolio = await (await app2('jl_solo').request('/letter')).text();
    for (const heading of headings) {
      expect(portfolio, `a second company cost them the "${heading}" section`).toContain(heading);
    }
    // And they gained the fleet ranking rather than trading for it.
    expect(portfolio).toContain('one letter, your whole fleet');

    await query("DELETE FROM decisions WHERE product_id='jl_only'", []);
    await query("DELETE FROM products WHERE owner_id='jl_solo'", []);
    await query("DELETE FROM founders WHERE id='jl_solo'", []);
  });
});
