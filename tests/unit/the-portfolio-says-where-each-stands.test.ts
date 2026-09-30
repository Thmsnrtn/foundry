process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '8'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { openMandate } from '../../src/services/venture/mandate.js';
import { beginExperimentalAsset, earnAsset, retireExperimentalAsset } from '../../src/services/venture/asset.js';
import { assetStage, stagesOf } from '../../src/services/portfolio/stage.js';

// =============================================================================
// THE PORTFOLIO SAYS WHERE EACH ONE STANDS (Institution V4, 30 September
// 2026; INSTITUTION_MODEL §5.9).
//
// One word per asset — Testing, Proven, Operating, Growing, Harvesting,
// Retired — derived from its columns and never stored. A test is Proven only
// when a real buyer paid. A test that earns its place keeps where it came
// from; a retired one keeps its history and is on the page, folded, with why.
// An invented company is a rehearsal and is on no one's portfolio.
// =============================================================================

const OWNER = 'f_stage';
let app: Hono;
const ids: Record<string, string> = {};

async function aTest(key: string, paid: boolean): Promise<string> {
  await query(`INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
    SELECT ?, id, ?, ?, 'bakers', 'they guess', 'they asked', 'nobody pays', '[]', 'real' FROM venture_mandates WHERE founder_id = ?`,
    [`opp_${key}`, OWNER, `A workbook ${key}`, OWNER]);
  await query(`INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test) VALUES (?,?,?,'will anyone pay',1,'offer one')`,
    [`unk_${key}`, OWNER, `opp_${key}`]);
  await query(`INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode)
    VALUES (?,?,?,?,?,'someone pays','nobody pays',0,'real')`, [`exp_${key}`, OWNER, `opp_${key}`, `unk_${key}`, `sell workbook ${key}`]);
  await query(`UPDATE venture_experiments SET decision='approved', decided_at=datetime('now'), decided_by='owner' WHERE id=?`, [`exp_${key}`]);
  const made = await beginExperimentalAsset({ experimentId: `exp_${key}`, by: 'founder:f_stage' });
  if ('refused' in made) throw new Error(made.refused);
  if (paid) {
    await query(`INSERT INTO experiment_exposures (id, founder_id, experiment_id, provider, exposure_ref, evidence_mode, placed_by)
      VALUES (?,?,?,'stripe',?,'real','test fixture')`, [`x_${key}`, OWNER, `exp_${key}`, `plink_${key}`]);
    await query(`INSERT INTO business_outcome_events (id, founder_id, exposure_id, kind, amount_cents, observed_at, provider, provider_event_ref, evidence_mode)
      VALUES (?,?,?,'payment',900,datetime('now'),'stripe',?,'real')`, [`boe_${key}`, OWNER, `x_${key}`, `pi_${key}`]);
  }
  return made.productId;
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clk_stage', 'owner@example.com', 'Owner']);
  const m = await openMandate({ founderId: OWNER, statement: 'Find a small product', shape: null });
  if ('refused' in m) throw new Error(m.refused);
  ids.testing = await aTest('a', false);
  ids.proven = await aTest('b', true);
  ids.earned = await aTest('c', true);
  ids.retired = await aTest('d', false);
  const earned = await earnAsset({ productId: ids.earned!, by: 'founder:f_stage', because: 'a buyer paid and I want to keep it' });
  expect(earned.earned).toBe(true);
  expect(await retireExperimentalAsset({ productId: ids.retired!, because: 'nobody paid in thirty days' })).toBe(true);
  await query(`INSERT INTO products (id,name,owner_id,status,scp_status,reality,posture) VALUES ('p_harvest','Old Newsletter',?,'active','active','real','harvest')`, [OWNER]);
  await query(`INSERT INTO products (id,name,owner_id,status,scp_status,reality) VALUES ('p_ref','Invented Co',?,'active','active','reference')`, [OWNER]);
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Owner' } as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', letterRoutes);
});

describe('the word', () => {
  it('is derived the same way every time, and Proven needs a real payment', () => {
    const base = { status: 'active', standing: 'earned', posture: 'grow', lifecycle: 'setup', paidCents: 0 };
    expect(assetStage({ ...base, standing: 'experimental' })).toBe('testing');
    expect(assetStage({ ...base, standing: 'experimental', paidCents: 1 })).toBe('proven');
    expect(assetStage(base)).toBe('operating');
    expect(assetStage({ ...base, lifecycle: 'scaling' })).toBe('growing');
    expect(assetStage({ ...base, posture: 'harvest' })).toBe('harvesting');
    expect(assetStage({ ...base, posture: 'retire' })).toBe('retired');
    expect(assetStage({ ...base, status: 'archived', standing: 'experimental', paidCents: 900 })).toBe('retired');
  });
});

describe('every asset', () => {
  it('says where it stands, keeps where it came from, and leaves the invented company out', async () => {
    const at = Object.fromEntries((await stagesOf(OWNER)).map((s) => [s.productId, s]));
    expect(at[ids.testing!]).toMatchObject({ stage: 'testing', group: 'Testing' });
    expect(at[ids.proven!]).toMatchObject({ stage: 'proven', group: 'Testing' });
    expect(at[ids.earned!]).toMatchObject({ stage: 'operating', group: 'Operating', lineage: { experimentId: 'exp_c', test: 'sell workbook c' } });
    expect(at[ids.earned!]!.lineage!.earnedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(at[ids.retired!]).toMatchObject({ stage: 'retired', retiredBecause: 'nobody paid in thirty days' });
    expect(at.p_harvest).toMatchObject({ stage: 'harvesting' });
    expect(at.p_ref).toBeUndefined();
  });

  it('shows the word on each card, the lineage, and the retired ones folded with why', async () => {
    const html = await (await app.request('/foundry/companies')).text();
    expect(html).toMatch(/<span class="status wait">Testing<\/span>/);
    expect(html).toMatch(/<span class="status go">Proven<\/span>/);
    expect(html).toMatch(/<span class="status done">Harvesting<\/span>/);
    expect(html).toContain('From the test “sell workbook c”, given its place on');
    const fold = /<details class="fold" id="retired">[\s\S]*?<\/details>/.exec(html)?.[0] ?? '';
    expect(fold).toContain('nobody paid in thirty days');
    expect(fold).toMatch(/<span class="status back">Retired<\/span>/);
  });
});
