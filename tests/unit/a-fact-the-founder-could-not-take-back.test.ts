process.env.TURSO_DATABASE_URL = 'file::memory:';

import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  getFounderUnderstandingView, reviseFounderFact, submitFounderFact,
} from '../../src/services/institution/founder-evidence.js';
import { projectResponsibilityUnderstanding } from '../../src/services/institution/responsibility-understanding.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';

// =============================================================================
// A FACT THE FOUNDER COULD NOT TAKE BACK.
//
// `submitFounderFact` says it on its face: a founder "cannot restate one that
// is already grounded". That is the right guard for the path it protects — it
// is what stops a replayed submission volunteering into a predicate nothing
// consumes — and its effect was that a company fact was write-once. Nothing
// showed the founder what Foundry believed, and nothing let them change it,
// while Foundry went on to ask for authority on the strength of those facts.
//
// No claim in this system is ever given a `valid_until`, so an understanding
// does not age out either: what was said once is current forever.
//
// The institution had already answered this one function away. Deferring a
// question used to be final, and the fix was not to re-ask — "Not asking again
// is preserved... The founder reaches it by choosing to."
// =============================================================================

const F = 'ftb_founder';
const OTHER = 'ftb_other';
const P = 'ftb_product';
const OTHER_P = 'ftb_other_product';
const R = 'ftb_resp';

beforeAll(async () => { await runMigrations(); });

beforeEach(async () => {
  await query('DELETE FROM reconstruction_claims WHERE product_id IN (?,?)', [P, OTHER_P]);
  await query('DELETE FROM founder_evidence_requests WHERE product_id IN (?,?)', [P, OTHER_P]);
  await query('DELETE FROM signal_events WHERE product_id IN (?,?)', [P, OTHER_P]);
  await query('DELETE FROM institutional_responsibilities WHERE product_id IN (?,?)', [P, OTHER_P]);
  await query('DELETE FROM products WHERE id IN (?,?)', [P, OTHER_P]);
  await query('DELETE FROM founders WHERE id IN (?,?)', [F, OTHER]);
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?),(?,?,?)',
    [F, 'ftb_c', 'f@test.local', OTHER, 'ftb_o', 'o@test.local']);
  await query('INSERT INTO products (id,name,owner_id) VALUES (?,?,?),(?,?,?)',
    [P, 'Owned Co', F, OTHER_P, 'Someone Else Co', OTHER]);
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
    VALUES ('ftb_sig',?,'repository','development_need_observed','low','{}','seed')`, [P]);
  await query(`INSERT INTO institutional_responsibilities
      (id,product_id,title,capability,state,discovery_evidence_ref)
    VALUES (?,?,'Answer support mail','customer_support','visible','signal_event:ftb_sig')`, [R, P]);
});

const view = () => getFounderUnderstandingView({ productId: P, responsibilityId: R, founderId: F });

const believed = async (fact: string): Promise<string | null> => {
  const v = await view();
  return v?.facts.find((f) => f.fact === fact)?.statement ?? null;
};

describe('what Foundry believes, shown to the person who told it', () => {
  it('lists every fact the capability requires, said or not', async () => {
    const v = await view();
    expect(v).toBeTruthy();
    expect(v!.title).toBe('Answer support mail');
    // customer_support adds none of its own, so these are the six base facts.
    expect(v!.facts.map((f) => f.fact)).toEqual([
      'purpose', 'desired_outcome', 'success_conditions',
      'operating_constraints', 'dependencies', 'risks']);
    // Nothing is guessed for a fact nobody has stated.
    expect(v!.facts.every((f) => f.statement === null && f.observedAt === null)).toBe(true);
  });

  it('shows what was said and when, once something has been', async () => {
    await submitFounderFact({
      productId: P, founderId: F, fact: 'purpose', scope: 'responsibility',
      responsibilityId: R, statement: 'Customers waiting on us is the thing that loses them',
    });
    const held = (await view())!.facts.find((f) => f.fact === 'purpose')!;
    expect(held.statement).toBe('Customers waiting on us is the thing that loses them');
    expect(held.observedAt).toBeTruthy();
    expect(held.epistemicStatus).toBe('known');
  });

  it('shows another company nothing, whether or not it exists', async () => {
    expect(await getFounderUnderstandingView({
      productId: P, responsibilityId: R, founderId: OTHER })).toBeNull();
    expect(await getFounderUnderstandingView({
      productId: P, responsibilityId: 'no_such_responsibility', founderId: F })).toBeNull();
  });
});

describe('correcting a fact that is already grounded', () => {
  beforeEach(async () => {
    await submitFounderFact({
      productId: P, founderId: F, fact: 'purpose', scope: 'responsibility',
      responsibilityId: R, statement: 'The first thing I said',
    });
  });

  it('is exactly what the old path refuses, which is why this one exists', async () => {
    expect(await submitFounderFact({
      productId: P, founderId: F, fact: 'purpose', scope: 'responsibility',
      responsibilityId: R, statement: 'A correction the answer path will not take',
    })).toBeNull();
    expect(await believed('purpose')).toBe('The first thing I said');
  });

  it('replaces what Foundry believes, and can be done more than once', async () => {
    expect(await reviseFounderFact({
      productId: P, founderId: F, responsibilityId: R,
      fact: 'purpose', statement: 'What I actually meant',
    })).toBeTruthy();
    expect(await believed('purpose')).toBe('What I actually meant');

    // The request id per predicate is deterministic, which is why a correction
    // cannot be routed through the answered-question row a second time.
    expect(await reviseFounderFact({
      productId: P, founderId: F, responsibilityId: R,
      fact: 'purpose', statement: 'And again, a year later',
    })).toBeTruthy();
    expect(await believed('purpose')).toBe('And again, a year later');
  });

  it('records a claim in the shape an answer has, so nothing downstream needs a second way to know a fact', async () => {
    // Two writers of one claim shape is a defect unless something compares them.
    const shape = `SELECT subject,predicate,epistemic_status,derivation_method FROM reconstruction_claims
        WHERE product_id=? AND predicate='purpose'`;
    const answered = (await query(`${shape} ORDER BY created_at,rowid LIMIT 1`, [P])).rows[0];
    await reviseFounderFact({
      productId: P, founderId: F, responsibilityId: R, fact: 'purpose', statement: 'Corrected' });
    const corrected = (await query(`${shape} ORDER BY created_at DESC,rowid DESC LIMIT 1`, [P])).rows[0];
    expect(corrected).toEqual(answered);
  });

  it('but the provenance says which, because Foundry did not ask for this one', async () => {
    await reviseFounderFact({
      productId: P, founderId: F, responsibilityId: R, fact: 'purpose', statement: 'Corrected' });
    const sources = (await query(
      `SELECT source FROM signal_events WHERE product_id=?
        AND source IN ('founder_assertion','founder_correction') ORDER BY created_at,rowid`, [P]))
      .rows.map((r) => String((r as Record<string, unknown>).source));
    // A rota system noticing something is not the founder saying so, and the
    // record says which. The same applies to being asked and coming back.
    expect(sources).toEqual(['founder_assertion', 'founder_correction']);
  });

  it('refuses to correct a fact nobody ever stated', async () => {
    // Stating a fact for the first time is answering a question, and goes the
    // other way. Migration 220 refuses it here rather than trusting the caller.
    expect(await reviseFounderFact({
      productId: P, founderId: F, responsibilityId: R, fact: 'risks', statement: 'never stated' })).toBeNull();
  });

  it('leaves the record of what Foundry ASKED alone', async () => {
    const before = (await query(
      'SELECT COUNT(*) n FROM founder_evidence_requests WHERE product_id=?', [P])).rows[0];
    await reviseFounderFact({
      productId: P, founderId: F, responsibilityId: R, fact: 'purpose', statement: 'Corrected' });
    // A correction is not an answer to a question Foundry asked. Recording one
    // here would make that table describe questions it never put.
    expect((await query(
      'SELECT COUNT(*) n FROM founder_evidence_requests WHERE product_id=?', [P])).rows[0]).toEqual(before);
  });

  it('is the belief the institution itself acts on, not a second copy of it', async () => {
    await reviseFounderFact({
      productId: P, founderId: F, responsibilityId: R, fact: 'purpose', statement: 'What the institution should use' });
    const understanding = await projectResponsibilityUnderstanding(P, R);
    const current = [...understanding.facts].reverse().find((f) => f.predicate === 'purpose');
    expect((current!.value as { statement: string }).statement).toBe('What the institution should use');
  });

  it('refuses a predicate this capability does not require', async () => {
    // `systems` is required for operations and development, not for support.
    // A caller cannot volunteer into a fact nothing here consumes.
    expect(await reviseFounderFact({
      productId: P, founderId: F, responsibilityId: R, fact: 'systems', statement: 'anything' })).toBeNull();
    expect(await reviseFounderFact({
      productId: P, founderId: F, responsibilityId: R, fact: 'not_a_fact', statement: 'anything' })).toBeNull();
  });

  it('refuses a claim about this responsibility that is not an understanding fact at all', async () => {
    // THE CASE THE OTHER TEST DOES NOT REACH, and the reason the capability
    // check is load-bearing rather than belt-and-braces. Migration 220 refuses
    // a correction to a predicate nothing has stated — so a predicate that HAS
    // a claim gets past it. Responsibilities carry claims that are not
    // understanding facts, and the grounding claim under a shadow expectation
    // is one: without the capability check, this door would let the founder
    // rewrite the evidence an expectation rests on.
    await recordReconstructionClaim({
      productId: P, subject: `responsibility:${R}`, predicate: 'development_expectation',
      value: { check: 'a-check', expected: 'passed' }, epistemicStatus: 'inferred', confidence: 0.8,
      evidenceRefs: [{ kind: 'signal_event', id: 'ftb_sig' }],
      derivationMethod: 'bounded expectation', observedAt: new Date(),
    });

    expect(await reviseFounderFact({
      productId: P, founderId: F, responsibilityId: R,
      fact: 'development_expectation', statement: 'rewritten' })).toBeNull();

    const claims = await query(
      `SELECT value_json FROM reconstruction_claims
        WHERE product_id=? AND predicate='development_expectation'`, [P]);
    expect(claims.rows).toHaveLength(1);
    expect(String((claims.rows[0] as Record<string, unknown>).value_json)).not.toContain('rewritten');
  });

  it('refuses somebody else, and refuses an empty statement', async () => {
    expect(await reviseFounderFact({
      productId: P, founderId: OTHER, responsibilityId: R, fact: 'purpose', statement: 'not theirs' })).toBeNull();
    expect(await reviseFounderFact({
      productId: P, founderId: F, responsibilityId: R, fact: 'purpose', statement: '   ' })).toBeNull();
    expect(await believed('purpose')).toBe('The first thing I said');
  });
});

describe('the founder can reach it', () => {
  async function page(path: string): Promise<{ status: number; body: string }> {
    const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('founder' as never, { id: F, email: 'f@test.local', preferences: {} } as never);
      c.set('csrfToken' as never, 't' as never);
      await next();
    });
    app.route('/', letterRoutes as unknown as Hono);
    const res = await app.request(path);
    return { status: res.status, body: await res.text() };
  }

  it('says what it believes, when it was told, and offers the correction', async () => {
    await submitFounderFact({
      productId: P, founderId: F, fact: 'purpose', scope: 'responsibility',
      responsibilityId: R, statement: 'Customers waiting is what loses them',
    });
    const { status, body } = await page(`/letter/responsibilities/${R}/understanding`);
    expect(status).toBe(200);
    expect(body).toContain('Customers waiting is what loses them');
    expect(body).toContain('You told me this');
    expect(body).toContain('Correct it');
    // It does not decide that anything has gone stale.
    expect(body).toContain('I do not decide when any of them stops being true');
  });

  it('says it does not know, rather than guessing, for a fact nobody stated', async () => {
    const { body } = await page(`/letter/responsibilities/${R}/understanding`);
    expect(body).toContain('You have not told me this yet, so I do not know it');
    // And offers no way to state it here: telling Foundry a fact for the first
    // time is answering a question, and that path already asks one at a time in
    // the order that unblocks the most. A form the correction guard refuses
    // would be an affordance that never works.
    expect(body).not.toContain('Remember that');
  });

  it('answers a responsibility that is not this company\'s the same as one that does not exist', async () => {
    expect((await page('/letter/responsibilities/no_such_thing/understanding')).status).toBe(404);
  });
});
