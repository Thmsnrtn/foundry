process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';
import { runInstitutionalJudgmentPass } from '../../src/services/institution/institutional-judgment.js';
import { runJudgmentObservationPass } from '../../src/services/institution/institutional-judgment-evaluation.js';
import { getJudgmentRecord } from '../../src/services/institution/institutional-judgment-disposition.js';

async function claim(productId: string, subject: string, predicate: string, value: unknown): Promise<string> {
  return recordReconstructionClaim({
    productId, subject, predicate, value, epistemicStatus: 'known',
    evidenceRefs: [{ kind: 'signal_event', id: `${productId}_sig` }],
    derivationMethod: 'observed company reality', observedAt: new Date(),
  });
}

async function overSubscribedCompany(prefix: string): Promise<string> {
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)', [`${prefix}_f`, `${prefix}_clerk`, `${prefix}@example.com`]);
  await query('INSERT INTO products (id,name,owner_id) VALUES (?,?,?)', [prefix, `${prefix} Co`, `${prefix}_f`]);
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
    VALUES (?,?,'company_observation_baseline','company_observation_baseline:commitments','low','{}','Two commitments landed in the same week')`, [`${prefix}_sig`, prefix]);
  await query(`INSERT INTO institutional_responsibilities (id,product_id,title,capability,state) VALUES
    (?,?,'Answer customers','support','visible'), (?,?,'Ship the migration','development','visible')`,
  [`${prefix}_a`, prefix, `${prefix}_b`, prefix]);
  await claim(prefix, `product:${prefix}`, 'resource_capacity', { resource: 'engineering_days', amount: 5 });
  await claim(prefix, `responsibility:${prefix}_a`, 'resource_demand', { resource: 'engineering_days', amount: 4 });
  await claim(prefix, `responsibility:${prefix}_b`, 'resource_demand', { resource: 'engineering_days', amount: 4 });
  return prefix;
}

beforeAll(async () => { await runMigrations(); });

describe('scratch', () => {
  it('one judgment, three ticks with new evidence', async () => {
    const p = await overSubscribedCompany('zz_scratch');
    const { judgmentId } = await runInstitutionalJudgmentPass(p);
    await query("UPDATE strategic_decisions_log SET made_at=datetime(made_at,'-60 seconds') WHERE id=?", [judgmentId]);

    // tick 1: new demand evidence, conflict still stands
    await claim(p, `responsibility:${p}_a`, 'resource_demand', { resource: 'engineering_days', amount: 4 });
    console.log('tick1', await runJudgmentObservationPass(p));
    // tick 2: more new evidence, still standing
    await claim(p, `responsibility:${p}_b`, 'resource_demand', { resource: 'engineering_days', amount: 4 });
    console.log('tick2', await runJudgmentObservationPass(p));
    // tick 3: capacity raised -> resolved
    await claim(p, `product:${p}`, 'resource_capacity', { resource: 'engineering_days', amount: 20 });
    console.log('tick3', await runJudgmentObservationPass(p));

    const judgments = await query('SELECT COUNT(*) n FROM strategic_decisions_log WHERE product_id=?', [p]);
    const claims = await query(`SELECT value_json FROM reconstruction_claims WHERE product_id=? AND predicate='later_reality_comparison' ORDER BY created_at,rowid`, [p]);
    console.log('judgments', JSON.stringify(judgments.rows));
    console.log('comparison claims', JSON.stringify(claims.rows));
    const record = await getJudgmentRecord(p);
    console.log('RECORD', JSON.stringify(record));
    expect(true).toBe(true);
  });
});
