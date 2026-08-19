// =============================================================================
// Tests: what happened last time reaches the moment permission is asked for.
//
// Foundry records outcomes carefully. `verified_failure` is written when an
// independent observation says an assisted action did not work. A whole-system
// review then found that nothing reads it: no future proposal, plan,
// execution-time check or assisting candidacy consults an outcome. Foundry
// could send the reply that failed last week and nothing in the system would
// notice.
//
// The most consequential place that showed was the moment Foundry ASKS FOR
// MORE AUTHORITY. `getAssistingCandidates` ranked on how MANY checks it had
// run — counting `matched` and `deviated` equally — and never on how they
// turned out or on whether its previous actions had worked. So a
// responsibility Foundry predicted wrong five times out of five asked for
// permission in exactly the same words as one it got right every time, and a
// responsibility whose last assisted action demonstrably failed asked as
// though nothing had happened.
//
// LEARNING DOES NOT SILENTLY EXPAND AUTHORITY — and learning that things went
// badly must not be silently DROPPED while authority is being expanded. The
// founder is the one deciding; they get the record.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getAssistingCandidates } from '../../src/services/institution/assisting-admission.js';
import { grantAuthority, shadowWithVerdicts } from '../fixtures/responsibility-state.js';

const F = 'oa_founder';
const P = 'oa_product';
const R = 'oa_resp';

beforeAll(async () => {
  await runMigrations();
  // The ladder is WALKED, not set. `moveResponsibilityTo` climbs one rung at
  // a time with evidence naming signals this company actually recorded — so a
  // state this fixture reaches is a state the machine permits. Only the
  // assisted-action binding guard is suspended, because this file inserts
  // outbound actions purely as the "it was tried and it failed" input.
  await query('DROP TRIGGER IF EXISTS assisted_action_plan_guard');
});

beforeEach(async () => {
  await query(`DELETE FROM outbound_actions WHERE product_id = ?`, [P]);
  await query(`DELETE FROM autonomy_consents WHERE product_id = ?`, [P]);
  await query(`DELETE FROM responsibility_shadow_comparisons`);
  await query(`DELETE FROM responsibility_shadow_expectations`);
  await query(`DELETE FROM signal_events WHERE product_id = ?`, [P]);
  await query(`DELETE FROM responsibility_transitions`);
  await query(`DELETE FROM institutional_responsibilities WHERE product_id = ?`, [P]);
  await query(`DELETE FROM products WHERE id = ?`, [P]);
  await query(`DELETE FROM founders WHERE id = ?`, [F]);
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [F, 'clerk_oa', 'oa@test.local']);
  await query(
    `INSERT INTO products (id, name, owner_id, status, scp_status)
     VALUES (?, 'Watched Co', ?, 'active', 'active')`, [P, F]);
  await query(
    `INSERT INTO institutional_responsibilities
       (id, product_id, title, capability, state, disposition)
     VALUES (?, ?, 'Answer support mail', 'customer_support', 'unknown', 'active')`, [R, P]);
  await query(
    `INSERT OR IGNORE INTO signal_events (id, product_id, source, event_type, severity, payload_json, summary)
     VALUES ('oa_sig', ?, 'external_observation', 'company_observation', 'medium', '{}', 'fixture')`, [P]);
});

async function failedAction(id: string): Promise<void> {
  await query(
    `INSERT INTO outbound_actions
       (id, product_id, responsibility_id, status, outcome_status,
        agent_name, integration_name, action_type, rationale)
     VALUES (?, ?, ?, 'executed', 'verified_failure', 'atlas','resend','send_email','fixture')`,
    [id, P, R]);
}

describe('the request to help says how the watching went', () => {
  it('counts deviations separately from checks', async () => {
    await shadowWithVerdicts(R, P, ['matched', 'deviated', 'deviated']);

    const [candidate] = await getAssistingCandidates(P);
    expect(candidate, 'a watched responsibility should be a candidate').toBeTruthy();
    expect(candidate.comparisons).toBe(3);
    expect(candidate.deviations,
      'getting it wrong twice must not read as three checks and nothing else')
      .toBe(2);
  });

  it('reports no deviations when it got them all right', async () => {
    await shadowWithVerdicts(R, P, ['matched', 'matched']);
    const [candidate] = await getAssistingCandidates(P);
    expect(candidate.deviations).toBe(0);
  });

  it('reports an assisted action that was checked and failed', async () => {
    await shadowWithVerdicts(R, P, ['matched']);
    await failedAction('a1');
    const [candidate] = await getAssistingCandidates(P);
    expect(candidate.verifiedFailures,
      'Foundry asked to keep helping without mentioning that its last attempt failed')
      .toBe(1);
  });

  it('does not count an action whose outcome is still unknown as a failure', async () => {
    // Absence is not evidence. An effect nobody has reported on is unresolved,
    // and calling it a failure would be the same defect in the other
    // direction.
    await shadowWithVerdicts(R, P, ['matched']);
    await query(
      `INSERT INTO outbound_actions
         (id, product_id, responsibility_id, status, outcome_status,
          agent_name, integration_name, action_type, rationale)
       VALUES ('a_unknown', ?, ?, 'executed', NULL, 'atlas','resend','send_email','fixture')`,
      [P, R]);
    const [candidate] = await getAssistingCandidates(P);
    expect(candidate.verifiedFailures).toBe(0);
  });

  it('does not count another responsibility\'s failure', async () => {
    await shadowWithVerdicts(R, P, ['matched']);
    await query(
      `INSERT INTO institutional_responsibilities
         (id, product_id, title, capability, state, disposition)
       VALUES ('oa_other', ?, 'Something else', 'customer_support', 'unknown', 'active')`, [P]);
    await shadowWithVerdicts('oa_other', P, ['matched']);
    await query(
      `INSERT INTO outbound_actions
         (id, product_id, responsibility_id, status, outcome_status,
          agent_name, integration_name, action_type, rationale)
       VALUES ('a_other', ?, 'oa_other', 'executed', 'verified_failure', 'atlas','resend','send_email','fixture')`,
      [P]);
    const candidate = (await getAssistingCandidates(P)).find((c) => c.responsibilityId === R);
    expect(candidate!.verifiedFailures).toBe(0);
  });
});

describe('and the founder is shown it while deciding', () => {
  const letter = readFileSync('src/routes/dashboard/letter.ts', 'utf8');
  const section = letter.slice(letter.indexOf('const permissionSection'));
  const body = section.slice(0, section.indexOf('</div>`;'));

  it('says how many it got wrong', () => {
    expect(body).toContain('item.deviations');
    expect(body).toMatch(/got .* wrong/);
  });

  it('says plainly that the last attempt failed', () => {
    expect(body).toContain('item.verifiedFailures');
    expect(body, 'the founder decides; they get the record')
      .toMatch(/didn't work|failed/);
  });
});

// ── failure is learned, not punished ───────────────────────────────────────

describe('a verified failure does not revoke what the owner granted', () => {
  it('leaves the grant standing, and records the failure instead', async () => {
    // TRIED THE OTHER WAY AND IT WAS WRONG. `action-verifier.ts` demotes an
    // autopilot category when an autopilot-approved action fails its criteria,
    // and applies that only to `approved_by` starting `autopilot:` — so the
    // institution's own assisting path appears to escape a cost the autopilot
    // pays, and revoking its responsibility-bound grant looks like the
    // symmetric fix.
    //
    // It is not. Reducing what Foundry may do is always permitted, but a grant
    // is the OWNER'S decision, and cancelling it substitutes Foundry's
    // judgement for theirs — the founder granted permission knowing things
    // sometimes fail. The owner remains the only person who can withdraw it.
    //
    // The loop closes by making failure VISIBLE at the moment the founder
    // decides whether to keep helping, which the tests above cover. This one
    // pins the boundary so the appealing symmetric fix is not made twice.
    const { reconcileAssistedSupportEmail } = await import(
      '../../src/services/institution/responsibility-assisted-email.js');

    await shadowWithVerdicts(R, P, ['matched']);
    await grantAuthority(P, F, 'customer_support', R);
    await query(
      `INSERT INTO outbound_actions
         (id, product_id, responsibility_id, status, effect_id, outcome_status,
          agent_name, integration_name, action_type, rationale, approved_by)
       VALUES ('oa_act', ?, ?, 'executed', 'eff_1', 'unresolved',
               'institution:assisting','resend','send_email','fixture','institution:assisting')`,
      [P, R]);
    await query(
      `INSERT INTO signal_events (id, product_id, source, event_type, severity, payload_json, summary)
       VALUES ('oa_obs', ?, 'effect_outcome_report', 'effect_outcome:eff_1:failed', 'medium',
               ?, 'reported failed')`,
      [P, JSON.stringify({ effect_id: 'eff_1', verdict: 'failed', reporter: 'customer:acme' })]);

    expect(await reconcileAssistedSupportEmail(P, 'oa_act')).toBe('verified_failure');

    const live = await query(
      `SELECT id FROM autonomy_consents
        WHERE responsibility_id=? AND revoked_at IS NULL`, [R]);
    expect(live.rows, 'Foundry withdrew a permission only the owner may withdraw')
      .toHaveLength(1);

    // And the founder is told, which is the part that had been missing.
    const [candidate] = await getAssistingCandidates(P);
    expect(candidate.verifiedFailures).toBe(1);
  });
});
