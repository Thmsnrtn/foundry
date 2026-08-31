process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';
import { createDeterministicCapacityJudgment } from '../../src/services/institution/institutional-judgment.js';
import { runJudgmentObservationPass } from '../../src/services/institution/institutional-judgment-evaluation.js';

// =============================================================================
// A JUDGMENT CONTRADICTED BY A STRANGER.
//
// A capacity judgment is about the responsibilities that demand a contested
// resource. `conflict_identity`, `consequences_json` and the description all
// use that set. `responsibility_refs_json` stored something else: every active
// responsibility the pass happened to hand in.
//
// `runJudgmentObservationPass` reads that column to decide whether the time the
// company gave has run out. So any active responsibility passing any due date
// stamped the judgment `contradicted` — telling the founder their judgment had
// been falsified by events, and naming a responsibility with nothing to do with
// the resource.
//
// Third instance of one family today: the population has to be the subject.
// =============================================================================

const P = 'jcs_product';
const OWNER = 'jcs_owner';

/** A responsibility that demands `amount` of `resource`, or none if omitted. */
async function responsibility(id: string, title: string, demand?: { resource: string; amount: number }): Promise<void> {
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
    VALUES (?,?,'repository','development_need_observed','low','{}','seed')`, [`${id}_sig`, P]);
  await query(`INSERT INTO institutional_responsibilities
      (id,product_id,title,capability,state,discovery_evidence_ref)
    VALUES (?,?,?,'operations','visible',?)`, [id, P, title, `signal_event:${id}_sig`]);
  if (demand) {
    await recordReconstructionClaim({
      productId: P, subject: `responsibility:${id}`, predicate: 'resource_demand',
      value: { resource: demand.resource, amount: demand.amount },
      epistemicStatus: 'known', evidenceRefs: [{ kind: 'signal_event', id: `${id}_sig` }],
      derivationMethod: 'founder assertion', observedAt: new Date(),
    });
  }
}

/** A due date the company stated and that has already passed. */
async function overdue(id: string): Promise<void> {
  await query(
    "UPDATE institutional_responsibilities SET due_at=datetime('now','-2 days'), due_stated_by=? WHERE id=?",
    [OWNER, id]);
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)', [OWNER, 'jcs_c', 'o@example.com']);
  await query('INSERT INTO products (id,name,owner_id) VALUES (?,?,?)', [P, 'Contested Co', OWNER]);

  await recordReconstructionClaim({
    productId: P, subject: `product:${P}`, predicate: 'resource_capacity',
    value: { resource: 'saturday_hours', amount: 4 },
    epistemicStatus: 'known',
    evidenceRefs: [{ kind: 'product', id: P }],
    derivationMethod: 'founder assertion', observedAt: new Date(),
  });

  await responsibility('jcs_a', 'Saturday deliveries', { resource: 'saturday_hours', amount: 3 });
  await responsibility('jcs_b', 'Saturday classes', { resource: 'saturday_hours', amount: 3 });
  // A THIRD RESPONSIBILITY THAT WANTS NONE OF THE CONTESTED RESOURCE, and whose
  // date has passed. It is the stranger.
  await responsibility('jcs_c', 'Renew the insurance');
  await overdue('jcs_c');
});

describe('what a capacity judgment is about', () => {
  it('names only the responsibilities that demand the contested resource', async () => {
    const judgmentId = await createDeterministicCapacityJudgment(P, ['jcs_a', 'jcs_b', 'jcs_c']);
    expect(judgmentId).toBeTruthy();

    const row = (await query(
      'SELECT responsibility_refs_json, consequences_json FROM strategic_decisions_log WHERE id=?',
      [judgmentId])).rows[0] as Record<string, unknown>;
    const refs = JSON.parse(String(row.responsibility_refs_json)) as string[];
    expect([...refs].sort()).toEqual(['jcs_a', 'jcs_b']);

    // The column now describes the same set the consequences do, which is what
    // every other field in this row has always described.
    const consequences = JSON.parse(String(row.consequences_json)) as Array<{ responsibilityId: string }>;
    expect([...new Set(consequences.map((c) => c.responsibilityId))].sort()).toEqual(['jcs_a', 'jcs_b']);
  });

  it('is not contradicted by a stranger running out of time', async () => {
    // The pass only observes a judgment against evidence that genuinely FOLLOWS
    // it, and these timestamps are one-second resolution. Winding the judgment
    // back is what a real gap of minutes or days looks like here.
    await query("UPDATE strategic_decisions_log SET made_at=datetime('now','-1 hour') WHERE product_id=?", [P]);
    // New evidence after the judgment, so the pass has something to observe.
    await recordReconstructionClaim({
      productId: P, subject: `responsibility:jcs_a`, predicate: 'resource_demand',
      value: { resource: 'saturday_hours', amount: 3 },
      epistemicStatus: 'known', evidenceRefs: [{ kind: 'signal_event', id: 'jcs_a_sig' }],
      derivationMethod: 'founder assertion', observedAt: new Date(),
    });

    const observed = await runJudgmentObservationPass(P);
    expect(observed.length).toBeGreaterThan(0);
    // The conflict still stands and nothing IN it has run out of time, so the
    // honest report is that it is only partly observed — not that events have
    // falsified it.
    expect(observed.every((o) => o.observed !== 'contradicted')).toBe(true);
  });

  it('is contradicted when something it IS about runs out of time', async () => {
    // The distinction the column exists to make: a date passing on a
    // responsibility the judgment names is the owner's time actually running
    // out, which is what makes contradiction honest.
    await overdue('jcs_a');
    const observed = await runJudgmentObservationPass(P);
    expect(observed.some((o) => o.observed === 'contradicted')).toBe(true);
  });
});
