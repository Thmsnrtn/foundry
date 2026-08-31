// =============================================================================
// Tests: the moment permission is asked for says WHEN, not just how many.
//
// "I've been watching this and have one check to show for it" reads identically
// whether that check arrived yesterday or eight months ago. No production door
// supplies an expectation window — both founder-facing doors omit `validUntil`
// — so the expiry that would stop a late reading from resolving a stale
// prediction never runs, and one old comparison is a full ticket at the
// boundary where authority is granted.
//
// The answer is a date, not a threshold. Foundry does not decide how old is too
// old; that is the owner's judgement about their own company, and they could
// not make it without being told.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getAssistingCandidates } from '../../src/services/institution/assisting-admission.js';
import { moveResponsibilityTo, recordEvidence, recordSignal } from '../fixtures/responsibility-state.js';

const F = 'wls_founder';
const P = 'wls_product';
const R = 'wls_resp';

beforeAll(async () => { await runMigrations(); });

beforeEach(async () => {
  await query('DELETE FROM responsibility_shadow_comparisons');
  await query('DELETE FROM responsibility_shadow_expectations');
  await query('DELETE FROM responsibility_transitions');
  await query('DELETE FROM reconstruction_claims WHERE product_id=?', [P]);
  await query('DELETE FROM institutional_responsibilities WHERE product_id=?', [P]);
  await query('DELETE FROM signal_events WHERE product_id=?', [P]);
  await query('DELETE FROM products WHERE id=?', [P]);
  await query('DELETE FROM founders WHERE id=?', [F]);
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)', [F, 'wls_clerk', 'wls@test.local']);
  await query("INSERT INTO products (id,name,owner_id,status,scp_status) VALUES (?,'Watched Co',?,'active','active')", [P, F]);
  await query(`INSERT INTO institutional_responsibilities (id,product_id,title,capability,state,disposition)
    VALUES (?,?,'Answer support mail','customer_support','unknown','active')`, [R, P]);
  await moveResponsibilityTo(R, 'understood', { productId: P });
});

/**
 * One expectation and the observation that will answer it, both dated by the
 * test. Expectations are opened while the responsibility is Understood, which
 * is the only state migration 111 admits them in — the same order production
 * uses.
 */
async function watch(observedOn: string): Promise<{ claimId: string; expectationId: string; observationId: string }> {
  const claimId = nanoid();
  await query(
    `INSERT INTO reconstruction_claims
       (id,product_id,subject,predicate,value_json,epistemic_status,confidence,
        evidence_refs_json,derivation_method,observed_at)
     VALUES (?,?,'support','is_answered_within',?,'known',0.9,?,'test fixture',datetime('now'))`,
    [claimId, P, JSON.stringify('1 day'),
      JSON.stringify([{ kind: 'signal_event', id: await recordSignal(P, 'claim basis') }])]);

  const expectationId = nanoid();
  await query(
    `INSERT INTO responsibility_shadow_expectations
       (id,responsibility_id,product_id,expected_event_type,
        expectation_evidence_ref,observation_source_evidence_ref,observation_source_kind)
     VALUES (?,?,?,'support_restored',?,?,'company_observation_baseline')`,
    [expectationId, R, P, `reconstruction_claim:${claimId}`, await recordEvidence(P, 'observation source')]);

  const observationId = await recordSignal(P, 'what happened');
  await query('UPDATE signal_events SET created_at=? WHERE id=?', [observedOn, observationId]);
  return { claimId, expectationId, observationId };
}

/** Climb to Shadowing once, then record what each expectation was answered by. */
async function compareAll(watches: Array<{ expectationId: string; observationId: string }>): Promise<void> {
  await query(`INSERT INTO responsibility_transitions (id,responsibility_id,from_state,to_state,evidence_ref,reason,actor_ref)
    VALUES (?,?,'understood','shadowing',?,'test fixture','test')`,
  [nanoid(), R, await recordEvidence(P, 'reached shadowing')]);
  for (const w of watches) {
    await query(
      `INSERT INTO responsibility_shadow_comparisons (id,expectation_id,product_id,observation_ref,classification)
       VALUES (?,?,?,?,'matched')`,
      [nanoid(), w.expectationId, P, `signal_event:${w.observationId}`]);
  }
}

/** A claim that was current when the expectation opened and has since lapsed.
 *  Migration 111 refuses an expectation built on an already-expired claim, so
 *  this is the only order in which the state can exist — and it is the order
 *  production reaches it in. */
async function lapse(claimId: string): Promise<void> {
  await query("UPDATE reconstruction_claims SET valid_until='2026-02-01 00:00:00' WHERE id=?", [claimId]);
}

async function letter(): Promise<string> {
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never, { id: F, email: 'wls@test.local', preferences: {} } as never);
    c.set('csrfToken' as never, 't' as never);
    await next();
  });
  app.route('/', letterRoutes as unknown as Hono);
  return (await app.request('/letter')).text();
}

describe('when Foundry last actually saw something', () => {
  it('names the date of the single check it is asking on the strength of', async () => {
    await compareAll([await watch('2026-01-14 09:30:00')]);
    const [candidate] = await getAssistingCandidates(P);
    expect(candidate.comparisons).toBe(1);
    expect(candidate.lastWatchedAt).toBe('2026-01-14 09:30:00');
  });

  it('names the newest, not the first', async () => {
    await compareAll([await watch('2026-01-14 09:30:00'), await watch('2026-05-02 11:00:00')]);
    const [candidate] = await getAssistingCandidates(P);
    expect(candidate.comparisons).toBe(2);
    expect(candidate.lastWatchedAt).toBe('2026-05-02 11:00:00');
  });

  it('describes the same set the count describes', async () => {
    // The newer comparison rests on a claim that has expired, so it is not one
    // of the checks Foundry may say it has. A date drawn from a wider set than
    // the count would report watching that the boundary itself refuses.
    const older = await watch('2026-01-14 09:30:00');
    const newer = await watch('2026-05-02 11:00:00');
    await compareAll([older, newer]);
    await lapse(newer.claimId);
    const [candidate] = await getAssistingCandidates(P);
    expect(candidate.comparisons).toBe(1);
    expect(candidate.lastWatchedAt).toBe('2026-01-14 09:30:00');
  });

  it('is never absent from a candidate, because a candidate needs a check', async () => {
    await compareAll([await watch('2026-01-14 09:30:00')]);
    for (const candidate of await getAssistingCandidates(P)) {
      expect(candidate.lastWatchedAt).toBeTruthy();
    }
  });

  it('tells the founder the date at the moment they decide', async () => {
    await compareAll([await watch('2026-01-14 09:30:00')]);
    const page = await letter();
    expect(page).toContain('Things I could start helping with');
    expect(page).toContain('The last thing I actually saw about this arrived 2026-01-14');
  });
});
