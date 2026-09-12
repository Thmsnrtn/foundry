process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { readRun, recordRun, runStateOf, whatIsBlocked } from '../../src/services/venture/run-state.js';

// =============================================================================
// A BLOCKED PASS IS NOT A QUIET ONE.
//
// The owner authorised Experiment 001. The hourly hand then ran, could not
// create a payment link because the governed Stripe door had no registered
// handler, put a sentence in an array nobody reads, and recorded a SUCCESS.
// Every hour. Nothing reached the twenty-one businesses and nothing reached
// the owner, who could only report that he "just can't see what it's doing".
//
// The boundary held. What failed was the institution's account of itself.
// These tests hold the distinction the outage needed: an authorised act that
// moved nothing because a dependency refused is BLOCKED, and blocked is never
// success.
// =============================================================================

const OWNER = 'runstate_owner';
let X = '';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_rs', 'rs@example.com', 'Owner']);
  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const { designExperiment } = await import('../../src/services/venture/validation.js');
  const m = await openMandate({ founderId: OWNER, statement: 'Make the river stronger', shape: null, evidenceMode: 'real' });
  if ('refused' in m) throw new Error(m.refused);
  await query(
    `INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
     VALUES ('opp_rs',?,?,'a brief','MA millwork shops','scattered','somebody sells it','nobody pays','[]','real')`, [m.id, OWNER]);
  await query(`INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test)
     VALUES ('unk_rs',?,'opp_rs','will anyone pay',1,'write once')`, [OWNER]);
  X = await designExperiment({
    founderId: OWNER, opportunityId: 'opp_rs', unknownId: 'unk_rs', evidenceMode: 'real',
    whatWeDo: 'write once', whatWeExpect: 'one pays', wouldDisprove: 'none pays', costCents: 0 });
});

describe('the state is read from what happened, not from what was caught', () => {
  it('calls an authorised act that moved nothing on a dead dependency BLOCKED', () => {
    // The exact shape of the outage.
    const r = readRun({
      authorised: true, intended: 5, achieved: 0,
      exceptions: ["offer not placed: policy: no trusted policy registered for tool 'stripe_create_payment_link'"],
      attempting: 'writing to the businesses you approved',
    });
    expect(r.state).toBe('blocked');
    expect(r.progressed).toBe(false);
    expect(r.because).toMatch(/no trusted policy/);
    expect(r.dependency).toMatch(/payment provider/);
    // An internal dependency is the institution's to repair, not the owner's.
    expect(r.ownerAction).toBeNull();
  });

  it('never calls a blocked pass successful, however many exceptions it caught', () => {
    for (const because of [
      'offer not placed: Stripe is not configured for this deployment',
      'page not published: the public page could not be seen',
      'no asset',
    ]) {
      const r = readRun({ authorised: true, intended: 5, achieved: 0, exceptions: [because], attempting: 'x' });
      expect(r.state, because).not.toBe('success');
      expect(['blocked', 'failed']).toContain(r.state);
    }
  });

  it('distinguishes an authorised experiment with nothing to do from one that is stopped', () => {
    const idle = readRun({ authorised: true, intended: 0, achieved: 0, exceptions: [], attempting: 'x' });
    expect(idle.state).toBe('noop_expected');
    const stopped = readRun({ authorised: true, intended: 5, achieved: 0, exceptions: [], attempting: 'x' });
    expect(stopped.state, 'work to do, none done, nothing said why').toBe('blocked');
  });

  it('reports partial and degraded rather than rounding either to success', () => {
    expect(readRun({ authorised: true, intended: 5, achieved: 2, exceptions: [], attempting: 'x' }).state).toBe('partial');
    expect(readRun({ authorised: true, intended: 5, achieved: 5, exceptions: ['a receipt could not be read'], attempting: 'x' }).state).toBe('degraded');
    expect(readRun({ authorised: true, intended: 5, achieved: 5, exceptions: [], attempting: 'x' }).state).toBe('success');
  });
});

describe('the failure reaches canonical state, not an array nobody reads', () => {
  it('records a blocked run where the owner surface can find it', async () => {
    await recordRun(X, OWNER, readRun({
      authorised: true, intended: 21, achieved: 0,
      exceptions: ["offer not placed: policy: no trusted policy registered for tool 'stripe_create_payment_link'"],
      attempting: 'writing to the 21 businesses you approved',
    }));
    const got = await runStateOf(X);
    expect(got?.state).toBe('blocked');
    expect(got?.attempting).toMatch(/21 businesses/);
    expect(got?.progressed).toBe(false);
    expect(await whatIsBlocked(OWNER)).toHaveLength(1);
  });

  it('refuses to record a bad state with no reason, which would be the silence again', async () => {
    await expect(query(
      `INSERT INTO experiment_run_state (experiment_id, founder_id, state, attempting, because)
       VALUES ('x_no_reason', ?, 'blocked', 'something', '')`, [OWNER]))
      .rejects.toThrow(/a_bad_state_needs_a_reason/);
  });

  it('clears once the dependency recovers, without anybody re-authorising anything', async () => {
    await recordRun(X, OWNER, readRun({
      authorised: true, intended: 5, achieved: 5, exceptions: [], attempting: 'writing to the businesses you approved' }));
    const got = await runStateOf(X);
    expect(got?.state).toBe('success');
    expect(got?.progressed).toBe(true);
    expect(await whatIsBlocked(OWNER)).toHaveLength(0);
  });
});
