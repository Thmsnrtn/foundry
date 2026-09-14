// =============================================================================
// Tests: Calibration scoring + Self-audit (AcreOS ports, 2026-07-14)
// Calibration gates promotion on truthfulness-of-confidence (do the acts pass,
// do the beliefs hold?), independent of agreement. Self-audit catches the
// system drifting toward over-deference — the meta-check on founder-minutes.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, it, expect, beforeAll } from 'vitest';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getCategoryCalibration, calibrationHold } from '../../src/services/autopilot/calibration.js';
import { runFleetSelfAudit, deferenceLine } from '../../src/services/autopilot/self-audit.js';

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('ca_f','clk_ca','ca@t.co')", []);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES ('ca_p','CalCo','ca_f','active')", []);
});

async function seedAction(category: string, verify: 'passed' | 'failed') {
  const id = nanoid();
  await query(
    `INSERT INTO action_executions (id, product_id, action_type, integration, payload_json, status, approved_by, verify_status)
     VALUES (?, 'ca_p', 'send_email', 'resend', '{}', 'completed', ?, ?)`,
    [id, `autopilot:${category}`, verify],
  );
}

async function seedPremise(category: string, status: 'holding' | 'falsified') {
  const did = nanoid();
  await query(
    `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status)
     VALUES (?, 'ca_p', ?, 2, 'x', 'y', 'pending')`, [did, category],
  );
  await query(
    `INSERT INTO decision_premises (id, product_id, decision_id, decision_source, premise, premise_type, status, origin)
     VALUES (?, 'ca_p', ?, 'decision', 'p', 'metric', ?, 'founder')`,
    [nanoid(), did, status],
  );
}

describe('calibration = truthfulness of confidence', () => {
  // Use real decisions.category values (CHECK-constrained); the autopilot
  // category name (in approved_by / autopilot_policies) is free-form and
  // matches by convention.
  it('a category whose acts pass and beliefs hold is well-calibrated', async () => {
    for (let i = 0; i < 3; i++) await seedAction('marketing', 'passed');
    await seedPremise('marketing', 'holding');
    const c = await getCategoryCalibration('ca_p', 'marketing');
    expect(c.actionsPassed).toBe(3);
    expect(c.score).toBe(1);
    expect(c.verdict).toBe('well_calibrated');
    expect(await calibrationHold('ca_p', 'marketing')).toBe(false);
  });

  it('a category whose acts fail is overconfident and HELD from promotion', async () => {
    for (let i = 0; i < 3; i++) await seedAction('product', 'failed');
    await seedPremise('product', 'falsified');
    await seedPremise('product', 'holding');
    const c = await getCategoryCalibration('ca_p', 'product');
    expect(c.score).toBeLessThan(0.6); // 1 good of 5
    expect(c.verdict).toBe('overconfident');
    expect(await calibrationHold('ca_p', 'product')).toBe(true);
  });

  it('thin evidence abstains — no false verdict, no hold', async () => {
    await seedAction('urgent', 'passed');
    const c = await getCategoryCalibration('ca_p', 'urgent');
    expect(c.verdict).toBe('thin');
    expect(c.score).toBeNull();
    expect(await calibrationHold('ca_p', 'urgent')).toBe(false);
  });

  it('calibration gates the promotion path even at the clean-cycle threshold', async () => {
    const { setPolicy, recordCleanCycle } = await import('../../src/services/autopilot/policy.js');
    await setPolicy('ca_p', 'product', 'shadow', 'ca_f');
    // Bank enough clean cycles to trip promotion, plus positive outcomes so
    // the quality hold does NOT fire — isolating the calibration gate.
    //
    // `outcome_valence` IS AN INTEGER VOCABULARY: 1, 0, -1. This seeded the
    // string 'positive', which every reader compares against 1 and therefore
    // read as NOT positive — so the fixture did not do what its comment says,
    // and the assertion passed for either reason. Migration 214 refuses the
    // string outright, which is how it surfaced.
    for (let i = 0; i < 12; i++) {
      await query(
        `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status, outcome_valence)
         VALUES (?, 'ca_p', 'product', 1, 'q', 'r', 'executed', 1)`, [nanoid()],
      );
      await recordCleanCycle('ca_p', 'product');
    }
    const mode = (await query("SELECT mode FROM autopilot_policies WHERE product_id='ca_p' AND category='product'", []))
      .rows[0] as Record<string, string>;
    expect(mode.mode).toBe('shadow'); // overconfident → promotion held despite cycles
  });
});

describe('self-audit catches over-deference', () => {
  // THE CHAT WAS ONE OF ITS TWO SOURCES, AND IT IS GONE.
  //
  // This seeded assistant turns in `conversation_messages`, because the audit
  // sampled them alongside notifications. The conversational surface is retired
  // and its service deleted, so that table takes no new rows and the audit no
  // longer reads it — reading it would score today's deference from last
  // fortnight's conversations, which is the failure this file exists to catch,
  // committed by the instrument.
  //
  // The behaviour under test never was chat-specific: it is whether the
  // institution asks permission, or hands over a menu, instead of saying what
  // it thinks. Notifications are what it says to the owner unprompted, and are
  // now the one live source — so the same three sentences are put there.
  beforeAll(async () => {
    const notes: Array<[string, string]> = [
      ['Churn', 'Churn crossed 8%. Do you want me to pause the campaign?'],
      ['Pricing', 'You could either raise prices or hold. Which would you prefer?'],
      ['Done', 'I paused the campaign and drafted the win-back email. It is in your queue.'],
    ];
    for (const [title, body] of notes) {
      await query(
        `INSERT INTO notifications (id, founder_id, product_id, type, title, body)
         VALUES (?, 'ca_f', 'ca_p', 'digest', ?, ?)`, [nanoid(), title, body]);
    }
  });

  it('flags permission-seeking and menu-handing in what it says unprompted', async () => {
    const audit = await runFleetSelfAudit();
    const kinds = audit.findings.map((f) => f.kind).sort();
    expect(kinds).toContain('permission_seeking');
    expect(kinds).toContain('menu_handing');
    // And the one that states what it did is not drift. A detector that flags
    // everything says nothing.
    expect(audit.findings.every((f) => !f.excerpt.includes('drafted the win-back'))).toBe(true);
  });

  it('samples what it actually has, and says how narrow that is', async () => {
    // WHAT THE RETIREMENT COST, WRITTEN DOWN. One source, not two. A rate over
    // a handful of notifications is a thinner reading than it was, and
    // `sampled` is the number that says so — so an operator can tell a low
    // deference rate from a small sample.
    const audit = await runFleetSelfAudit();
    expect(audit.sampled).toBeGreaterThan(0);
    expect(audit.findings.every((f) => f.source === 'notification')).toBe(true);
  });

  it('produces an operator letter line when drift exists', async () => {
    const line = await deferenceLine();
    expect(line).toContain('over-deference');
    expect(line).toContain('%');
  });
});
