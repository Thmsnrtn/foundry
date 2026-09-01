process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// THE JOURNEY, NOT THE SCREENS.
//
// A world-class product is the transitions, and every one of these was broken
// or missing when the surface shipped:
//
//   · Acting sent him to the OLD APPLICATION mid-journey, because these routes
//     were written when the Letter was the only surface and all ended
//     `redirect('/letter')`.
//   · Nothing told him what had happened. He acted and was left wondering
//     whether anything had, what Foundry was doing now, and when he would hear
//     about it again.
//   · "No" read as final and was not: migration 109 has always turned a
//     `reconsidered` decision back into a pending candidate, and no surface
//     ever offered it.
//   · Asking "what happens if I say yes" about the thing on screen required
//     naming it again.
//
// Recognition, responsibility and authority are three different owner acts. The
// institution's ladder connects them, which is exactly why the interface must
// not: he should always know which one he is doing, and what it does not permit.
// =============================================================================

const OWNER = 'j_owner';
const COMPANY = 'j_company';
let app: Hono;

const get = async (path: string) => {
  const res = await app.request(path, { headers: { cookie: `foundry_product=${COMPANY}` } });
  return { status: res.status, body: await res.text() };
};
const reads = async (path: string) => (await get(path)).body
  .replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<script[\s\S]*?<\/script>/g, ' ')
  .replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const post = async (path: string, fields: Record<string, string> = {}) => {
  const res = await app.request(path, {
    method: 'POST',
    headers: { cookie: `foundry_product=${COMPANY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ return_to: 'foundry', ...fields }),
  });
  return { status: res.status, location: res.headers.get('location') };
};

const candidateId = async () => String(((await query(
  'SELECT id FROM responsibility_candidates WHERE product_id=?', [COMPANY],
)).rows[0] as Record<string, unknown>).id);

beforeEach(async () => {
  await runMigrations();
  for (const t of ['responsibility_candidate_decisions', 'responsibility_candidates',
    'responsibility_transitions', 'institutional_responsibilities', 'reconstruction_claims',
    'signal_events', 'products', 'founders']) {
    await query(`DELETE FROM ${t}`, []).catch(() => { /* table may not exist in older shapes */ });
  }
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_j', 'owner@example.com', 'Thomas Norton']);
  await query(`INSERT INTO products (id,name,owner_id,status,operating_budget_monthly_usd)
    VALUES (?,'Foundry',?,'active',50)`, [COMPANY, OWNER]);
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary,processed)
    VALUES ('j_a',?,'development_verification','development_verified:schema-snapshot-freshness:passed','low',?,?,0)`,
    [COMPANY, JSON.stringify({
      check: 'schema-snapshot-freshness', result: 'passed',
      detail: '695 schema objects', observed_at: '2026-09-01T01:30:32.041Z',
    }), 'schema-snapshot-freshness reported passed']);

  const { proposeResponsibilityCandidate } = await import(
    '../../src/services/institution/responsibility-candidate.js');
  await proposeResponsibilityCandidate({
    productId: COMPANY, convergenceKey: 'self_maintenance:schema-snapshot-freshness',
    proposedResponsibility:
      'regenerate the committed schema snapshot after a migration changes the schema',
    evidenceRefs: [{ kind: 'signal_event', id: 'j_a' }],
    derivationMethod: 'self_maintenance_scope', rationale: 'runs independently',
    epistemicStatus: 'known', capabilityDependency: 'development',
    authorityRequired: true, observedAt: new Date(),
  });

  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never,
      { id: OWNER, email: 'owner@example.com', name: 'Thomas Norton' } as never);
    c.set('csrfToken' as never, 'test' as never);
    await next();
  });
  app.route('/', letterRoutes);
});

describe('recognising something', () => {
  it('returns him to his own surface and says what happened', async () => {
    const acted = await post(`/letter/responsibility-candidates/${await candidateId()}/promote`);
    // Not '/letter'. Acting on the owner surface must not eject him into the
    // old application half way through the journey.
    expect(acted.location).toBe('/foundry?done=recognised');

    const said = await reads('/foundry?done=recognised');
    expect(said).toContain('Noted.');
    expect(said).toContain('I have not been given anything, and I cannot change anything');
  });

  it('does not claim something happened that did not', async () => {
    // The marker only chooses wording; the state behind it is read from the
    // database, so a fabricated one describes nothing.
    const said = await reads('/foundry?done=responsible');
    expect(said).not.toContain('Got it.');
  });
});

describe('declining, and changing his mind', () => {
  it('is honest that it will not be raised again, and offers the way back', async () => {
    const id = await candidateId();
    const declined = await post(`/letter/responsibility-candidates/${id}/reject`);
    expect(declined.location).toBe('/foundry?done=declined');

    const after = await reads('/foundry?done=declined');
    expect(after).toContain('I will not bring that up again');
    expect(after).toContain('ask me what you turned down');
    // And the decision is gone from the page: it is not still pending at him.
    expect(after).not.toContain('Is this worth looking after?');

    const turned = await reads('/foundry?ask=turneddown');
    expect(turned).toContain('You told me not to look after');
    expect(turned).toContain('Look at Keep my internal map accurate again');
  });

  it('puts it back when he asks, because refusal was never permanent', async () => {
    const id = await candidateId();
    await post(`/letter/responsibility-candidates/${id}/reject`);
    const again = await post(`/letter/responsibility-candidates/${id}/reconsider`);
    expect(again.location).toBe('/foundry?done=reopened');

    const status = (await query(
      'SELECT status FROM responsibility_candidates WHERE id=?', [id])).rows[0] as Record<string, unknown>;
    expect(String(status.status)).toBe('pending');
    // And it is back in front of him.
    expect(await reads('/foundry')).toContain('Is this worth looking after?');
  });
});

describe('asking about the thing on screen', () => {
  it('knows what "this" is without being told again', async () => {
    const said = await reads('/foundry?q=' + encodeURIComponent('what does this mean?'));
    expect(said).toContain('Keep my internal map accurate');
  });

  it('answers what happens if he says yes, for the act he is actually being asked', async () => {
    const said = await reads('/foundry?q=' + encodeURIComponent('what happens if I say yes'));
    expect(said).toContain('work out whether I can look after it properly');
    expect(said).toContain('still cannot alter anything');
  });

  it('answers what it could change with the only true answer', async () => {
    const said = await reads('/foundry?q=' + encodeURIComponent('what can you change?'));
    expect(said).toContain('Nothing.');
    expect(said).toContain('this decision does not give me one');
  });

  it('answers whether it can be undone', async () => {
    const said = await reads('/foundry?q=' + encodeURIComponent('can I undo it?'));
    expect(said).toContain('Yes.');
    expect(said).toContain('put it back');
  });
});

describe('the three acts stay three acts', () => {
  it('names recognition as recognition and permits nothing', async () => {
    const said = await reads('/foundry');
    expect(said).toContain('Recognition');
    expect(said).toContain('Is this worth looking after?');
    expect(said).toContain('What I could change Nothing');
  });

  it('names responsibility separately, and says what it would ask for next', async () => {
    const id = await candidateId();
    const { promoteResponsibilityCandidate } = await import(
      '../../src/services/institution/responsibility-candidate.js');
    const rid = await promoteResponsibilityCandidate({
      productId: COMPANY, candidateId: id, mechanism: 'authenticated_owner', ownerId: OWNER });
    const { describeOwnSelfMaintenance } = await import(
      '../../src/services/foundry/self-observation.js');
    await describeOwnSelfMaintenance({ productId: COMPANY });
    const { earnResponsibilityUnderstanding } = await import(
      '../../src/services/institution/responsibility-understanding.js');
    await earnResponsibilityUnderstanding(COMPANY, rid);

    const said = await reads('/foundry');
    expect(said).toContain('Responsibility');
    expect(said).toContain('Can I take responsibility for this?');
    expect(said).toContain('Yes — take responsibility');
    expect(said).toContain('Permission to do the work, for seven days');
    // The authority it would ask for is named, and not taken here.
    expect(said).toContain('this permits no changes');
  });
});
