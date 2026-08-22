process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';
import { createDeterministicCapacityJudgment } from '../../src/services/institution/institutional-judgment.js';
import { evaluateInstitutionalJudgment } from '../../src/services/institution/institutional-judgment-evaluation.js';
import {
  getJudgmentRecord, getMaterialJudgments, recordJudgmentDisposition,
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

describe('the owner is shown what the judgment was computed from', () => {
  it('gives them the numbers, the cost of each side, and whether Foundry can order them', async () => {
    // The owner was asked "which way do you want to go?" while `constraints_json`,
    // `consequences_json` and `expected_economic_effect_json` were written on
    // every judgment and read by nothing. So the section withheld how much
    // resource there is, how much is wanted, what each side loses, and whether
    // Foundry could rank them at all — which is most of what the decision is.
    const [judgment] = await getMaterialJudgments('jd_product');

    // The actual scarcity, from the canonical capacity and demand claims.
    expect(judgment.limit).toMatchObject({ resource: 'work_block', available: 2, requested: 3 });

    // What each side loses, by TITLE. An id on screen is ontology leaking into
    // the founder's language, and a consequence attached to nothing is worse
    // than no consequence.
    expect(judgment.consequences).toContainEqual({
      title: 'Urgent support obligation', consequence: 'customer commitment at risk',
    });
    expect(JSON.stringify(judgment.consequences)).not.toContain('jd_support');

    // AND WHETHER FOUNDRY CAN ORDER THEM ON MONEY, reported as itself. The
    // fixture records no economic claim, so the honest answer is that it
    // cannot — which is the single thing an owner most wants and the worst
    // possible place to imply a confidence.
    expect(judgment.economicOrdering).toBe('unknown');
  });

  it('puts all of it on the page, in the founder\'s words', async () => {
    const page = await (await app.request('/letter', { headers: { 'x-founder': 'jd_owner' } })).text();
    expect(page, 'the scarcity itself must be shown').toContain('You have 2 work blocks; these need 3');
    expect(page).toContain('customer commitment at risk');
    expect(page, 'not knowing the money must be said, not omitted')
      .toContain('I cannot tell you which costs more');

    // The consequence is attached to a NAME. Asserted on the sentence rather
    // than by banning the id from the whole page: an id inside a form action is
    // a correct identifier, and a blanket ban would have made this test about
    // URL shapes instead of about founder language.
    expect(page).toContain('If Urgent support obligation gives way: customer commitment at risk');
    expect(page).not.toContain('If jd_support gives way');
    expect(page).not.toContain('expected_economic_effect');
  });
});

describe('Foundry reads back how its own judgment has held up', () => {
  it('counts what later reality did to the judgments it made, from the claim nothing read', async () => {
    // WHAT THIS CLOSES. `evaluateInstitutionalJudgment` wrote every later-reality
    // comparison twice: to `institutional_judgment_evaluations.state`, and as a
    // `later_reality_comparison` claim carrying the observations it rested on.
    // The column is read — it decides what still needs the owner. The claim was
    // read by nothing, and neither was the `learned_claim_id` pointing at it.
    // Foundry was recording whether it had been right about this company and
    // never once looking.
    //
    // The founder is the person that record is for: how much weight to give the
    // next judgment is decided on it.
    const record = await getJudgmentRecord('jd_product');
    expect(record).not.toBeNull();
    // ONE JUDGMENT COUNTS ONCE. This used to compare the total against the
    // number of CLAIMS, which is the defect written down as an assertion: the
    // observation pass writes a new claim on every tick that sees new evidence
    // about the same judgment, so the count grew with the observing rather than
    // with the judging.
    const judgments = await query(
      `SELECT DISTINCT subject FROM reconstruction_claims
        WHERE product_id='jd_product' AND predicate='later_reality_comparison'`, []);
    expect(judgments.rows.length).toBeGreaterThan(0);
    expect(record!.borneOut + record!.contradicted + record!.unresolved)
      .toBe(judgments.rows.length);
    // The earlier tests drove this judgment to contradicted, so at least one is.
    expect(record!.contradicted).toBeGreaterThan(0);

    // A company Foundry has never been observed on is told nothing, rather than
    // shown a vacuous perfect record.
    expect(await getJudgmentRecord('jd_foreign')).toBeNull();
  });

  it('lets a supported judgment go stale but never un-contradicts itself by waiting', async () => {
    // Read-time expiry exists so an old positive claim does not silently remain
    // current. Being WRONG is a thing that happened, and letting time turn it
    // into "nobody knows" would let Foundry improve its record by waiting.
    await query(
      `UPDATE reconstruction_claims SET value_json = ?, valid_until = datetime('now','-1 day')
        WHERE product_id='jd_product' AND predicate='later_reality_comparison'`,
      [JSON.stringify('supported')]);
    const stale = await getJudgmentRecord('jd_product');
    expect(stale!.borneOut, 'an expired success is not current evidence').toBe(0);

    await query(
      `UPDATE reconstruction_claims SET value_json = ?
        WHERE product_id='jd_product' AND predicate='later_reality_comparison'`,
      [JSON.stringify('contradicted')]);
    const wrong = await getJudgmentRecord('jd_product');
    expect(wrong!.contradicted, 'a contradiction does not expire in Foundry\'s favour')
      .toBeGreaterThan(0);
  });

  it('puts the record on the page, in the founder\'s language and never as a rate', async () => {
    // PRODUCTION REACHABLE IS NOT HUMAN REACHABLE. A record Foundry computes
    // and never shows is the same to a founder as one it does not compute.
    await query(
      `UPDATE reconstruction_claims SET value_json = ?, valid_until = NULL
        WHERE product_id='jd_product' AND predicate='later_reality_comparison'`,
      [JSON.stringify('contradicted')]);
    const page = await (await app.request('/letter', { headers: { 'x-founder': 'jd_owner' } })).text();
    expect(page, 'the record must reach the page').toContain('judgment');
    expect(page).toContain('I have made about your company');
    expect(page).toContain('that it contradicted');
    // Counts, never a rate: a percentage invites a confidence the evidence
    // cannot carry.
    expect(page).not.toMatch(/\d+% (accurate|correct|right)/);
  });

  it('calls conflicting evidence unresolved rather than picking a side', async () => {
    await query(
      `UPDATE reconstruction_claims SET value_json = ?, valid_until = NULL
        WHERE product_id='jd_product' AND predicate='later_reality_comparison'`,
      [JSON.stringify('conflicting')]);
    const record = await getJudgmentRecord('jd_product');
    expect(record).toMatchObject({ borneOut: 0, contradicted: 0 });
    expect(record!.unresolved).toBeGreaterThan(0);
  });
});

describe('one judgment, observed many times', () => {
  // `evaluateInstitutionalJudgment` writes a NEW later_reality_comparison claim
  // — fresh id, no upsert, and `reconstruction_claims` has no unique key on
  // (subject, predicate) — on every six-hourly tick that sees new evidence about
  // the same judgment. The record tallied one entry per CLAIM, so the letter's
  // "Of the N judgments I have made about your company and since checked"
  // counted observations, not judgments. And because a judgment's state
  // legitimately moves, the earlier claims stayed behind and the SAME judgment
  // was added to `unresolved` and to an outcome column at once.

  it('does not count the same judgment again each time it is observed', async () => {
    const before = await getJudgmentRecord('jd_product');
    const total = (r: { borneOut: number; contradicted: number; unresolved: number } | null): number =>
      r === null ? 0 : r.borneOut + r.contradicted + r.unresolved;

    // The same judgment, observed twice more, moving as evidence arrives.
    // The evidence refs are copied from the claim already on this subject: a
    // trigger requires every claim to rest on something, which is exactly the
    // rule that makes this record worth reading.
    const seed = (await query(
      `SELECT subject, evidence_refs_json FROM reconstruction_claims
        WHERE product_id='jd_product' AND predicate='later_reality_comparison' LIMIT 1`, []))
      .rows[0] as unknown as { subject: string; evidence_refs_json: string };
    const subject = seed.subject;
    for (const [i, state] of [['a', 'partially_observed'], ['b', 'supported']] as const) {
      await query(
        `INSERT INTO reconstruction_claims
           (id,product_id,subject,predicate,value_json,epistemic_status,confidence,
            evidence_refs_json,derivation_method,observed_at)
         VALUES (?, 'jd_product', ?, 'later_reality_comparison', ?, 'known', NULL,
                 ?, 'bounded later-reality comparison', ?)`,
        [`jr_${i}`, subject, JSON.stringify(state), seed.evidence_refs_json,
         new Date(Date.now() + (state === 'supported' ? 2 : 1) * 60000).toISOString()]);
    }

    const after = await getJudgmentRecord('jd_product');
    expect(total(after)).toBe(total(before));
  });

  it('reads the judgment\'s CURRENT state, not every state it has been in', async () => {
    const subject = String((await query(
      `SELECT subject FROM reconstruction_claims
        WHERE product_id='jd_product' AND predicate='later_reality_comparison' LIMIT 1`, []))
      .rows[0]!.subject);
    const record = await getJudgmentRecord('jd_product');

    // The newest claim for that subject is 'supported', written above.
    const newest = await query(
      `SELECT value_json FROM reconstruction_claims
        WHERE product_id='jd_product' AND subject=? AND predicate='later_reality_comparison'
        ORDER BY observed_at DESC LIMIT 1`, [subject]);
    expect(JSON.parse(String(newest.rows[0]!.value_json))).toBe('supported');
    // So this judgment is borne out, and is NOT also sitting in unresolved.
    expect(record!.borneOut).toBeGreaterThan(0);
  });
});
