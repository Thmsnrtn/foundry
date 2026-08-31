process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  deferFounderEvidenceRequest, recordFounderEvidenceAnswer,
  selectFounderEvidenceQuestion,
} from '../../src/services/institution/founder-evidence.js';

// =============================================================================
// SKIPPING A QUESTION IS NOT ANSWERING IT, AND IT IS NOT WITHDRAWING FOREVER.
//
// Foundry asks one question at a time and offers "Skip this". Skipping is
// deliberate and the courtesy behind it is right: silence is never read as a
// negative answer, and Foundry does not ask again.
//
// But "does not ask again" had become "can never be told". The answer route
// resolves the request with `status='open'`, so a deferred request was refused
// with a 403, and nothing on any surface listed what had been set aside. The
// founder had no way to find the question and no route that would take the
// answer.
//
// The consequence is not cosmetic. A required understanding fact that stays
// unknown keeps its responsibility from being understood, which keeps it off
// Shadowing, which keeps it off Assisting. One hurried click in the letter
// silently foreclosed a responsibility for good, and Foundry never mentioned
// it again — by design.
//
// So: still not asked, still retrievable, still answerable.
// =============================================================================

const P = 'sa_product';
const OWNER = 'sa_owner';
const RESP = 'sa_resp';

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES (?,'sa_c','o@example.com')`, [OWNER]);
  await query(`INSERT INTO products (id,name,owner_id) VALUES (?,'Fold Street Dance',?)`, [P, OWNER]);
  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
     VALUES ('sa_sig',?,'repository','development_need_observed','low','{}','seed')`, [P]);
  await query(
    `INSERT INTO institutional_responsibilities (id,product_id,title,capability,state,discovery_evidence_ref)
     VALUES (?,?,'Every timetabled class has a teacher','operations','visible','signal_event:sa_sig')`,
    [RESP, P]);
});

describe('a question the founder set aside', () => {
  it('is not asked again, is still listed, and still takes an answer', async () => {
    const asked = await selectFounderEvidenceQuestion(P);
    expect(asked).not.toBeNull();
    const requestId = asked!.requestId;
    const predicate = asked!.fact;

    expect(await deferFounderEvidenceRequest(requestId, OWNER)).toBe(true);

    // Foundry does not nag: the same fact is not put back in front of them.
    const next = await selectFounderEvidenceQuestion(P);
    expect(next?.fact).not.toBe(predicate);

    // But the founder can find it.
    const { getSetAsideQuestions } = await import(
      '../../src/services/institution/founder-evidence.js');
    const setAside = await getSetAsideQuestions(P);
    expect(setAside.map((q) => q.requestId)).toContain(requestId);
    expect(setAside[0].question.length).toBeGreaterThan(0);

    // And answering it works. It was refused with a 403 before.
    const recorded = await recordFounderEvidenceAnswer({
      requestId, founderId: OWNER,
      statement: 'So no class is ever left without a teacher on the day.',
    });
    expect(recorded).not.toBeNull();

    // Answered is answered: it leaves the set-aside list.
    expect((await getSetAsideQuestions(P)).map((q) => q.requestId)).not.toContain(requestId);
  });

  // WHAT WIDENING THE GUARD DID NOT WIDEN. Migration 169 changed one clause of
  // `founder_assertion_guard` from status='open' to status IN ('open',
  // 'deferred'). Everything else it was built to refuse it must still refuse,
  // or this is a hole rather than a door.
  it('still refuses an answer to a question nobody asked', async () => {
    await expect(query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('sa_never',?,'founder_assertion','founder_stated:purpose','low',?,'x')`,
      [P, JSON.stringify({
        request_id: 'no-such-request', predicate: 'purpose',
        statement: 'anything', founder_id: OWNER,
      })])).rejects.toThrow(/founder_assertion:request_invalid/);
  });

  it('still refuses an answer replayed after the question was answered', async () => {
    const asked = await selectFounderEvidenceQuestion(P);
    expect(asked).not.toBeNull();
    await recordFounderEvidenceAnswer({
      requestId: asked!.requestId, founderId: OWNER,
      statement: 'Because a class without a teacher is a refund.',
    });
    // The same answer, again, directly at the boundary.
    await expect(query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('sa_replay',?,'founder_assertion',?,'low',?,'x')`,
      [P, `founder_stated:${asked!.fact}`, JSON.stringify({
        request_id: asked!.requestId, predicate: asked!.fact,
        statement: 'Because a class without a teacher is a refund.', founder_id: OWNER,
      })])).rejects.toThrow(/founder_assertion:request_invalid/);
  });

  it('still refuses an answer that carries authority with it', async () => {
    const asked = await selectFounderEvidenceQuestion(P);
    expect(asked).not.toBeNull();
    await deferFounderEvidenceRequest(asked!.requestId, OWNER);
    await expect(query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('sa_smuggle',?,'founder_assertion',?,'low',?,'x')`,
      [P, `founder_stated:${asked!.fact}`, JSON.stringify({
        request_id: asked!.requestId, predicate: asked!.fact, statement: 'and go ahead',
        founder_id: OWNER, to_mode: 'act',
      })])).rejects.toThrow(/founder_assertion:authority_smuggled/);
  });

  it('belongs to the founder who set it aside and nobody else', async () => {
    const { getSetAsideQuestions } = await import(
      '../../src/services/institution/founder-evidence.js');
    const asked = await selectFounderEvidenceQuestion(P);
    expect(asked).not.toBeNull();
    await deferFounderEvidenceRequest(asked!.requestId, OWNER);

    // A stranger cannot answer it, and the refusal does not say whether it
    // exists.
    expect(await recordFounderEvidenceAnswer({
      requestId: asked!.requestId, founderId: 'somebody-else', statement: 'x',
    })).toBeNull();
    expect((await getSetAsideQuestions(P)).map((q) => q.requestId))
      .toContain(asked!.requestId);
  });
});

// A list nobody renders is not retrievable. This goes through the page and the
// route the founder actually posts to.
describe('the letter', () => {
  let app: Hono;

  beforeAll(async () => {
    const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
    app = new Hono();
    app.use('*', async (c, next) => {
      c.set('founder' as never, { id: OWNER, email: 'o@example.com', preferences: {} } as never);
      c.set('csrfToken' as never, 't' as never);
      await next();
    });
    app.route('/', letterRoutes);
  });

  it('shows a set-aside question and takes the answer through its own form', async () => {
    const asked = await selectFounderEvidenceQuestion(P);
    expect(asked).not.toBeNull();
    await deferFounderEvidenceRequest(asked!.requestId, OWNER);

    const before = await (await app.request('/letter')).text();
    expect(before).toContain('Set aside');
    expect(before).toContain(`/letter/evidence/${asked!.requestId}/answer`);
    // It says it will not ask again, because it will not.
    expect(before).toContain('I have not asked again');

    const posted = await app.request(`/letter/evidence/${asked!.requestId}/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ statement: 'So a class is never left uncovered.' }).toString(),
    });
    expect(posted.status).toBe(302);

    const after = await (await app.request('/letter')).text();
    expect(after).not.toContain(`/letter/evidence/${asked!.requestId}/answer`);
  });

  it('says nothing at all when nothing was set aside', async () => {
    // Answered through the real path - the resolution guard refuses a status
    // change with no evidence behind it, and it is right to.
    const { getSetAsideQuestions } = await import(
      '../../src/services/institution/founder-evidence.js');
    for (const q of await getSetAsideQuestions(P, 50)) {
      await recordFounderEvidenceAnswer({
        requestId: q.requestId, founderId: OWNER,
        statement: 'Answered so nothing is left set aside.',
        ...(q.answerShape === 'resource_amount' ? { resource: 'days of my time', amount: 2 } : {}),
      });
    }
    expect(await getSetAsideQuestions(P, 50)).toEqual([]);
    expect(await (await app.request('/letter')).text()).not.toContain('Set aside');
  });
});
