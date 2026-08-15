process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { discoverResponsibilityFromSignal } from '../../src/services/institution/discovery.js';
import { getSevenDayResponsibilitySummary } from '../../src/services/institution/absence-summary.js';
import { proposeResponsibilityCandidate } from '../../src/services/institution/responsibility-candidate.js';

let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id,clerk_user_id,email) VALUES ('owner','clerk_owner','owner@example.com'),('other','clerk_other','other@example.com')", []);
  await query("INSERT INTO products (id,name,owner_id) VALUES ('owned','Owned Co','owner'),('foreign','Foreign Co','other')", []);
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
    VALUES ('sig_owned','owned','stripe','payment_failed','medium','{}','Payment failed'),
           ('sig_foreign','foreign','stripe','payment_failed','medium','{}','Payment failed')`, []);
  await discoverResponsibilityFromSignal('owned', 'sig_owned');
  await discoverResponsibilityFromSignal('foreign', 'sig_foreign');

  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never, { id: c.req.header('x-founder') ?? 'owner' } as never);
    c.set('csrfToken' as never, 'test' as never);
    await next();
  });
  app.route('/', letterRoutes);
});

async function responsibilityId(productId: string): Promise<string> {
  const result = await query('SELECT id FROM institutional_responsibilities WHERE product_id=?', [productId]);
  return String((result.rows[0] as Record<string, unknown>).id);
}

function dispositionRequest(id: string, fields: Record<string, string>, founder = 'owner') {
  return app.request(`/letter/responsibilities/${id}/disposition`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-founder': founder },
    body: new URLSearchParams(fields),
  });
}

describe('authenticated responsibility disposition', () => {
  it('records an evidence-bearing owner judgment and changes the seven-day truth', async () => {
    const id = await responsibilityId('owned');
    const response = await dispositionRequest(id, {
      product_id: 'owned', evidence_ref: 'signal_event:sig_owned',
      disposition: 'deliberately_not_done', reason: 'Customer has already recovered payment',
    });
    expect(response.status).toBe(302);
    const summary = await getSevenDayResponsibilitySummary('owned');
    expect(summary.DELIBERATELY_NOT_DONE.map((item) => item.responsibilityId)).toContain(id);
    const history = await query('SELECT disposition,owner_id,reason FROM responsibility_dispositions WHERE responsibility_id=?', [id]);
    expect(history.rows).toHaveLength(1);
    expect(history.rows[0]).toMatchObject({ disposition: 'deliberately_not_done', owner_id: 'owner' });
  });

  it('refuses forged tenant, actor, evidence, and incomplete judgments without leaking identifiers', async () => {
    const ownedId = await responsibilityId('owned');
    const foreignId = await responsibilityId('foreign');
    const base = { product_id: 'owned', evidence_ref: 'signal_event:sig_owned', disposition: 'active', reason: 'Resume' };
    expect((await dispositionRequest(ownedId, base, 'other')).status).toBe(403);
    expect((await dispositionRequest(foreignId, { ...base, product_id: 'foreign' })).status).toBe(403);
    expect((await dispositionRequest(ownedId, { ...base, evidence_ref: 'signal_event:sig_foreign' })).status).toBe(403);
    expect((await dispositionRequest(ownedId, { ...base, reason: '' })).status).toBe(400);
    expect((await dispositionRequest(ownedId, { ...base, disposition: 'owner_says_so' })).status).toBe(400);
  });

  it('records reopening as a second append-only owner judgment', async () => {
    const id = await responsibilityId('owned');
    const response = await dispositionRequest(id, {
      product_id: 'owned', evidence_ref: 'signal_event:sig_owned', disposition: 'active', reason: 'Failure recurred',
    });
    expect(response.status).toBe(302);
    const history = await query('SELECT disposition FROM responsibility_dispositions WHERE responsibility_id=? ORDER BY created_at,rowid', [id]);
    expect(history.rows.map((row) => row.disposition)).toEqual(['deliberately_not_done', 'active']);
  });
});

describe('authenticated candidate recognition', () => {
  it('derives the owner and product from the session and creates only visible responsibility truth', async () => {
    const candidate = await proposeResponsibilityCandidate({
      productId: 'owned', convergenceKey: 'owner-recognizes-recovery',
      proposedResponsibility: 'Resolve recurring payment failures',
      evidenceRefs: [{ kind: 'signal_event', id: 'sig_owned' }],
      derivationMethod: 'deterministic signal interpretation',
      rationale: 'A payment failure establishes recovery work that may require owner judgment.',
      epistemicStatus: 'known', capabilityDependency: 'billing_recovery', authorityRequired: true,
      observedAt: new Date(),
    });

    const response = await app.request(`/letter/responsibility-candidates/${candidate.id}/promote`, {
      method: 'POST', headers: { 'x-founder': 'owner' },
    });
    expect(response.status).toBe(302);
    const responsibility = await query(`SELECT r.state,r.authority_ref,d.grounding_mechanism,d.actor_ref
      FROM institutional_responsibilities r JOIN responsibility_candidate_decisions d
        ON d.resulting_responsibility_id=r.id WHERE d.candidate_id=?`, [candidate.id]);
    expect(responsibility.rows).toEqual([expect.objectContaining({
      state: 'visible', authority_ref: null,
      grounding_mechanism: 'authenticated_owner', actor_ref: 'founder:owner',
    })]);
  });

  it('uses the same non-enumerating refusal for foreign and nonexistent candidates', async () => {
    const foreign = await proposeResponsibilityCandidate({
      productId: 'foreign', convergenceKey: 'foreign-recovery',
      proposedResponsibility: 'Resolve a foreign payment failure',
      evidenceRefs: [{ kind: 'signal_event', id: 'sig_foreign' }],
      derivationMethod: 'deterministic signal interpretation', rationale: 'Foreign tenant evidence.',
      epistemicStatus: 'known', observedAt: new Date(),
    });
    const foreignResponse = await app.request(`/letter/responsibility-candidates/${foreign.id}/promote`, {
      method: 'POST', headers: { 'x-founder': 'owner' },
    });
    const missingResponse = await app.request('/letter/responsibility-candidates/not-a-candidate/promote', {
      method: 'POST', headers: { 'x-founder': 'owner' },
    });
    expect([foreignResponse.status, await foreignResponse.text()]).toEqual([403, 'Candidate decision refused']);
    expect([missingResponse.status, await missingResponse.text()]).toEqual([403, 'Candidate decision refused']);
    const leaked = await query(`SELECT id FROM institutional_responsibilities WHERE id=?`, [`candidate_${foreign.id}`]);
    expect(leaked.rows).toHaveLength(0);
  });

  it('records owner rejection append-only without creating responsibility truth', async () => {
    const candidate = await proposeResponsibilityCandidate({
      productId: 'owned', convergenceKey: 'owner-rejects-recovery',
      proposedResponsibility: 'Review every recovered payment',
      evidenceRefs: [{ kind: 'signal_event', id: 'sig_owned' }],
      derivationMethod: 'bounded signal interpretation', rationale: 'A possible review obligation.',
      epistemicStatus: 'inferred', confidence: .6, observedAt: new Date(),
    });
    const response = await app.request(`/letter/responsibility-candidates/${candidate.id}/reject`, {
      method: 'POST', headers: { 'x-founder': 'owner' },
    });
    expect(response.status).toBe(302);
    expect((await query('SELECT status FROM responsibility_candidates WHERE id=?', [candidate.id])).rows[0])
      .toMatchObject({ status: 'rejected' });
    expect((await query('SELECT decision,actor_ref FROM responsibility_candidate_decisions WHERE candidate_id=?', [candidate.id])).rows[0])
      .toMatchObject({ decision: 'rejected', actor_ref: 'founder:owner' });
    expect((await query('SELECT COUNT(*) n FROM institutional_responsibilities WHERE id=?', [`candidate_${candidate.id}`])).rows[0])
      .toMatchObject({ n: 0 });
  });
});
