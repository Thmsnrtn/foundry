process.env.TURSO_DATABASE_URL = 'file::memory:';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  deferFounderEvidenceRequest, recordFounderEvidenceAnswer, selectFounderEvidenceQuestion,
} from '../../src/services/institution/founder-evidence.js';
import {
  earnResponsibilityUnderstanding, projectResponsibilityUnderstanding,
} from '../../src/services/institution/responsibility-understanding.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';
import { enterResponsibilityAssisting } from '../../src/services/institution/responsibility-assisting.js';
import { reportedObligation } from '../fixtures/responsibility-state.js';

// =============================================================================
// The production evidence bridge.
//
// Foundry could recognise a responsibility from real company evidence and then
// go no further: understanding one requires facts no connected system observes.
// Owner decision — ask the authenticated founder, one contextual question at a
// time, only for a fact the institution actually requires.
//
// The vertical below runs through the real production path. Nothing seeds a
// reconstruction claim for the responsibility being understood; every fact
// arrives as a founder answer, and Understood is earned or refused by the
// existing projection.
// =============================================================================

const OWNER = 'fe_owner';
const OTHER = 'fe_other';

async function countOf(sql: string, args: unknown[] = []): Promise<number> {
  return Number(((await query(sql, args)).rows[0] as Record<string, unknown>).n);
}

/** prefix → the report that created that company's responsibility, for the one
 *  test that has to cite the discovery evidence by id. */
const reportSignals = new Map<string, string>();

/** A company whose only institutional state came from the company saying what
 *  it owes — the one intake production has. This used to emit a `support`-shaped
 *  SaaS signal and hand it to discovery, which nothing in production does, so
 *  every founder-elicitation behaviour below was exercised against a
 *  responsibility the running system could not have produced. */
async function companyFromReport(prefix: string, owner = OWNER): Promise<string> {
  await query('INSERT INTO products (id,name,owner_id) VALUES (?,?,?)', [prefix, `${prefix} Co`, owner]);
  const reported = await reportedObligation(prefix, owner,
    { kind: 'customer_commitment', what: 'Reply to the people who waited three days last week' });
  reportSignals.set(prefix, reported.signalId);
  return reported.responsibilityId;
}

/** Answer whatever Foundry currently asks, once. Returns the fact it asked
 * about, or null when it had nothing worth asking. */
async function answerNextQuestion(productId: string, statement: string): Promise<string | null> {
  const question = await selectFounderEvidenceQuestion(productId);
  if (!question) return null;
  const recorded = await recordFounderEvidenceAnswer({
    requestId: question.requestId, founderId: OWNER, statement,
  });
  expect(recorded).not.toBeNull();
  return question.fact;
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES
    (?,'fe_clerk','owner@example.com'),(?,'fe_other_clerk','other@example.com')`, [OWNER, OTHER]);
});

describe('progressive founder evidence elicitation', () => {
  it('carries a real company from an observed signal to Understood through founder answers alone', async () => {
    const product = 'fe_vertical';
    const responsibilityId = await companyFromReport(product);

    // Foundry asks about a fact the institution requires and it genuinely
    // cannot observe — and it names the responsibility it is asking about, in
    // the company's own words. This used to expect 'Restore support response
    // capacity', a title the institution wrote for a SaaS event type nothing
    // emits; the question a founder actually sees now quotes them back.
    const first = await selectFounderEvidenceQuestion(product);
    expect(first).toMatchObject({
      responsibilityId,
      responsibilityTitle: 'Reply to the people who waited three days last week',
    });
    const required = (await projectResponsibilityUnderstanding(product, responsibilityId)).requiredFacts;
    expect(required).toContain(first!.fact);

    // Nothing has been established yet, so Understood is refused.
    await expect(earnResponsibilityUnderstanding(product, responsibilityId)).rejects.toThrow(/insufficient/);

    // Answer everything it asks, one question at a time, until it stops asking.
    const asked: string[] = [];
    for (let i = 0; i < 20; i++) {
      const fact = await answerNextQuestion(product, `What the founder actually said about ${i}`);
      if (fact === null) break;
      asked.push(fact);
    }
    expect(asked.sort()).toEqual([...required].sort());

    // Every answer became canonical evidence with real provenance, and every
    // claim points at the founder's own words rather than at a derivation.
    const claims = (await query(
      `SELECT predicate,derivation_method,evidence_refs_json FROM reconstruction_claims
        WHERE product_id=? AND subject=?`, [product, `responsibility:${responsibilityId}`])).rows;
    expect(claims.length).toBe(required.length);
    for (const row of claims as unknown as Array<Record<string, unknown>>) {
      expect(String(row.derivation_method)).toBe('authenticated founder assertion');
      const refs = JSON.parse(String(row.evidence_refs_json)) as Array<{ kind: string; id: string }>;
      expect(refs).toHaveLength(1);
      expect(refs[0].kind).toBe('signal_event');
      expect(await countOf(
        "SELECT COUNT(*) n FROM signal_events WHERE id=? AND product_id=? AND source='founder_assertion'",
        [refs[0].id, product])).toBe(1);
    }

    // Only now is Understood earnable — and it is earned by the existing
    // projection, not written by the elicitation path.
    const understanding = await projectResponsibilityUnderstanding(product, responsibilityId);
    expect(understanding.missingCriticalFacts).toEqual([]);
    expect(understanding.unresolvedFacts).toEqual([]);
    expect(await earnResponsibilityUnderstanding(product, responsibilityId))
      .toMatchObject({ state: 'understood', authorityRef: null });

    // And with nothing left to ask, Foundry stops asking.
    expect(await selectFounderEvidenceQuestion(product)).toBeNull();
  });

  it('understanding a responsibility still does not let Foundry act on it', async () => {
    // The whole point of the constitutional separation: the founder told
    // Foundry how the company works, and Foundry still cannot do anything.
    const product = 'fe_vertical';
    const responsibilityId = String(((await query(
      'SELECT id FROM institutional_responsibilities WHERE product_id=?', [product])).rows[0] as Record<string, unknown>).id);
    expect(await countOf('SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=?', [product])).toBe(0);
    expect(await countOf('SELECT COUNT(*) n FROM action_executions WHERE product_id=?', [product])).toBe(0);
    await expect(enterResponsibilityAssisting({
      productId: product, responsibilityId,
      shadowComparisonId: 'invented', authorityConsentId: 'invented',
    })).rejects.toThrow();
  });

  it('asks one question at a time and does not ask it again on every refresh', async () => {
    const product = 'fe_stable';
    await companyFromReport(product);
    const a = await selectFounderEvidenceQuestion(product);
    const b = await selectFounderEvidenceQuestion(product);
    const c = await selectFounderEvidenceQuestion(product);
    expect(a!.requestId).toBe(b!.requestId);
    expect(b!.requestId).toBe(c!.requestId);
    expect(await countOf('SELECT COUNT(*) n FROM founder_evidence_requests WHERE product_id=?', [product])).toBe(1);
  });

  it('asks about the responsibility closest to being understood first', async () => {
    const product = 'fe_priority';
    const near = await companyFromReport(product);
    // A second obligation the same company reports, needing more facts.
    const far = (await reportedObligation(product, OWNER,
      { kind: 'revenue_collection', what: 'Collect the payment a card declined' })).responsibilityId;

    // The support responsibility needs six facts; billing recovery needs nine.
    // Ground five of the support facts through the ordinary founder path so it
    // sits one answer away from Understood.
    for (let i = 0; i < 5; i++) await answerNextQuestion(product, `answer ${i}`);
    const next = await selectFounderEvidenceQuestion(product);
    expect(next!.responsibilityId).toBe(near);
    expect(next!.responsibilityId).not.toBe(far);
  });

  it('treats a skipped question as unknown, not as an answer, and does not nag', async () => {
    const product = 'fe_deferred';
    const responsibilityId = await companyFromReport(product);
    const question = (await selectFounderEvidenceQuestion(product))!;

    expect(await deferFounderEvidenceRequest(question.requestId, OWNER)).toBe(true);

    // Silence produced no evidence of any kind.
    expect(await countOf(
      "SELECT COUNT(*) n FROM signal_events WHERE product_id=? AND source='founder_assertion'", [product])).toBe(0);
    expect(await countOf('SELECT COUNT(*) n FROM reconstruction_claims WHERE product_id=? AND predicate=?',
      [product, question.fact])).toBe(0);

    // The fact stays missing, so Understood stays out of reach.
    expect((await projectResponsibilityUnderstanding(product, responsibilityId)).missingCriticalFacts)
      .toContain(question.fact);
    await expect(earnResponsibilityUnderstanding(product, responsibilityId)).rejects.toThrow(/insufficient/);

    // And Foundry moves on rather than asking the same thing again.
    const next = await selectFounderEvidenceQuestion(product);
    expect(next!.fact).not.toBe(question.fact);

    // A deferred question is closed to answers; the database, not the caller,
    // is what refuses.
    await expect(query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('fe_late',?,'founder_assertion','founder_stated:purpose','low',?,'Late answer')`,
      [product, JSON.stringify({
        request_id: question.requestId, predicate: question.fact,
        statement: 'Actually here is the answer', founder_id: OWNER,
      })])).rejects.toThrow(/request_invalid/);
  });

  it('refuses a replayed answer', async () => {
    const product = 'fe_replay';
    await companyFromReport(product);
    const question = (await selectFounderEvidenceQuestion(product))!;
    expect(await recordFounderEvidenceAnswer({
      requestId: question.requestId, founderId: OWNER, statement: 'First answer',
    })).not.toBeNull();

    // The same submission arriving twice changes nothing and creates no second
    // claim — answered is terminal.
    expect(await recordFounderEvidenceAnswer({
      requestId: question.requestId, founderId: OWNER, statement: 'First answer',
    })).toBeNull();
    expect(await countOf('SELECT COUNT(*) n FROM reconstruction_claims WHERE product_id=? AND predicate=?',
      [product, question.fact])).toBe(1);
    await expect(query(
      "UPDATE founder_evidence_requests SET status='open',answer_signal_id=NULL WHERE id=?", [question.requestId]))
      .rejects.toThrow(/already_resolved/);
  });

  it('preserves a conflict when later independent evidence disagrees', async () => {
    const product = 'fe_conflict';
    const responsibilityId = await companyFromReport(product);
    for (let i = 0; i < 10; i++) if (await answerNextQuestion(product, `founder view ${i}`) === null) break;
    expect(await earnResponsibilityUnderstanding(product, responsibilityId))
      .toMatchObject({ state: 'understood' });

    // An integration later observes something that disagrees with what the
    // founder said. Neither side is overwritten: the conflict is recorded as a
    // conflict, citing both sources.
    await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
      VALUES ('fe_conflict_obs',?,'company_observation_baseline','company_observation_baseline:support_queue','low','{}','Queue is handled by an outsourcer')`, [product]);
    const founderClaim = (await query(
      `SELECT id FROM reconstruction_claims WHERE product_id=? AND subject=? AND predicate='dependencies'`,
      [product, `responsibility:${responsibilityId}`])).rows[0] as Record<string, unknown>;
    await recordReconstructionClaim({
      productId: product, subject: `responsibility:${responsibilityId}`, predicate: 'dependencies',
      value: { statement: 'Two sources disagree about what this depends on' }, epistemicStatus: 'conflicting',
      evidenceRefs: [
        { kind: 'signal_event', id: 'fe_conflict_obs' },
        { kind: 'signal_event', id: reportSignals.get(product)! },
      ],
      derivationMethod: 'independent observation disagrees with founder assertion', observedAt: new Date(),
    });

    // The founder's original claim still exists — history is not rewritten.
    expect(await countOf('SELECT COUNT(*) n FROM reconstruction_claims WHERE id=?', [String(founderClaim.id)])).toBe(1);

    // And the conflict is material: the responsibility is no longer safely
    // understood, and Foundry does not resolve it by asking a third time.
    const understanding = await projectResponsibilityUnderstanding(product, responsibilityId);
    expect(understanding.unresolvedFacts).toContain('dependencies');
    const next = await selectFounderEvidenceQuestion(product);
    expect(next === null || next.fact !== 'dependencies').toBe(true);
  });

  it('lets the founder change their own view without erasing what they said before', async () => {
    const product = 'fe_revised';
    const responsibilityId = await companyFromReport(product);
    const question = (await selectFounderEvidenceQuestion(product))!;
    await recordFounderEvidenceAnswer({ requestId: question.requestId, founderId: OWNER, statement: 'First view' });

    // A revision is a new observation of company reality, not an edit.
    await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
      VALUES ('fe_revised_later',?,'founder','founder_revised','low','{}','The founder revised their view')`, [product]);
    await recordReconstructionClaim({
      productId: product, subject: `responsibility:${responsibilityId}`, predicate: question.fact,
      value: { statement: 'Second view' }, epistemicStatus: 'known',
      evidenceRefs: [{ kind: 'signal_event', id: 'fe_revised_later' }],
      derivationMethod: 'authenticated founder revision', observedAt: new Date(),
    });

    const claims = (await query(
      'SELECT value_json FROM reconstruction_claims WHERE product_id=? AND subject=? AND predicate=? ORDER BY created_at,rowid',
      [product, `responsibility:${responsibilityId}`, question.fact])).rows as unknown as Array<Record<string, unknown>>;
    expect(claims.map((r) => JSON.parse(String(r.value_json)).statement)).toEqual(['First view', 'Second view']);

    // The projection keeps the whole history, oldest first, and reads the
    // latest as current — so a revision supersedes without erasing.
    const understanding = await projectResponsibilityUnderstanding(product, responsibilityId);
    const history = understanding.facts.filter((f) => f.predicate === question.fact);
    expect(history.map((f) => (f.value as { statement: string }).statement))
      .toEqual(['First view', 'Second view']);
    expect(understanding.missingCriticalFacts).not.toContain(question.fact);
  });

  it('lets an answer go stale rather than staying true forever', async () => {
    const product = 'fe_stale';
    const responsibilityId = await companyFromReport(product);
    for (let i = 0; i < 10; i++) if (await answerNextQuestion(product, `founder view ${i}`) === null) break;

    // Read a year later: an expiring claim is no longer current, and the
    // responsibility is no longer understood on the strength of it.
    await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
      VALUES ('fe_stale_later',?,'founder','founder_stated_temporary','low','{}','True only for this quarter')`, [product]);
    await recordReconstructionClaim({
      productId: product, subject: `responsibility:${responsibilityId}`, predicate: 'risks',
      value: { statement: 'Seasonal risk, only while the promotion runs' }, epistemicStatus: 'known',
      evidenceRefs: [{ kind: 'signal_event', id: 'fe_stale_later' }],
      derivationMethod: 'authenticated founder assertion', observedAt: new Date('2026-01-01'),
      validUntil: new Date('2026-02-01'),
    });
    const later = new Date('2026-06-01');
    expect((await projectResponsibilityUnderstanding(product, responsibilityId, later)).unresolvedFacts)
      .toContain('risks');
    await expect(earnResponsibilityUnderstanding(product, responsibilityId, later)).rejects.toThrow(/insufficient/);
  });

  describe('authentication and tenancy', () => {
    it('refuses a forged founder, a foreign tenant, and a question that was never asked', async () => {
      const mine = 'fe_mine';
      await companyFromReport(mine);
      const theirs = 'fe_theirs';
      await companyFromReport(theirs, OTHER);
      const mineQuestion = (await selectFounderEvidenceQuestion(mine))!;
      const theirsQuestion = (await selectFounderEvidenceQuestion(theirs))!;

      // Another founder cannot answer this company's question.
      expect(await recordFounderEvidenceAnswer({
        requestId: mineQuestion.requestId, founderId: OTHER, statement: 'Not yours to answer',
      })).toBeNull();
      // Nor can this founder answer theirs.
      expect(await recordFounderEvidenceAnswer({
        requestId: theirsQuestion.requestId, founderId: OWNER, statement: 'Not mine to answer',
      })).toBeNull();
      // Nor can either defer the other's.
      expect(await deferFounderEvidenceRequest(theirsQuestion.requestId, OWNER)).toBe(false);
      // A question that does not exist behaves exactly like one belonging to
      // someone else — the refusal does not enumerate.
      expect(await recordFounderEvidenceAnswer({
        requestId: 'feq_does_not_exist', founderId: OWNER, statement: 'Hello',
      })).toBeNull();

      expect(await countOf(
        "SELECT COUNT(*) n FROM signal_events WHERE source='founder_assertion' AND product_id IN (?,?)",
        [mine, theirs])).toBe(0);
    });

    it('refuses a founder identity the database cannot verify', async () => {
      const product = 'fe_forged';
      await companyFromReport(product);
      const question = (await selectFounderEvidenceQuestion(product))!;
      await expect(query(
        `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
         VALUES ('fe_forged_sig',?,'founder_assertion','founder_stated:purpose','low',?,'Forged')`,
        [product, JSON.stringify({
          request_id: question.requestId, predicate: question.fact,
          statement: 'I am the owner', founder_id: OTHER,
        })])).rejects.toThrow(/founder_invalid/);
    });

    it('refuses a question about another tenant\'s responsibility', async () => {
      const foreign = String(((await query(
        "SELECT id FROM institutional_responsibilities WHERE product_id='fe_theirs'", [])).rows[0] as Record<string, unknown>).id);
      await expect(query(
        'INSERT INTO founder_evidence_requests (id,product_id,responsibility_id,predicate) VALUES (?,?,?,?)',
        ['feq_cross', 'fe_mine', foreign, 'purpose'])).rejects.toThrow(/responsibility_invalid/);
    });

    it('refuses a question about a fact the institution never requires', async () => {
      const responsibility = String(((await query(
        "SELECT id FROM institutional_responsibilities WHERE product_id='fe_mine'", [])).rows[0] as Record<string, unknown>).id);
      await expect(query(
        'INSERT INTO founder_evidence_requests (id,product_id,responsibility_id,predicate) VALUES (?,?,?,?)',
        ['feq_curious', 'fe_mine', responsibility, 'annual_revenue'])).rejects.toThrow(/predicate_invalid/);
    });
  });

  it('refuses an answer that tries to carry authority with it', async () => {
    // The shape of the attempt is the problem. A smuggled consent that is
    // silently dropped is a silently granted one waiting to happen, so the
    // database refuses the whole assertion rather than storing part of it.
    const product = 'fe_smuggle';
    await companyFromReport(product);
    const question = (await selectFounderEvidenceQuestion(product))!;
    const base = {
      request_id: question.requestId, predicate: question.fact,
      statement: 'And you may act on this', founder_id: OWNER,
    };
    for (const smuggled of [
      { consent: true }, { consent_id: 'c1' }, { capability: 'customer_support' },
      { authority: 'granted' }, { scope: 'everything' }, { to_mode: 'act' },
      { expires_at: '2030-01-01' }, { grant: 'yes' }, { state: 'operating' },
    ]) {
      await expect(query(
        `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
         VALUES (?,?,'founder_assertion','founder_stated:purpose','low',?,'Smuggled')`,
        [`fe_smuggle_${Object.keys(smuggled)[0]}`, product, JSON.stringify({ ...base, ...smuggled })],
      )).rejects.toThrow(/authority_smuggled/);
    }
    expect(await countOf('SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=?', [product])).toBe(0);
  });

  it('keeps the askable vocabulary and the institutional requirements from drifting apart', () => {
    // Migration 125 restates the understanding facts in SQL so the database can
    // refuse a question the institution never asked for. Two copies of one list
    // is a defect waiting to happen unless something compares them.
    const migration = readFileSync(
      resolve(process.cwd(), 'src/db/migrations/125_founder_evidence_requests.sql'), 'utf8');
    const inSql = [...migration.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    const understanding = readFileSync(
      resolve(process.cwd(), 'src/services/institution/responsibility-understanding.ts'), 'utf8');
    const declared = understanding
      .slice(understanding.indexOf('const UNDERSTANDING_FACTS='), understanding.indexOf('] as const'));
    const inTs = [...declared.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(inTs.length).toBeGreaterThan(10);
    for (const fact of inTs) expect(inSql, `${fact} is required by the institution but unaskable`).toContain(fact);
  });
});
