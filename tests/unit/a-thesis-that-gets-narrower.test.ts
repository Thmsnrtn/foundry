process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  formClaim, observe, raiseUnknown, reviseClaim, settleClaim, standingOf, whatItBecame,
} from '../../src/services/venture/market-evidence.js';
import { whereToLookNext } from '../../src/services/venture/validation.js';
import { openMandate, candidatesFor } from '../../src/services/venture/mandate.js';

// =============================================================================
// A THESIS THAT SURVIVES CONTRADICTION BY GETTING NARROWER.
//
// Two real sources disagree and the institution refuses to average them. That
// refusal was right and it left the thesis stuck. The move a real founder makes
// is neither averaging nor abandoning — it is believing something smaller that
// both pieces of evidence fit, which is usually a different and better
// business.
//
// AND KNOWING WHEN READING STOPS HELPING. Whether somebody will pay, switch,
// click or come back is answered by behaviour and by nothing else. When every
// question in the way is one of those, another pile of evidence is worth less
// than a five-dollar experiment.
// =============================================================================

const OWNER = 'rev_owner';
let opportunityId = '';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_rev', 'owner@example.com', 'Owner']);
  const opened = await openMandate({ founderId: OWNER, statement: 'find one',
    shape: null, evidenceMode: 'reference' });
  if ('refused' in opened) throw new Error(opened.refused);
  const found = (await candidatesFor(opened.id)).find((c) => c.headline.includes('dataset'));
  opportunityId = found?.id ?? '';
});

async function contested(claim: string): Promise<string> {
  const claimId = await formClaim({ founderId: OWNER, claim, evidenceMode: 'real' });
  await observe({ founderId: OWNER, claimId, sourceType: 'directory',
    source: 'https://registry.example/a', saw: 'fourteen maintained packages',
    bearing: 'supports', directness: 'direct', observedAt: new Date(),
    evidenceMode: 'real' });
  await observe({ founderId: OWNER, claimId, sourceType: 'community',
    source: 'https://forum.example/1',
    saw: 'the timezones and daylight saving are what actually break',
    bearing: 'contradicts', directness: 'direct', observedAt: new Date(),
    evidenceMode: 'real' });
  return claimId;
}

describe('narrowing, not averaging', () => {
  it('refuses to narrow a claim nothing has argued with', async () => {
    const uncontested = await formClaim({ founderId: OWNER, evidenceMode: 'real',
      claim: 'Something nobody has disagreed with' });
    const tried = await reviseClaim({ founderId: OWNER, claimId: uncontested,
      into: 'Something narrower', because: 'I felt like it' });
    expect('refused' in tried).toBe(true);
    if ('refused' in tried) expect(tried.refused).toContain('changing the subject');
  });

  it('narrows a contested thesis and keeps the one it outgrew', async () => {
    const broad = await contested('Cron scheduling is a solved problem');
    const before = await standingOf(broad);
    expect(before?.howItStands).toContain('the question is open');

    const revised = await reviseClaim({
      founderId: OWNER, claimId: broad,
      into: 'Cron scheduling is solved except across daylight saving boundaries',
      because: 'people are still describing where it breaks, and it is always the '
        + 'same place',
      opportunityId });
    expect('narrowerClaimId' in revised).toBe(true);

    // THE OLD CLAIM STAYS, AND IS NOT MARKED FAILED. It was not wrong, it was
    // too broad — and the record of having believed it is how the institution
    // learns what it tends to overreach about.
    const old = (await query(
      'SELECT settled_as, revised_into, revised_because FROM market_claims WHERE id = ?',
      [broad])).rows[0] as Record<string, unknown>;
    expect(old.settled_as).toBeNull();
    expect(old.revised_into).not.toBeNull();

    const became = await whatItBecame(broad);
    expect(became?.claim).toContain('except across daylight saving');
    expect(became?.because).toContain('still describing where it breaks');
  });

  it('will not revise the same claim twice', async () => {
    const broad = (await query(
      `SELECT id FROM market_claims WHERE revised_into IS NOT NULL LIMIT 1`, []))
      .rows[0] as Record<string, unknown>;
    const again = await reviseClaim({ founderId: OWNER, claimId: String(broad.id),
      into: 'Something else again', because: 'changed my mind' });
    expect('refused' in again).toBe(true);
    if ('refused' in again) expect(again.refused).toContain('already_revised');
  });

  it('will not revise a claim reality has already settled', async () => {
    const settled = await contested('Something reality answered');
    await settleClaim({ claimId: settled, as: 'failed', by: `founder:${OWNER}` });
    const tried = await reviseClaim({ founderId: OWNER, claimId: settled,
      into: 'A narrower version', because: 'it still might work' });
    expect('refused' in tried).toBe(true);
    if ('refused' in tried) expect(tried.refused).toContain('settled_claims_are_not_revised');
  });
});

describe('knowing when reading stops helping', () => {
  it('keeps reading while a source could still answer something', async () => {
    await raiseUnknown({ founderId: OWNER, opportunityId, blocking: true,
      question: 'whether the registers permit redistribution',
      cheapestTest: 'read their terms' });
    const next = await whereToLookNext(opportunityId);
    expect(next.keepLooking).toBe(true);
    expect(next.stillWorthReading.join(' ')).toContain('redistribution');
  });

  it('stops when everything in the way is about what people will do', async () => {
    // Answer the readable one; leave only behaviour questions.
    await query(
      `UPDATE market_unknowns SET answered_at = datetime('now'), answer = 'they permit it'
        WHERE opportunity_id = ? AND question LIKE '%redistribution%'`, [opportunityId]);
    await query(
      `UPDATE market_unknowns SET answered_at = datetime('now'), answer = 'settled'
        WHERE opportunity_id = ? AND answered_at IS NULL AND blocking = 0`, [opportunityId]);
    await raiseUnknown({ founderId: OWNER, opportunityId, blocking: true,
      question: 'whether anyone would pay for a maintained deadline dataset',
      cheapestTest: 'list one small dataset and see' });

    const next = await whereToLookNext(opportunityId);
    expect(next.keepLooking).toBe(false);
    expect(next.because).toContain('what people will actually do');
    expect(next.because).toContain('would not change the next decision');
    expect(next.onlyRealityCanSettle[0]?.onlySettledBy)
      .toContain('showing a price to somebody who has the problem');
  });

  it('says so plainly when nothing is open at all', async () => {
    await query(
      `UPDATE market_unknowns SET answered_at = datetime('now'), answer = 'done'
        WHERE opportunity_id = ? AND answered_at IS NULL`, [opportunityId]);
    const next = await whereToLookNext(opportunityId);
    expect(next.keepLooking).toBe(false);
    expect(next.because).toContain('no question left for reading to answer');
  });
});
