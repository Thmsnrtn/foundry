process.env.TURSO_DATABASE_URL = 'file::memory:';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';
import {
  createDeterministicCapacityJudgment, runInstitutionalJudgmentPass,
} from '../../src/services/institution/institutional-judgment.js';
import { runJudgmentObservationPass } from '../../src/services/institution/institutional-judgment-evaluation.js';

// =============================================================================
// Institutional judgment had no production writer. The machinery, the owner
// disposition ledger, and the founder-facing section were all built, and
// nothing outside the test suite ever created a judgment — so the section could
// only ever be empty and the subsystem paid no rent.
//
// Wiring a producer to a schedule is only safe if two things are true: a
// standing conflict cannot re-ask the owner the same question forever, and an
// observation of later reality cannot confirm the judgment using the judgment's
// own inputs. Both are enforced by the database, not by the caller.
// =============================================================================

async function countOf(sql: string, args: unknown[] = []): Promise<number> {
  const r = await query(sql, args);
  return Number((r.rows[0] as Record<string, unknown>).n);
}

async function claim(
  productId: string, subject: string, predicate: string, value: unknown,
): Promise<string> {
  return recordReconstructionClaim({
    productId, subject, predicate, value, epistemicStatus: 'known',
    evidenceRefs: [{ kind: 'signal_event', id: `${productId}_sig` }],
    derivationMethod: 'observed company reality', observedAt: new Date(),
  });
}

/** Build a company whose two responsibilities together demand more than it has. */
async function overSubscribedCompany(prefix: string): Promise<string> {
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
    [`${prefix}_f`, `${prefix}_clerk`, `${prefix}@example.com`]);
  await query('INSERT INTO products (id,name,owner_id) VALUES (?,?,?)',
    [prefix, `${prefix} Co`, `${prefix}_f`]);
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
    VALUES (?,?,'support','support_spike','medium','{}','Two commitments landed in the same week')`,
  [`${prefix}_sig`, prefix]);
  await query(`INSERT INTO institutional_responsibilities (id,product_id,title,capability,state) VALUES
    (?,?,'Answer customers','support','visible'), (?,?,'Ship the migration','development','visible')`,
  [`${prefix}_a`, prefix, `${prefix}_b`, prefix]);
  await claim(prefix, `product:${prefix}`, 'resource_capacity', { resource: 'engineering_days', amount: 5 });
  await claim(prefix, `responsibility:${prefix}_a`, 'resource_demand', { resource: 'engineering_days', amount: 4 });
  await claim(prefix, `responsibility:${prefix}_b`, 'resource_demand', { resource: 'engineering_days', amount: 4 });
  return prefix;
}

/** Claims are compared by recording time, so a test that needs "later" evidence
 * must actually place the judgment earlier. */
async function backdateJudgment(judgmentId: string, seconds: number): Promise<void> {
  await query("UPDATE strategic_decisions_log SET made_at=datetime(made_at,'-' || ? || ' seconds') WHERE id=?",
    [String(seconds), judgmentId]);
}

beforeAll(async () => {
  await runMigrations();
});

describe('institutional judgment in production', () => {
  it('raises a judgment from real institutional state, and only once', async () => {
    const p = await overSubscribedCompany('jp_standing');
    const first = await runInstitutionalJudgmentPass(p);
    expect(first.raised).toBe(true);
    expect(first.judgmentId).not.toBeNull();

    // The scheduled pass runs every few hours. A standing conflict must not
    // become a standing interruption: the same conflict is recognised, not
    // re-raised. Founder attention is a real cost.
    for (let tick = 0; tick < 3; tick++) {
      const again = await runInstitutionalJudgmentPass(p);
      expect(again).toEqual({ judgmentId: first.judgmentId, raised: false });
    }
    expect(await countOf('SELECT COUNT(*) n FROM strategic_decisions_log WHERE product_id=?', [p])).toBe(1);
  });

  it('raises nothing when the company is not over-subscribed', async () => {
    const p = 'jp_healthy';
    await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)', [`${p}_f`, `${p}_c`, `${p}@e.com`]);
    await query('INSERT INTO products (id,name,owner_id) VALUES (?,?,?)', [p, 'Healthy Co', `${p}_f`]);
    await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
      VALUES (?,?,'support','support_spike','low','{}','Normal week')`, [`${p}_sig`, p]);
    await query(`INSERT INTO institutional_responsibilities (id,product_id,title,capability,state) VALUES
      (?,?,'Answer customers','support','visible'), (?,?,'Ship the migration','development','visible')`,
    [`${p}_a`, p, `${p}_b`, p]);
    await claim(p, `product:${p}`, 'resource_capacity', { resource: 'engineering_days', amount: 10 });
    await claim(p, `responsibility:${p}_a`, 'resource_demand', { resource: 'engineering_days', amount: 3 });
    await claim(p, `responsibility:${p}_b`, 'resource_demand', { resource: 'engineering_days', amount: 3 });

    expect(await runInstitutionalJudgmentPass(p)).toEqual({ judgmentId: null, raised: false });
    expect(await countOf('SELECT COUNT(*) n FROM strategic_decisions_log WHERE product_id=?', [p])).toBe(0);
  });

  it('grants no authority and changes no responsibility state', async () => {
    const p = 'jp_authority';
    await overSubscribedCompany(p);
    const before = {
      consents: await countOf('SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=?', [p]),
      transitions: await countOf(
        `SELECT COUNT(*) n FROM responsibility_transitions rt
           JOIN institutional_responsibilities r ON r.id=rt.responsibility_id WHERE r.product_id=?`, [p]),
      states: (await query('SELECT id,state FROM institutional_responsibilities WHERE product_id=? ORDER BY id', [p])).rows,
    };
    const { judgmentId } = await runInstitutionalJudgmentPass(p);

    // A judgment is a recommendation with provenance. It is not permission, and
    // it does not move anything up the ladder on its own.
    expect(await countOf('SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=?', [p])).toBe(before.consents);
    expect(await countOf(
      `SELECT COUNT(*) n FROM responsibility_transitions rt
         JOIN institutional_responsibilities r ON r.id=rt.responsibility_id WHERE r.product_id=?`, [p]))
      .toBe(before.transitions);
    expect((await query('SELECT id,state FROM institutional_responsibilities WHERE product_id=? ORDER BY id', [p])).rows)
      .toEqual(before.states);
    expect((await query('SELECT authority_required_json FROM strategic_decisions_log WHERE id=?', [judgmentId!])).rows[0])
      .toMatchObject({ authority_required_json: expect.stringContaining('"required":true') });
  });

  it('refuses to let an ordinary decision squat a conflict identity', async () => {
    // Without this, any row could occupy the slot a real judgment needs and
    // suppress it permanently.
    await expect(query(
      `INSERT INTO strategic_decisions_log (id,product_id,decision_title,decision_description,conflict_identity)
       VALUES ('jp_squat','jp_standing','Squat','No provenance','capacity:engineering_days:deadbeefdeadbeef')`, []))
      .rejects.toThrow(/not_institutional/);

    // And identity cannot be moved once set — that would re-point one
    // conflict's history at another.
    await expect(query(
      "UPDATE strategic_decisions_log SET conflict_identity='capacity:other:0000000000000000' WHERE product_id='jp_standing'", []))
      .rejects.toThrow(/immutable/);
  });

  it('says nothing about later reality until later reality exists', async () => {
    const p = 'jp_quiet';
    await overSubscribedCompany(p);
    await runInstitutionalJudgmentPass(p);

    // Every claim about capacity predates the judgment. There is no news, so
    // the observer stays silent rather than manufacturing a confirmation.
    expect(await runJudgmentObservationPass(p)).toEqual([]);
    expect(await countOf(
      "SELECT COUNT(*) n FROM signal_events WHERE product_id=? AND source='institutional_judgment_observation'", [p]))
      .toBe(0);
    expect(await countOf('SELECT COUNT(*) n FROM institutional_judgment_evaluations WHERE product_id=?', [p])).toBe(0);
  });

  it('observes a conflict the company later resolved, and reports it supported', async () => {
    const p = 'jp_resolved';
    await overSubscribedCompany(p);
    const { judgmentId } = await runInstitutionalJudgmentPass(p);
    await backdateJudgment(judgmentId!, 60);

    // The owner raised capacity. That is new evidence, recorded after the
    // judgment, and it settles the conflict the judgment was about.
    await claim(p, `product:${p}`, 'resource_capacity', { resource: 'engineering_days', amount: 12 });

    expect(await runJudgmentObservationPass(p)).toEqual([{ judgmentId, observed: 'supported' }]);

    // Re-running the pass on the same evidence is the same observation, not a
    // new one: the judgment's history does not inflate with every tick.
    expect(await runJudgmentObservationPass(p)).toEqual([]);
    expect(await countOf('SELECT COUNT(*) n FROM institutional_judgment_evaluations WHERE product_id=?', [p])).toBe(1);
  });

  it('reports a still-standing conflict as partially observed, never contradicted', async () => {
    const p = 'jp_persisting';
    await overSubscribedCompany(p);
    const { judgmentId } = await runInstitutionalJudgmentPass(p);
    await backdateJudgment(judgmentId!, 60);

    // New evidence arrives and the company is still over-subscribed. Nothing
    // has been falsified — the owner may not have acted yet — so the observer
    // must not upgrade "not resolved" into "wrong".
    await claim(p, `responsibility:${p}_a`, 'resource_demand', { resource: 'engineering_days', amount: 1 });
    expect(await runJudgmentObservationPass(p)).toEqual([{ judgmentId, observed: 'partially_observed' }]);
    expect(await countOf(
      `SELECT COUNT(*) n FROM signal_events WHERE product_id=? AND event_type='judgment_expected_contradicted'`, [p]))
      .toBe(0);
  });

  it('refuses an observation grounded in evidence older than the judgment', async () => {
    // The whole value of the comparison is that evidence follows the prediction
    // it tests. A claim that predates the judgment cannot be news about it, and
    // same-second evidence is ambiguous, so both are refused by the database.
    const p = 'jp_backdated';
    await overSubscribedCompany(p);
    const { judgmentId } = await runInstitutionalJudgmentPass(p);
    const priorClaimId = String(((await query(
      `SELECT id FROM reconstruction_claims WHERE product_id=? ORDER BY created_at LIMIT 1`, [p]))
      .rows[0] as Record<string, unknown>).id);

    await expect(query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('jp_bad',?,'institutional_judgment_observation','judgment_expected_supported','low',?,'Fabricated')`,
      [p, JSON.stringify({ judgment_id: judgmentId, evidence_claim_ids: [priorClaimId], resolved: true })],
    )).rejects.toThrow(/evidence_not_later/);
  });

  it('refuses an observation that echoes the judgment it is being compared against', async () => {
    // An observer that can restate the expectation makes a fabricated
    // confirmation indistinguishable from a real one — the same independence
    // rule migration 119 established for development verification.
    const p = 'jp_circular';
    await overSubscribedCompany(p);
    const { judgmentId } = await runInstitutionalJudgmentPass(p);
    await backdateJudgment(judgmentId!, 60);
    const laterClaim = await claim(p, `product:${p}`, 'resource_capacity', { resource: 'engineering_days', amount: 12 });

    for (const echo of [
      { expected_outcome: 'Owner selects a bounded allocation' },
      { alternatives_considered: ['defer one demand'] },
      { conflict_identity: 'capacity:engineering_days:0000000000000000' },
    ]) {
      await expect(query(
        `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
         VALUES (?,?,'institutional_judgment_observation','judgment_expected_supported','low',?,'Echo')`,
        [`jp_echo_${Object.keys(echo)[0]}`, p,
          JSON.stringify({ judgment_id: judgmentId, evidence_claim_ids: [laterClaim], resolved: true, ...echo })],
      )).rejects.toThrow(/circular_grounding/);
    }
  });

  it('cannot observe another company\'s judgment', async () => {
    const p = 'jp_tenant_a';
    await overSubscribedCompany(p);
    const other = await overSubscribedCompany('jp_tenant_b');
    const { judgmentId } = await runInstitutionalJudgmentPass(p);
    await backdateJudgment(judgmentId!, 60);
    const otherClaim = await claim(other, `product:${other}`, 'resource_capacity', { resource: 'engineering_days', amount: 12 });

    await expect(query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('jp_cross',?,'institutional_judgment_observation','judgment_expected_supported','low',?,'Cross tenant')`,
      [other, JSON.stringify({ judgment_id: judgmentId, evidence_claim_ids: [otherClaim], resolved: true })],
    )).rejects.toThrow(/judgment_invalid/);
  });

  it('is wired to a scheduled pass, so the founder-facing loop has a supply', () => {
    // The defect this slice closes was an orphan: machinery with no writer. The
    // wiring itself is therefore part of the contract.
    const registry = readFileSync(resolve(process.cwd(), 'src/jobs/index.ts'), 'utf8');
    expect(registry).toMatch(/institutional_judgment_tick/);
    expect(registry).toMatch(/runInstitutionalJudgmentPass/);
    expect(registry).toMatch(/runJudgmentObservationPass/);
  });
});
