// =============================================================================
// Tests: The Protective Wrapper (AcreOS two-brain boundary ported, 2026-07-14)
// autonomy = min(setting, platform cap, earned trust) · consent ledger is the
// founder's shield · per-action attribution is the disclosed-agent trail ·
// the operator brain sees aggregates only (the Level-1/Level-2 data boundary).
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { effectiveMode, platformCap, isCappedBelow } from '../../src/services/autopilot/platform-cap.js';
import { setPolicy, getEffectiveMode } from '../../src/services/autopilot/policy.js';
import { hasActConsent, activeConsent, DISCLOSURE_VERSION } from '../../src/services/autopilot/consent.js';

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('pw_f','clk_pw','pw@t.co')", []);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES ('pw_p','WrapCo','pw_f','active')", []);
});

describe('primitive 1 — autonomy is a lattice: min(setting, platform cap)', () => {
  it('the platform cap only ever LOWERS the effective mode', () => {
    // outreach caps at suggest; a founder setting 'act' is clamped down.
    expect(platformCap('outreach')).toBe('suggest');
    expect(effectiveMode('act', 'outreach')).toBe('suggest');
    expect(effectiveMode('shadow', 'outreach')).toBe('shadow'); // never raised
    expect(isCappedBelow('act', 'outreach')).toBe(true);

    // money capabilities cap at shadow, permanently.
    expect(effectiveMode('act', 'refunds')).toBe('shadow');
    expect(effectiveMode('act', 'billing')).toBe('shadow');

    // customer success reaches third parties by the same post as outreach, and
    // was absent from the table — so it defaulted to 'act' and a model-assigned
    // churn score chose which named customers got mail. It is capped now, and
    // this asserts the cap rather than the old default.
    expect(platformCap('customer_success')).toBe('suggest');
    expect(effectiveMode('act', 'customer_success')).toBe('suggest');

    // A capability with no ceiling: the ladder alone governs. ABSENCE MEANS
    // MAXIMUM AUTONOMY, which is the whole reason the omission above mattered,
    // so the default is asserted deliberately rather than left implicit.
    expect(platformCap('an_unlisted_capability')).toBe('act');
    expect(effectiveMode('act', 'an_unlisted_capability')).toBe('act');
  });

  it('getEffectiveMode enforces the cap end-to-end, whatever the founder set', async () => {
    await setPolicy('pw_p', 'outreach', 'act', 'pw_f'); // founder tries to grant act
    expect(await getEffectiveMode('pw_p', 'outreach')).toBe('suggest'); // clamped
  });
});

describe('primitive 2 — the consent ledger (the founder shield)', () => {
  it('granting a capability to act records a versioned consent; dropping revokes it', async () => {
    expect(await hasActConsent('pw_p', 'customer_success')).toBe(false);

    await setPolicy('pw_p', 'customer_success', 'act', 'pw_f');
    const consent = await activeConsent('pw_p', 'customer_success');
    expect(consent).not.toBeNull();
    expect(consent!.disclosure_version).toBe(DISCLOSURE_VERSION);
    expect(await hasActConsent('pw_p', 'customer_success')).toBe(true);

    // Dropping below act revokes the consent — no lingering license.
    await setPolicy('pw_p', 'customer_success', 'suggest', 'pw_f');
    expect(await hasActConsent('pw_p', 'customer_success')).toBe(false);
  });

  it('the disclosure names the responsibility split and the not-advice line', async () => {
    const { DISCLOSURE_TEXT } = await import('../../src/services/autopilot/consent.js');
    expect(DISCLOSURE_TEXT).toMatch(/remain responsible/i);
    expect(DISCLOSURE_TEXT).toMatch(/not investment, legal, or tax advice/i);
  });
});

describe('primitive 3 — no autonomous act without live consent (+ attribution)', () => {
  beforeAll(async () => {
    await query(
      `INSERT INTO customers (id, product_id, owner_id, name, email, churn_risk, health_score, last_active_at)
       VALUES ('pw_c1','pw_p','pw_f','Risk','risk@cust.co',0.9,0.3,?)`,
      [new Date(Date.now() - 20 * 86_400_000).toISOString()],
    );
  });

  it("act WITHOUT recorded consent downgrades to a proposal — belt beyond the policy row", async () => {
    // Force the policy row to 'act' directly, bypassing setPolicy's consent record.
    await query("UPDATE autopilot_policies SET mode='act' WHERE product_id='pw_p' AND category='customer_success'", []);
    await query("UPDATE autonomy_consents SET revoked_at=CURRENT_TIMESTAMP WHERE product_id='pw_p' AND capability='customer_success'", []);
    expect(await hasActConsent('pw_p', 'customer_success')).toBe(false);

    const { runSuccessSweep } = await import('../../src/services/departments/success.js');
    const res = await runSuccessSweep('pw_p');
    expect(res.sent).toBe(0);          // did NOT act
    expect(res.proposed).toBe(1);      // downgraded to a proposal
  });

  it('live consent is still not enough, because the ceiling is above it', async () => {
    // THIS USED TO ASSERT THAT IT SENT, and it was the last line of defence in
    // the wrong order: consent was the only thing between a model's churn score
    // and a named customer's inbox, because the platform had no ceiling for
    // this capability at all. The lattice is min(setting, CAP, consent), and a
    // founder's live consent cannot climb above the cap.
    //
    // What the attribution trail contains WHEN it is reachable is asserted in
    // `attribution-under-a-lifted-ceiling.test.ts`, which is explicit about
    // hypothesising a ceiling this one pins to 'suggest'.
    await query("DELETE FROM action_executions WHERE product_id='pw_p'", []); // clear dedup
    // Realistic transition INTO act from below records fresh consent.
    await setPolicy('pw_p', 'customer_success', 'suggest', 'pw_f');
    await setPolicy('pw_p', 'customer_success', 'act', 'pw_f');
    expect(await hasActConsent('pw_p', 'customer_success')).toBe(true);

    const { runSuccessSweep } = await import('../../src/services/departments/success.js');
    const res = await runSuccessSweep('pw_p');
    expect(res.sent, 'consent does not lift a platform ceiling').toBe(0);
    expect(res.proposed).toBe(1);

    const attribution = await query(
      "SELECT reasoning FROM audit_log WHERE action_type='attribution:customer_success'", [],
    );
    expect(attribution.rows.length, 'nothing acted, so nothing is attributed').toBe(0);
  });
});

describe('primitive 4 — the operator brain sees aggregates only (Level-1/2 boundary)', () => {
  it('operator system lines never carry a customer PII value', async () => {
    const { getOperatorSystemLines } = await import('../../src/services/letter/operator-pack.js');
    const lines = (await getOperatorSystemLines()).join(' ');
    expect(lines).not.toContain('risk@cust.co'); // no customer email
    expect(lines).not.toMatch(/\b[\w.]+@[\w.]+\.[a-z]{2,}\b/i); // no email shape at all
  });

  it('the operator-pack source is structurally aggregate-only (COUNT/SUM, no row-content selects)', () => {
    const src = readFileSync('src/services/letter/operator-pack.ts', 'utf8');
    // No SELECT of PII-bearing columns into an operator line.
    expect(src).not.toMatch(/SELECT[^;]*\b(email|name|body|content|transcript)\b/i);
    // Every query is an aggregate.
    const selects = src.match(/SELECT[\s\S]*?FROM/gi) ?? [];
    for (const s of selects) expect(s).toMatch(/COUNT\(|SUM\(/i);
  });
});
