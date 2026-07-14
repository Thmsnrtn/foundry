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
import { runSelfAudit, deferenceLine } from '../../src/services/autopilot/self-audit.js';

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
    for (let i = 0; i < 12; i++) {
      await query(
        `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status, outcome_valence)
         VALUES (?, 'ca_p', 'product', 1, 'q', 'r', 'executed', 'positive')`, [nanoid()],
      );
      await recordCleanCycle('ca_p', 'product');
    }
    const mode = (await query("SELECT mode FROM autopilot_policies WHERE product_id='ca_p' AND category='product'", []))
      .rows[0] as Record<string, string>;
    expect(mode.mode).toBe('shadow'); // overconfident → promotion held despite cycles
  });
});

describe('self-audit catches over-deference', () => {
  beforeAll(async () => {
    await query("INSERT INTO conversation_threads (id, product_id, founder_id) VALUES ('ca_t','ca_p','ca_f')", []);
    const msgs = [
      ['assistant', 'Churn crossed 8%. Do you want me to pause the campaign?'], // permission_seeking
      ['assistant', 'You could either raise prices or hold. Which would you prefer?'], // menu_handing
      ['assistant', 'I paused the campaign and drafted the win-back email. It is in your queue.'], // clean
      ['user', 'should I be worried?'], // founder's own words — never flagged
    ];
    for (const [role, content] of msgs) {
      await query(
        `INSERT INTO conversation_messages (id, thread_id, role, content) VALUES (?, 'ca_t', ?, ?)`,
        [nanoid(), role, content],
      );
    }
  });

  it('flags permission-seeking and menu-handing in system output only', async () => {
    const audit = await runSelfAudit();
    const kinds = audit.findings.map((f) => f.kind).sort();
    expect(kinds).toContain('permission_seeking');
    expect(kinds).toContain('menu_handing');
    // The founder's own "should I be worried?" is role=user → not sampled/flagged.
    expect(audit.findings.every((f) => f.source !== 'chat' || !f.excerpt.includes('be worried'))).toBe(true);
  });

  it('produces an operator letter line when drift exists', async () => {
    const line = await deferenceLine();
    expect(line).toContain('over-deference');
    expect(line).toContain('%');
  });
});
