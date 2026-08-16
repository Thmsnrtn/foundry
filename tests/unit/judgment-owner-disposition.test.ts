process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';
import { createDeterministicCapacityJudgment } from '../../src/services/institution/institutional-judgment.js';
import { evaluateInstitutionalJudgment } from '../../src/services/institution/institutional-judgment-evaluation.js';
import {
  getMaterialJudgments, recordJudgmentDisposition,
} from '../../src/services/institution/institutional-judgment-disposition.js';

let app: Hono;
let judgmentId: string;
let foreignJudgmentId: string;

/** Seeds a real capacity conflict from canonical ledgers, not a hand-written judgment row. */
async function seedJudgment(productId: string, prefix: string): Promise<string> {
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
    VALUES (?,?,'operations','capacity_observed','medium','{}','Two available work blocks')`, [`${prefix}_sig`, productId]);
  await query(`INSERT INTO institutional_responsibilities (id,product_id,title,capability,state) VALUES
    (?,?,'Urgent support obligation','customer_support','understood'),
    (?,?,'Planned development','development','understood')`,
  [`${prefix}_support`, productId, `${prefix}_dev`, productId]);
  for (const [subject, predicate, value] of [
    [`product:${productId}`, 'resource_capacity', { resource: 'work_block', amount: 2 }],
    [`responsibility:${prefix}_support`, 'resource_demand', { resource: 'work_block', amount: 2, deadline: 'today', consequence: 'customer commitment at risk' }],
    [`responsibility:${prefix}_dev`, 'resource_demand', { resource: 'work_block', amount: 1, consequence: 'planned investment delayed' }],
  ] as const) {
    await recordReconstructionClaim({
      productId, subject, predicate, value, epistemicStatus: 'known',
      evidenceRefs: [{ kind: 'signal_event', id: `${prefix}_sig` }],
      derivationMethod: 'canonical fixture evidence', observedAt: new Date(),
    });
  }
  const id = await createDeterministicCapacityJudgment(productId, [`${prefix}_support`, `${prefix}_dev`]);
  if (!id) throw new Error('fixture did not produce a judgment');
  return id;
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES
    ('jd_owner','jd_clerk','jd@example.com'),('jd_other','jd_other_clerk','other@example.com')`, []);
  await query(`INSERT INTO products (id,name,owner_id) VALUES
    ('jd_product','Owned Co','jd_owner'),('jd_foreign','Foreign Co','jd_other')`, []);
  judgmentId = await seedJudgment('jd_product', 'jd');
  foreignJudgmentId = await seedJudgment('jd_foreign', 'jdf');

  // A plain strategic decision that is not an institutional judgment.
  await query(`INSERT INTO strategic_decisions_log
    (id,product_id,decision_title,decision_description,decision_category,made_by,status,agent_context_json)
    VALUES ('jd_plain','jd_product','Plain decision','Not an institutional judgment','operations','founder','active','{}')`, []);

  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never, { id: c.req.header('x-founder') ?? 'jd_owner' } as never);
    c.set('csrfToken' as never, 'test' as never);
    await next();
  });
  app.route('/', letterRoutes);
});

function directionRequest(id: string, fields: Record<string, string>, founder = 'jd_owner') {
  return app.request(`/letter/judgments/${id}/disposition`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-founder': founder },
    body: new URLSearchParams(fields),
  });
}

const authorityCounts = async (productId: string) => ({
  consents: (await query('SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=?', [productId])).rows[0],
  actions: (await query('SELECT COUNT(*) n FROM outbound_actions WHERE product_id=?', [productId])).rows[0],
  executions: (await query('SELECT COUNT(*) n FROM action_executions', [])).rows[0],
  states: (await query('SELECT id,state,authority_ref FROM institutional_responsibilities WHERE product_id=? ORDER BY id', [productId])).rows,
});

describe('authenticated owner disposition on institutional judgments', () => {
  it('surfaces an undirected judgment and records direction without granting authority', async () => {
    const before = await authorityCounts('jd_product');
    const judgmentBefore = (await query('SELECT * FROM strategic_decisions_log WHERE id=?', [judgmentId])).rows[0];

    const pending = await getMaterialJudgments('jd_product');
    expect(pending.map((j) => j.id)).toEqual([judgmentId]);
    expect(pending[0]).toMatchObject({ disposition: null, authorityStillRequired: true });
    expect(pending[0].uncertainties).toContain('deadline unknown for jd_dev');

    const response = await directionRequest(judgmentId, {
      direction: 'accepted', reason: 'Support commitment outranks the planned work this week',
    });
    expect(response.status).toBe(302);

    const history = await query(
      'SELECT disposition,owner_id,selected_alternative,reason FROM institutional_judgment_dispositions WHERE judgment_id=?',
      [judgmentId],
    );
    expect(history.rows).toHaveLength(1);
    expect(history.rows[0]).toMatchObject({ disposition: 'accepted', owner_id: 'jd_owner', selected_alternative: null });

    // Agreement is direction, never permission: nothing executable changed.
    expect(await authorityCounts('jd_product')).toEqual(before);
    // And the judgment Foundry made is preserved exactly as it was made.
    expect((await query('SELECT * FROM strategic_decisions_log WHERE id=?', [judgmentId])).rows[0]).toEqual(judgmentBefore);
  });

  it('cannot satisfy responsibility-bound authority for the responsibilities it directs', async () => {
    // Migration 112 authority is an exact autonomy_consents grant. A direction
    // writes to a different ledger entirely, so the lookup finds nothing.
    const grants = await query(
      `SELECT COUNT(*) n FROM autonomy_consents WHERE product_id='jd_product' AND responsibility_id IN ('jd_support','jd_dev')`, [],
    );
    expect(grants.rows[0]).toMatchObject({ n: 0 });
    const assisting = await query(
      "SELECT COUNT(*) n FROM institutional_responsibilities WHERE product_id='jd_product' AND state IN ('assisting','operating','mature','exception_owned')", [],
    );
    expect(assisting.rows[0]).toMatchObject({ n: 0 });
  });

  it('accepts a represented alternative located by position and refuses an unrepresented one', async () => {
    const alternatives = JSON.parse(String(((await query(
      'SELECT alternatives_considered_json FROM strategic_decisions_log WHERE id=?', [judgmentId],
    )).rows[0] as Record<string, unknown>).alternatives_considered_json)) as string[];

    expect((await directionRequest(judgmentId, {
      direction: 'alternative:1', reason: 'Reallocating is cheaper than deferring',
    })).status).toBe(302);
    const latest = await query(
      'SELECT disposition,selected_alternative FROM institutional_judgment_dispositions WHERE judgment_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1',
      [judgmentId],
    );
    expect(latest.rows[0]).toMatchObject({ disposition: 'alternative_selected', selected_alternative: alternatives[1] });

    expect((await directionRequest(judgmentId, { direction: 'alternative:99', reason: 'Invented option' })).status).toBe(403);
    await expect(recordJudgmentDisposition({
      productId: 'jd_product', judgmentId, ownerId: 'jd_owner',
      disposition: 'alternative_selected', selectedAlternative: 'hire a whole new team', reason: 'Unrepresented',
    })).rejects.toThrow(/alternative_invalid/);
  });

  it('refuses forged actors, foreign tenants, non-judgments, and reasonless directions without leaking', async () => {
    const foreign = await directionRequest(foreignJudgmentId, { direction: 'accepted', reason: 'Not mine' });
    const missing = await directionRequest('not-a-judgment', { direction: 'accepted', reason: 'Nothing here' });
    expect([foreign.status, await foreign.text()]).toEqual([403, 'Direction refused']);
    expect([missing.status, await missing.text()]).toEqual([403, 'Direction refused']);
    expect((await directionRequest(judgmentId, { direction: 'accepted', reason: 'Wrong founder' }, 'jd_other')).status).toBe(403);
    expect((await directionRequest('jd_plain', { direction: 'accepted', reason: 'Not institutional' })).status).toBe(403);
    expect((await directionRequest(judgmentId, { direction: 'accepted', reason: '   ' })).status).toBe(400);
    expect((await directionRequest(judgmentId, { direction: 'owner_says_so', reason: 'Invented direction' })).status).toBe(400);

    // A forged owner cannot self-authorize even below the route.
    await expect(recordJudgmentDisposition({
      productId: 'jd_product', judgmentId, ownerId: 'jd_other', disposition: 'accepted', reason: 'Forged',
    })).rejects.toThrow(/owner_invalid/);
    await expect(recordJudgmentDisposition({
      productId: 'jd_product', judgmentId: foreignJudgmentId, ownerId: 'jd_owner', disposition: 'accepted', reason: 'Cross-tenant',
    })).rejects.toThrow(/judgment_invalid/);
    expect((await query('SELECT COUNT(*) n FROM institutional_judgment_dispositions WHERE product_id=?', ['jd_foreign'])).rows[0])
      .toMatchObject({ n: 0 });
  });

  it('keeps direction history append-only across a change of mind', async () => {
    expect((await directionRequest(judgmentId, {
      direction: 'deferred', reason: 'Waiting on the customer to confirm the deadline',
    })).status).toBe(302);

    const history = await query(
      'SELECT disposition FROM institutional_judgment_dispositions WHERE judgment_id=? ORDER BY created_at,rowid', [judgmentId],
    );
    expect(history.rows.map((r) => r.disposition)).toEqual(['accepted', 'alternative_selected', 'deferred']);

    await expect(query("UPDATE institutional_judgment_dispositions SET reason='rewritten' WHERE judgment_id=?", [judgmentId]))
      .rejects.toThrow(/append_only/);
    await expect(query('DELETE FROM institutional_judgment_dispositions WHERE judgment_id=?', [judgmentId]))
      .rejects.toThrow(/append_only/);
  });

  it('goes quiet once directed, and speaks again only when later reality disagrees', async () => {
    expect(await getMaterialJudgments('jd_product')).toEqual([]);

    await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
      VALUES ('jd_contra','jd_product','independent','judgment_expected_contradicted','high',?,'Later reality')`,
    [JSON.stringify({ judgment_id: judgmentId })]);
    expect(await evaluateInstitutionalJudgment('jd_product', judgmentId)).toBe('contradicted');

    const material = await getMaterialJudgments('jd_product');
    expect(material.map((j) => [j.id, j.disposition, j.evaluationState]))
      .toEqual([[judgmentId, 'deferred', 'contradicted']]);
  });

  it('never surfaces another tenant judgment through the owner projection', async () => {
    expect((await getMaterialJudgments('jd_product')).map((j) => j.id)).not.toContain(foreignJudgmentId);
    expect((await getMaterialJudgments('jd_foreign')).map((j) => j.id)).toEqual([foreignJudgmentId]);
  });
});
