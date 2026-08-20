// =============================================================================
// Tests: Activation funnel telemetry (Phase 5.2)
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { executeRaw, query } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { recordFunnelStep, getFunnelReadout, FUNNEL_STEPS, stepKind } from '../../src/services/telemetry/funnel.js';
import { recordConsent } from '../../src/services/privacy/consent.js';

// THE FUNNEL IS TWO PATHS NOW (owner decision §14). Service steps — signup,
// repo connected, trial, paid — are recorded against the account because
// running and billing it requires that. Telemetry steps — audit done, briefing
// viewed, decision approved — are recorded ONLY with the company's
// `product_improvement` consent, and then against a contributor hash.
//
// So a fixture that reaches a telemetry step has to consent first, the way a
// real company would. These tests used bare ids and no consent, which now
// records nothing — correctly.
const FOUNDERS = ['a', 'b', 'c', 'd', 'f1'];
const PRODUCTS = ['p', 'p1', 'p2'];

beforeAll(async () => {
  // The migrations are the schema. Tables this file used to write by hand are
  // already here, in the shape the product actually has — including the NOT
  // NULL columns and foreign keys a hand-written stand-in leaves out.
  await runMigrations();
  for (const f of FOUNDERS) {
    await query(`INSERT OR IGNORE INTO founders (id,clerk_user_id,email) VALUES (?,?,?)`,
      [f, `clerk_${f}`, `${f}@example.com`]);
  }
  for (const p of PRODUCTS) {
    await query(
      `INSERT OR IGNORE INTO products (id,name,owner_id,status) VALUES (?,?,'a','active')`,
      [p, `Co ${p}`]);
  }
});

beforeEach(async () => {
  await executeRaw('DELETE FROM funnel_events');
  await executeRaw('DELETE FROM product_telemetry_events');
  await executeRaw('DELETE FROM privacy_consents');
  // These fixtures are about the arithmetic, not about the gate — the gate has
  // its own file. Consent is granted so the telemetry half records at all.
  for (const p of PRODUCTS) await recordConsent(p, 'a', 'product_improvement', true);
});

describe('recordFunnelStep', () => {
  it('is idempotent per (founder, product, step)', async () => {
    await recordFunnelStep('signup', { founderId: 'f1' });
    await recordFunnelStep('signup', { founderId: 'f1' });
    await recordFunnelStep('signup', { founderId: 'f1' });
    const readout = await getFunnelReadout();
    expect(readout.find((r) => r.step === 'signup')!.count).toBe(1);
  });

  it('does nothing without a founder id', async () => {
    await recordFunnelStep('signup', { founderId: '' });
    expect(await getFunnelReadout()).toEqual(
      FUNNEL_STEPS.map((step, i) => ({
        step, count: 0, kind: stepKind(step), fromTop: 0, fromPrev: i === 0 ? 1 : 0,
      })),
    );
  });
});

describe('getFunnelReadout', () => {
  it('computes top-of-funnel and step-over-step conversion', async () => {
    // 4 signups, 2 reach audit_done, 1 pays.
    for (const f of ['a', 'b', 'c', 'd']) await recordFunnelStep('signup', { founderId: f });
    for (const f of ['a', 'b']) await recordFunnelStep('audit_done', { founderId: f, productId: 'p' });
    await recordFunnelStep('paid', { founderId: 'a' });

    const readout = await getFunnelReadout();
    const signup = readout.find((r) => r.step === 'signup')!;
    const audit = readout.find((r) => r.step === 'audit_done')!;
    const paid = readout.find((r) => r.step === 'paid')!;

    expect(signup.count).toBe(4);
    expect(signup.fromTop).toBe(1);
    expect(audit.count).toBe(2);
    expect(audit.fromTop).toBeCloseTo(0.5, 5);
    expect(paid.count).toBe(1);
    expect(paid.fromTop).toBeCloseTo(0.25, 5);

    // And each row says which population its count is over, because the
    // telemetry half counts consenting people only — a rate across the boundary
    // compares two different groups.
    expect(signup.kind).toBe('service');
    expect(audit.kind).toBe('telemetry');
    expect(paid.kind).toBe('service');
  });

  it('counts distinct founders per step, not raw rows', async () => {
    // Same founder, two products, both reached audit_done → still 1 founder.
    await recordFunnelStep('audit_done', { founderId: 'f1', productId: 'p1' });
    await recordFunnelStep('audit_done', { founderId: 'f1', productId: 'p2' });
    expect((await getFunnelReadout()).find((r) => r.step === 'audit_done')!.count).toBe(1);
  });
});
