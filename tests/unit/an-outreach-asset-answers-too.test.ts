// =============================================================================
// AN ASSET THAT WRITES TO PEOPLE ANSWERS THE SEVEN QUESTIONS TOO.
//
// Roadmap A6 and A7. The seven answers (`operating-contract.ts`) were written
// for a listing on a venue. For an asset that writes to people and takes
// payment by link — the Workshop's outreach tests — two of them said nothing
// true: "What has the account been shown to do?" answered "not assessed here
// for this kind of asset yet", and "What if it is interrupted?" answered that
// it was not assessed either. Both had answers already, in readers that
// decide them: whether sending is set up and has been accepted, whether a
// payment has come through, what the last pass achieved, and how an
// interrupted offer, delivery or refund is recovered — which the laboratory
// has shown across a month of a portfolio.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '6'.repeat(64);
process.env.FOUNDRY_OWNER_EMAIL = 'oa@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { seedProof1 } from '../../src/services/venture/proof-1.js';
import { beginExperimentalAsset } from '../../src/services/venture/asset.js';
import { recordRun } from '../../src/services/venture/run-state.js';
import { operatingContractOf } from '../../src/services/venture/operating-contract.js';

const OWNER = 'oa_owner';
let X = '';
let ASSET = '';
const answer = async (n: number) => (await operatingContractOf(ASSET, OWNER))!.answers[n - 1];

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_oa', 'oa@example.com', 'Owner']);
  X = (await seedProof1(OWNER)).experimentId;
  await query(`UPDATE venture_experiments SET decision = 'approved', decided_by = 'founder:oa_owner', decided_at = datetime('now') WHERE id = ?`, [X]);
  const a = await beginExperimentalAsset({ experimentId: X, by: 'founder:oa_owner' });
  if ('refused' in a) throw new Error(a.refused);
  ASSET = a.productId;
});

describe('what the account has been shown to do', () => {
  it('is assessed, not "not assessed": sending, payment, and what the last pass achieved', async () => {
    await recordRun(X, OWNER, { state: 'blocked', attempting: 'writing the approved offers',
      because: 'the mail provider refused the request', dependency: 'mail', progressed: false });
    const a = await answer(3);
    expect(a.answer).not.toMatch(/not assessed/i);
    expect(a.answer).toMatch(/Messages for tests go out as you|cannot tell which one/);
    expect(a.answer).toMatch(/nothing has been paid/i);
    expect(a.answer).toMatch(/last pass .*blocked.*the mail provider refused the request/i);
    expect(a.known).toBe('unknown');
  });
});

describe('what if it is interrupted', () => {
  it('says how each act is recovered, where that was shown, and what is waiting now', async () => {
    // An offer that failed, as the hand leaves one. Admitting it for real takes
    // the whole authorisation chain, which other tests prove; this one lifts
    // the birth guard for the one row and restores it exactly as it was.
    const guard = String(((await query(`SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'experiment_action_plan_guard'`))
      .rows[0] as Record<string, unknown>).sql);
    await query('DROP TRIGGER experiment_action_plan_guard');
    await query(
      `INSERT INTO outbound_actions (id, product_id, agent_name, integration_name, action_type, status, parameters_json, rationale,
         experiment_id, experiment_act)
       VALUES ('oa_offer_1', ?, 'institution:hand', 'resend', 'send_email', 'failed', '{}', 'the approved offer', ?, 'offer')`,
      [ASSET, X]);
    await query(guard);
    const a = await answer(6);
    expect(a.answer).not.toMatch(/not assessed/i);
    expect(a.answer).toMatch(/kept as failed and goes out once/);
    expect(a.answer).toMatch(/nobody is written to twice/);
    expect(a.answer).toMatch(/a refund is owed/);
    expect(a.answer).toMatch(/shown in the laboratory/);
    expect(a.answer).toMatch(/1 offer failed and is waiting to go again/);
    expect(a.known).toBe('partly');
  });
});
