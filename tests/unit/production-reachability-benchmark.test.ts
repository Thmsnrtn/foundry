process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { discoverResponsibilityFromSignal } from '../../src/services/institution/discovery.js';
import {
  deferFounderEvidenceRequest, recordFounderEvidenceAnswer, selectFounderEvidenceQuestion,
} from '../../src/services/institution/founder-evidence.js';
import {
  earnResponsibilityUnderstanding, requiredUnderstandingFacts,
} from '../../src/services/institution/responsibility-understanding.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';
import {
  evaluateProductionReachabilityGate, scoreProductionReachability,
  type ReachabilityObservation, type ReachabilityTruth,
} from '../../src/services/institution/production-reachability-benchmark.js';

// =============================================================================
// Executable production-reachability corpus.
//
// The question: can a normal new company actually enter the institutional
// ladder? Four companies, none of them software, each driven through the real
// production services — signal ingestion, discovery, founder elicitation, the
// understanding projection — with nothing seeded past the first observation.
//
// Fixtures are authored from the same "unfamiliar company" principle used for
// the recognition corpus, and again by the author of the code, which is stated
// rather than glossed: this proves the path is reachable and that its refusals
// hold. It is not production proof.
// =============================================================================

const OWNER = 'pr_owner';

interface Fixture {
  productId: string; name: string; signalSource: string; eventType: string; summary: string;
  /** How the founder behaves: answers everything, or skips the first question. */
  behaviour: 'answers' | 'skips_first';
  /** Whether a later independent observation disagrees with an answer. */
  conflictAfterwards?: boolean;
}

const FIXTURES: Fixture[] = [
  { productId: 'pr_marina', name: 'Kestrel Point Marina', signalSource: 'card_terminal',
    eventType: 'payment_failed', summary: 'A berth-holder card payment was declined',
    behaviour: 'answers' },
  { productId: 'pr_dance', name: 'Larkhill Dance School', signalSource: 'front_desk',
    eventType: 'support_spike', summary: 'Parents waited days for a reply about term dates',
    behaviour: 'skips_first' },
  { productId: 'pr_print', name: 'Ashgrove Printing House', signalSource: 'accounts',
    eventType: 'churn_detected', summary: 'A long-standing trade account stopped ordering',
    behaviour: 'answers', conflictAfterwards: true },
  { productId: 'pr_apiary', name: 'Thornfield Apiary Supply', signalSource: 'orders',
    eventType: 'activation_failure', summary: 'A new stockist never placed a first order',
    behaviour: 'answers' },
];

async function observe(productId: string): Promise<ReachabilityObservation> {
  const responsibilities = (await query(
    `SELECT id,product_id,title,state,authority_ref,discovery_evidence_ref
       FROM institutional_responsibilities WHERE product_id=?`, [productId],
  )).rows as unknown as Array<Record<string, unknown>>;
  const questions = (await query(
    'SELECT product_id,responsibility_id,predicate,status FROM founder_evidence_requests WHERE product_id=?',
    [productId])).rows as unknown as Array<Record<string, unknown>>;
  const claims = (await query(
    `SELECT product_id,subject,predicate,epistemic_status,evidence_refs_json,derivation_method
       FROM reconstruction_claims WHERE product_id=?`, [productId],
  )).rows as unknown as Array<Record<string, unknown>>;
  const answers = (await query(
    `SELECT payload_json FROM signal_events WHERE product_id=? AND source='founder_assertion'`,
    [productId])).rows as unknown as Array<Record<string, unknown>>;
  const count = async (sql: string): Promise<number> =>
    Number(((await query(sql, [productId])).rows[0] as Record<string, unknown>).n);

  return {
    productId,
    responsibilities: responsibilities.map((r) => ({
      id: String(r.id), productId: String(r.product_id), title: String(r.title), state: String(r.state),
      authorityRef: r.authority_ref == null ? null : String(r.authority_ref),
      discoveryEvidenceRef: r.discovery_evidence_ref == null ? null : String(r.discovery_evidence_ref),
    })),
    questions: questions.map((q) => ({
      productId: String(q.product_id), responsibilityId: String(q.responsibility_id),
      predicate: String(q.predicate), status: String(q.status),
    })),
    claims: claims.map((c) => ({
      productId: String(c.product_id), subject: String(c.subject), predicate: String(c.predicate),
      epistemicStatus: String(c.epistemic_status),
      evidenceRefs: JSON.parse(String(c.evidence_refs_json)) as Array<{ kind: string; id: string }>,
      derivationMethod: String(c.derivation_method),
    })),
    answered: answers.map((a) => {
      const payload = JSON.parse(String(a.payload_json)) as { responsibility_id: string; predicate: string };
      return `${payload.responsibility_id}:${payload.predicate}`;
    }),
    consentCount: await count('SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=?'),
    executionCount: await count('SELECT COUNT(*) n FROM action_executions WHERE product_id=?'),
  };
}

const truths: ReachabilityTruth[] = [];

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id,clerk_user_id,email) VALUES (?,'pr_clerk','owner@example.com')", [OWNER]);
  await query("INSERT INTO founders (id,clerk_user_id,email) VALUES ('pr_stranger','pr_stranger_clerk','x@example.com')", []);
  // A neighbouring company with its own institutional state, so tenant
  // isolation is a real question rather than a vacuous one.
  await query("INSERT INTO products (id,name,owner_id) VALUES ('pr_neighbour','Unrelated Neighbour','pr_stranger')", []);
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
    VALUES ('pr_neighbour_sig','pr_neighbour','card_terminal','payment_failed','high','{}','Neighbour evidence')`, []);
  await discoverResponsibilityFromSignal('pr_neighbour', 'pr_neighbour_sig');

  for (const fixture of FIXTURES) {
    await query('INSERT INTO products (id,name,owner_id) VALUES (?,?,?)',
      [fixture.productId, fixture.name, OWNER]);
    await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
      VALUES (?,?,?,?,'high','{}',?)`,
    [`${fixture.productId}_sig`, fixture.productId, fixture.signalSource, fixture.eventType, fixture.summary]);
    const responsibility = await discoverResponsibilityFromSignal(fixture.productId, `${fixture.productId}_sig`);
    expect(responsibility, `${fixture.name}: discovery admitted nothing`).not.toBeNull();
    const responsibilityId = responsibility!.id;
    const required = requiredUnderstandingFacts(responsibility!.capability);
    const deferred: string[] = [];

    // Refreshing the page must not multiply questions — exercised for real.
    await selectFounderEvidenceQuestion(fixture.productId);
    await selectFounderEvidenceQuestion(fixture.productId);

    let skipped = false;
    for (let i = 0; i < required.length + 2; i++) {
      const question = await selectFounderEvidenceQuestion(fixture.productId);
      if (!question) break;
      if (fixture.behaviour === 'skips_first' && !skipped) {
        skipped = true;
        deferred.push(`${question.responsibilityId}:${question.fact}`);
        await deferFounderEvidenceRequest(question.requestId, OWNER);
        continue;
      }
      await recordFounderEvidenceAnswer({
        requestId: question.requestId, founderId: OWNER,
        statement: `How ${fixture.name} actually handles this`,
      });
    }

    const expectedConflicts: string[] = [];
    if (fixture.behaviour === 'answers') {
      await earnResponsibilityUnderstanding(fixture.productId, responsibilityId);
    }
    if (fixture.conflictAfterwards) {
      // An independent system later disagrees with what the founder said.
      // Neither side is overwritten; the disagreement is recorded as one.
      await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
        VALUES (?,?,'accounts','churn_detected','high','{}','The account was handled by a reseller all along')`,
      [`${fixture.productId}_later`, fixture.productId]);
      await recordReconstructionClaim({
        productId: fixture.productId, subject: `responsibility:${responsibilityId}`, predicate: 'dependencies',
        value: { statement: 'Two sources disagree about what this depends on' }, epistemicStatus: 'conflicting',
        evidenceRefs: [
          { kind: 'signal_event', id: `${fixture.productId}_later` },
          { kind: 'signal_event', id: `${fixture.productId}_sig` },
        ],
        derivationMethod: 'independent observation disagrees with founder assertion', observedAt: new Date(),
      });
      expectedConflicts.push(`${responsibilityId}:dependencies`);
    }

    truths.push({
      productId: fixture.productId,
      expectedResponsibilities: [responsibility!.title],
      requiredFacts: { [responsibilityId]: required },
      expectedState: { [responsibilityId]: fixture.behaviour === 'answers' ? 'understood' : 'visible' },
      expectedConflicts,
      deferred,
    });
  }
});

describe('executable production-reachability benchmark', () => {
  it('carries four unfamiliar companies onto the ladder through real production paths', async () => {
    const results = [];
    for (const truth of truths) results.push(scoreProductionReachability(await observe(truth.productId), truth));
    expect(evaluateProductionReachabilityGate(results)).toEqual({ passed: true, reasons: [] });

    // The company that skipped a question stayed where it was, and the skipped
    // fact stayed unknown rather than becoming a negative answer.
    const skipper = truths.find((t) => t.deferred.length)!;
    expect(Object.values(skipper.expectedState)).toEqual(['visible']);
    const observation = await observe(skipper.productId);
    expect(observation.responsibilities.every((r) => r.state === 'visible')).toBe(true);

    // Nothing anywhere in the corpus leaked into a neighbour.
    for (const truth of truths) {
      expect(JSON.stringify(await observe(truth.productId))).not.toContain('pr_neighbour');
    }
  });

  it('fails hard on invented evidence, smuggled authority, and a hidden jump', async () => {
    const truth = truths[0];
    const honest = await observe(truth.productId);
    const responsibilityId = honest.responsibilities[0].id;

    const fabricated = scoreProductionReachability({
      ...honest,
      // A claim with no evidence behind it, a responsibility nobody discovered,
      // a rung nobody earned, and a consent the answer created.
      claims: [...honest.claims, {
        productId: truth.productId, subject: `responsibility:${responsibilityId}`, predicate: 'current_carrier',
        epistemicStatus: 'known', evidenceRefs: [], derivationMethod: 'authenticated founder assertion',
      }],
      responsibilities: [...honest.responsibilities, {
        id: 'invented', productId: truth.productId, title: 'A responsibility nobody observed',
        state: 'operating', authorityRef: 'forged', discoveryEvidenceRef: null,
      }],
      consentCount: 1,
    }, truth);

    expect(fabricated.hardFailures).toEqual(expect.arrayContaining([
      'invented_evidence', 'founder_answer_created_authority', 'unsupported_responsibility',
      'hidden_maturity_jump', 'fabricated_company_fact',
    ]));
    expect(evaluateProductionReachabilityGate([fabricated, fabricated, fabricated, fabricated]))
      .toMatchObject({ passed: false });
  });

  it('fails when silence is read as evidence', async () => {
    const truth = truths.find((t) => t.deferred.length)!;
    const honest = await observe(truth.productId);
    const [responsibilityId, predicate] = truth.deferred[0].split(':');
    const invented = scoreProductionReachability({
      ...honest,
      claims: [...honest.claims, {
        productId: truth.productId, subject: `responsibility:${responsibilityId}`, predicate,
        epistemicStatus: 'known', evidenceRefs: [{ kind: 'signal_event', id: `${truth.productId}_sig` }],
        derivationMethod: 'inferred from the founder not answering',
      }],
    }, truth);
    expect(invented.hardFailures).toContain('silence_treated_as_evidence');
    expect(invented.unknownPreservation).toBe(0);
  });

  it('refuses to pass a dimension nothing exercised', async () => {
    // A gate that can pass without ever testing a dimension is not a gate.
    const truth: ReachabilityTruth = {
      productId: 'pr_empty', expectedResponsibilities: [], requiredFacts: {},
      expectedState: {}, expectedConflicts: [], deferred: [],
    };
    const empty = scoreProductionReachability({
      productId: 'pr_empty', responsibilities: [], questions: [], claims: [], answered: [],
      consentCount: 0, executionCount: 0,
    }, truth);
    // Every rate is a vacuous 1 …
    expect(empty.conflictPreservation).toBe(1);
    expect(empty.unknownPreservation).toBe(1);
    // … and the gate still refuses it, because nothing was tested.
    expect(evaluateProductionReachabilityGate([empty, empty, empty, empty]))
      .toMatchObject({ passed: false });
    expect(evaluateProductionReachabilityGate([empty, empty, empty, empty]).reasons)
      .toEqual(expect.arrayContaining(['conflictPreservation_untested', 'claimPrecision_untested']));
  });
});
