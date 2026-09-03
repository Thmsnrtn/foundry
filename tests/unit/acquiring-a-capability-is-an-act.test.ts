process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  acquisitionsAwaiting, decideAcquisition, proposeAcquisition, proposeWhatIsMissing,
  recordAcquired,
} from '../../src/services/institution/acquisition.js';
import { capability, noteNeed } from '../../src/services/institution/capabilities.js';
import { consequenceAllows } from '../../src/services/institution/consequence.js';
import { fingerprint } from '../../src/services/institution/standing-intent.js';

// =============================================================================
// ACQUIRING A CAPABILITY IS AN ACT, AND IT HAS A DOOR.
//
// "I know what should happen but I cannot currently do it" is a proposal, not
// a stop. And the thing that keeps it honest: approving an acquisition makes a
// provider AVAILABLE and grants no act. Acquiring a way to send mail is not
// permission to send one — the acquired capability reaches the world only
// through the same outbound door, on the same rung, under the same boundaries.
// =============================================================================

const OWNER = 'acq_owner';
const CO = 'acq_co';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_acq', 'owner@example.com', 'Owner']);
  await query(`INSERT INTO products (id, name, owner_id, status, ingest_token)
    VALUES (?, 'Acq Co', ?, 'active', 'tok_acq')`, [CO, OWNER]);
});

describe('from a need to a proposal', () => {
  it('proposes what is missing, with the route, the cost and the reason', async () => {
    await noteNeed({ founderId: OWNER, subjectKind: 'company', subjectId: CO,
      capabilityKey: 'run_survey', why: 'to ask the customers who left why they went' });
    await noteNeed({ founderId: OWNER, subjectKind: 'company', subjectId: CO,
      capabilityKey: 'send_email', why: 'to tell them about a failed payment' });

    const ids = await proposeWhatIsMissing({
      founderId: OWNER, subjectKind: 'company', subjectId: CO, proposedBy: 'foundry' });
    expect(ids.length).toBeGreaterThan(0);

    const waiting = await acquisitionsAwaiting(OWNER);
    const survey = waiting.find((a) => a.capabilityKey === 'run_survey');
    expect(survey).toBeDefined();
    expect(survey?.because).toContain('why they went');
    // A GUESS NEVER READS AS A FACT: no provider is chosen, and it says so.
    expect(survey?.provider).toContain('not yet chosen');
    // And the sentence says what USING it would sit under, before he decides.
    expect(survey?.sentence).toContain('reach people outside');
  });

  it('does not ask twice for the same thing', async () => {
    const before = (await acquisitionsAwaiting(OWNER)).length;
    await proposeWhatIsMissing({
      founderId: OWNER, subjectKind: 'company', subjectId: CO, proposedBy: 'foundry' });
    expect((await acquisitionsAwaiting(OWNER)).length).toBe(before);
  });
});

describe('only the owner decides', () => {
  it('refuses a decision that is not his', async () => {
    const one = (await acquisitionsAwaiting(OWNER))[0];
    if (!one) throw new Error('expected a proposal');
    await expect(query(
      `UPDATE capability_acquisitions SET decision = 'approved', decided_at = datetime('now'),
              decided_by = 'agent:eager' WHERE id = ?`, [one.id]))
      .rejects.toThrow(/owner_only/);
  });

  it('refuses acquiring anything he did not approve', async () => {
    const one = (await acquisitionsAwaiting(OWNER))[0];
    if (!one) throw new Error('expected a proposal');
    await expect(recordAcquired({
      id: one.id, evidence: 'wired it up anyway', witnessedBy: 'foundry' }))
      .rejects.toThrow(/not_approved/);
  });
});

describe('approval gets the ability and grants no act', () => {
  it('makes the provider exist, available and unproven', async () => {
    const id = await proposeAcquisition({
      founderId: OWNER, capabilityKey: 'run_paid_experiment', route: 'new_provider',
      provider: 'an ad platform', how: 'api', costNote: 'whatever the experiment costs',
      because: 'the cheapest way to learn whether anyone wants it',
      proposedBy: 'foundry' });
    await decideAcquisition({ id, decision: 'approved', by: `founder:${OWNER}` });
    const providerId = await recordAcquired({
      id, evidence: 'adapter written and exercised in tests', witnessedBy: `founder:${OWNER}`,
      tool: 'run_paid_experiment_test' });

    const c = await capability('run_paid_experiment');
    expect(c?.providers.some((p) => p.id === providerId)).toBe(true);
    // AVAILABLE, NOT PROVEN. Proof is what happens next, witnessed.
    expect(c?.providers.find((p) => p.id === providerId)?.maturity).toBe('available');
  });

  it('grants nothing: the new tool still faces the same door on the same rung', async () => {
    // run_paid_experiment is financial. The acquisition approval does not put
    // a penny within reach — the door asks for an allowance or an approval,
    // exactly as it would for a provider that had been there for years.
    const verdict = await consequenceAllows({
      productId: CO, tool: 'run_paid_experiment_test',
      paramsFingerprint: fingerprint({ budget: 500 }) });
    expect(verdict.allowed).toBe(false);
    expect(verdict.rung).toBe('financial');
    expect(verdict.reason).toContain('neither allowed money');
  });
});

describe('declining', () => {
  it('is recorded, and the proposal does not come back', async () => {
    const waiting = await acquisitionsAwaiting(OWNER);
    const one = waiting[0];
    if (!one) throw new Error('expected a proposal');
    await decideAcquisition({ id: one.id, decision: 'declined', by: `founder:${OWNER}` });
    expect((await acquisitionsAwaiting(OWNER)).some((a) => a.id === one.id)).toBe(false);
    await expect(decideAcquisition({
      id: one.id, decision: 'approved', by: `founder:${OWNER}` })).resolves.toBeUndefined();
    const row = (await query(
      'SELECT decision FROM capability_acquisitions WHERE id = ?', [one.id]))
      .rows[0] as Record<string, unknown>;
    expect(String(row.decision)).toBe('declined');
  });
});
