process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '5'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { healthOf, nextPassAfter } from '../../src/services/founder/health.js';

// =============================================================================
// HEALTH IS A STATE, NOT A PARAGRAPH.
//
// "Part of me has stopped running, nothing is lost, I am the one that has to
// recover" is a sentence the owner has to read to the end to learn whether he
// is needed. The reader here answers as rows: what failed, whether it recovers
// on its own, whether anybody outside is affected, whether money is at risk,
// what only he can do. And quiet is a finding from the same reader, not a
// default: "Healthy" is what the records say when nothing is wrong.
// =============================================================================

const OWNER = 'health_owner';
let X = '';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_health', 'owner@example.com', 'Owner']);
  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const { designExperiment } = await import('../../src/services/venture/validation.js');
  const m = await openMandate({ founderId: OWNER, statement: 'Something small', shape: null, evidenceMode: 'real' });
  if ('refused' in m) throw new Error(m.refused);
  await query(`INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
     VALUES ('opp_h',?,?,'a brief','shops','scattered','somebody pays','nobody pays','[]','real')`, [m.id, OWNER]);
  await query(`INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test) VALUES ('unk_h',?,'opp_h','will anyone pay',1,'write once')`, [OWNER]);
  X = await designExperiment({ founderId: OWNER, opportunityId: 'opp_h', unknownId: 'unk_h', evidenceMode: 'real',
    whatWeDo: 'write once', whatWeExpect: 'one pays', wouldDisprove: 'none pays', costCents: 0 });
});

describe('the estate, as rows', () => {
  it('is healthy when the records say nothing is wrong — and says so from the records', async () => {
    const h = await healthOf(OWNER);
    expect(h.state).toBe('ok');
    expect(h.word).toBe('Healthy');
    expect(h.failed).toEqual([]);
    expect(h.recovering).toBe('nothing to recover');
    expect(h.ownerAction).toBeNull();
    expect(h.customerEffect).toBe('none');
    expect(h.moneyAtRisk).toBe('none');
  });

  it('a stopped routine is degraded and recovering on its own, and names what stopped', async () => {
    await query(`INSERT INTO job_health (job_name, consecutive_failures, last_failure_at, last_error_name, last_success_at)
      VALUES ('institutional_judgment_tick', 3, datetime('now'), 'TypeError', datetime('now','-2 days'))`);
    const h = await healthOf(OWNER);
    expect(h.state).toBe('degraded');
    expect(h.failed.join(' ')).toMatch(/judgments.*3 times running/);
    expect(h.recovering).toBe('automatically');
    expect(h.ownerAction).toBeNull();
    expect(h.customerEffect).toBe('none');
    expect(h.lastHealthy).not.toBeNull();
    await query(`DELETE FROM job_health WHERE job_name = 'institutional_judgment_tick'`);
  });

  it('a blocked pass outranks a stopped routine, says a test is not progressing, and names what only he can do', async () => {
    const { recordRun } = await import('../../src/services/venture/run-state.js');
    await recordRun(X, OWNER, { state: 'blocked', attempting: 'writing to the businesses you approved',
      because: 'the Workshop has no sending identity', dependency: 'resend', ownerAction: 'connect sending in the Workshop', progressed: false });
    const h = await healthOf(OWNER);
    expect(h.state).toBe('blocked');
    expect(h.word).toBe('1 pass blocked');
    expect(h.failed[0]).toContain('writing to the businesses you approved');
    expect(h.recovering).toBe('stuck');
    expect(h.ownerAction).toBe('connect sending in the Workshop');
    expect(h.customerEffect).toBe('a running test is not progressing');
  });

  it('knows when the hand next passes, from its schedule', () => {
    expect(nextPassAfter(new Date('2026-09-13T01:05:00Z'))).toBe('2026-09-13T01:20:00.000Z');
    expect(nextPassAfter(new Date('2026-09-13T01:20:00Z'))).toBe('2026-09-13T02:20:00.000Z');
    expect(nextPassAfter(new Date('2026-09-13T23:45:00Z'))).toBe('2026-09-14T00:20:00.000Z');
  });
});
