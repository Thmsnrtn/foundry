process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  createWorkshop, destroy, history, provisionFor, read, run,
} from '../../src/services/workshop/index.js';
import { noteNeed, whatItWouldTake } from '../../src/services/institution/capabilities.js';
import {
  acquisitionsAwaiting, decideAcquisition, proposeWhatIsMissing, recordAcquired,
} from '../../src/services/institution/acquisition.js';
import { consequenceAllows } from '../../src/services/institution/consequence.js';
import { fingerprint } from '../../src/services/institution/standing-intent.js';

// =============================================================================
// THE WHOLE CHAIN, JOINED, ON A REAL COMPUTER.
//
//   missing capability → acquisition route → approval → provider becomes
//   available → NO AUTHORITY IS IMPLIED → the task receives only the
//   capability it requires → work executes → the result is verified.
//
// Each link had been proven on its own. What this proves is that they compose
// without a gap opening between them — in particular that an acquisition,
// having been approved, does not quietly widen what a workshop may do, and
// that a workshop is provisioned from what the work declared rather than from
// what somebody thought to type.
// =============================================================================

const OWNER = 'chain_owner';
const CO = 'chain_co';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_chain', 'owner@example.com', 'Owner']);
  await query(`INSERT INTO products (id, name, owner_id, status, ingest_token)
    VALUES (?, 'Chain Co', ?, 'active', 'tok_chain')`, [CO, OWNER]);
});

describe('the chain', () => {
  it('starts with work that declares what it needs, some of it missing', async () => {
    for (const [key, why] of [
      ['write_code_in_branch', 'to build the fix'],
      ['run_tests', 'to know whether the fix works'],
      ['run_survey', 'to ask the customers who left'],
      ['send_email', 'to tell them it is fixed'],
    ] as Array<[string, string]>) {
      await noteNeed({ founderId: OWNER, subjectKind: 'company', subjectId: CO,
        capabilityKey: key, why });
    }
    const needs = await whatItWouldTake({ subjectKind: 'company', subjectId: CO });
    const by = new Map(needs.map((n) => [n.capability.key, n.standing]));
    expect(by.get('run_survey')).toBe('missing');
  });

  it('proposes the route, and only the owner approves it', async () => {
    await proposeWhatIsMissing({
      founderId: OWNER, subjectKind: 'company', subjectId: CO, proposedBy: 'foundry' });
    const survey = (await acquisitionsAwaiting(OWNER))
      .find((a) => a.capabilityKey === 'run_survey');
    expect(survey).toBeDefined();
    await decideAcquisition({ id: survey?.id ?? '', decision: 'approved', by: `founder:${OWNER}` });
    await recordAcquired({ id: survey?.id ?? '', evidence: 'adapter written and exercised',
      witnessedBy: `founder:${OWNER}`, tool: 'run_survey_chain' });

    const needs = await whatItWouldTake({ subjectKind: 'company', subjectId: CO });
    // AVAILABLE, NOT PROVEN — so it is acquirable, not met. The chain does not
    // pretend a thing wired yesterday has been proven.
    expect(needs.find((n) => n.capability.key === 'run_survey')?.standing).toBe('acquirable');
  });

  it('implies no authority: the acquired tool still meets the same door', async () => {
    const verdict = await consequenceAllows({
      productId: CO, tool: 'run_survey_chain', paramsFingerprint: fingerprint({ ask: 'why' }) });
    // run_survey is public. Approving the acquisition put nobody within reach:
    // what governs a public act is his boundaries at the door, unchanged.
    expect(verdict.rung).toBe('public');
    const events = await history('nothing');
    expect(events).toEqual([]);
  });

  it('gives the workshop only what the work declared, and says what it withheld', async () => {
    const w = await createWorkshop({
      founderId: OWNER, purpose: 'self_development', ceiling: 'prepare',
      budgetCents: 500, substrate: 'local_process', createdBy: 'foundry',
      evidenceMode: 'reference' });

    const provisioned = await provisionFor({
      workshopId: w.id, subjectKind: 'company', subjectId: CO, grantedBy: 'foundry' });

    // What the work needs and the ceiling allows.
    expect(provisioned.granted).toContain('write_code_in_branch');
    expect(provisioned.granted).toContain('run_tests');
    // AND WHAT IT WITHHELD, WITH THE REASON. send_email is public and the
    // ceiling is prepare; run_survey is acquirable but its rung is public too.
    // Neither is quietly dropped.
    const refusedKeys = provisioned.refused.map((r) => r.capabilityKey);
    expect(refusedKeys).toContain('send_email');
    expect(provisioned.refused.find((r) => r.capabilityKey === 'send_email')?.because)
      .toContain('more consequential than this workshop was made for');

    // Nothing beyond what was declared, either — least privilege means the
    // workshop cannot do the things nobody asked for.
    const live = await read(w.id);
    expect(live.granted.sort()).toEqual(['run_tests', 'write_code_in_branch']);
  });

  it('executes real work with exactly those, and the result is verified', async () => {
    const w = (await query(
      `SELECT id FROM workspaces WHERE founder_id = ? AND destroyed_at IS NULL
        ORDER BY rowid DESC LIMIT 1`, [OWNER])).rows[0] as Record<string, unknown>;
    const id = String(w.id);

    await run({ workshopId: id,
      step: 'use:write_code_in_branch write half.mjs export const half = (n) => n / 2;' });
    const ran = await run({ workshopId: id,
      step: 'use:run_tests node --input-type=module -e '
        + '"import {half} from \'./half.mjs\'; if (half(9)!==4.5) process.exit(1); console.log(\'ok:4.5\')"' });
    // The proof is what the program printed, not that a step returned true.
    expect(ran.ok).toBe(true);
    expect(ran.output).toContain('ok:4.5');

    // And the thing it was never granted is still refused, after real work.
    const refused = await run({ workshopId: id, step: 'use:send_email node -e "1"' });
    expect(refused.ok).toBe(false);
    expect(refused.output).toContain('not granted');

    await destroy({ workshopId: id, preserved: 'half.mjs, verified at 4.5' });
    const after = await read(id);
    expect(after.destroyed).toBe(true);
    expect(after.spentCents).toBeGreaterThan(0);
  });
});
