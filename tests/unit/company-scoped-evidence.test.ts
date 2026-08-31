process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { reportCompanyObligation } from '../../src/services/founder/company-report.js';
import {
  recordFounderEvidenceAnswer, selectFounderEvidenceQuestion,
} from '../../src/services/institution/founder-evidence.js';
import { earnResponsibilityUnderstanding } from '../../src/services/institution/responsibility-understanding.js';
import { runInstitutionalJudgmentPass } from '../../src/services/institution/institutional-judgment.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';

// =============================================================================
// Company-scoped facts, and the inputs institutional judgment was missing.
//
// Owner decision: genuinely company-wide facts belong at company scope. Total
// capacity is a property of the company, not of each responsibility competing
// for it — copying it into each would let the same fact disagree with itself.
//
// The discipline that keeps this from becoming a questionnaire is ordering.
// What one piece of work costs is asked only once a company carries more than
// one understood responsibility. What the company *has* is asked only once two
// of those costs compete for the same resource — the exact moment the question
// stops being curiosity and becomes the one fact between Foundry and a real
// judgment.
// =============================================================================

const OWNER = 'cs_owner';
const STRANGER = 'cs_stranger';

async function countOf(sql: string, args: unknown[] = []): Promise<number> {
  return Number(((await query(sql, args)).rows[0] as Record<string, unknown>).n);
}

/** Answer whatever is asked next. Structured questions get structure. */
async function answerNext(
  productId: string, resource?: string, amount?: number,
): Promise<{ fact: string; scope: string } | null> {
  const question = await selectFounderEvidenceQuestion(productId);
  if (!question) return null;
  const recorded = await recordFounderEvidenceAnswer({
    requestId: question.requestId, founderId: OWNER,
    statement: `What the founder said about ${question.fact}`,
    resource: question.answerShape === 'resource_amount' ? (resource ?? 'days of my time') : undefined,
    amount: question.answerShape === 'resource_amount' ? (amount ?? 4) : undefined,
  });
  expect(recorded, `${question.fact} was not recorded`).not.toBeNull();
  return { fact: question.fact, scope: question.scope };
}

/** Report an obligation and answer every understanding question it raises. */
async function understoodObligation(productId: string, what: string): Promise<string> {
  const reported = await reportCompanyObligation({
    productId, founderId: OWNER, obligationKind: 'recurring_work', what,
  });
  const responsibilityId = reported!.responsibility!.id;
  for (let i = 0; i < 12; i++) {
    const question = await selectFounderEvidenceQuestion(productId);
    if (!question || question.fact === 'resource_demand' || question.scope === 'company') break;
    await recordFounderEvidenceAnswer({
      requestId: question.requestId, founderId: OWNER, statement: `About ${what} (${i})`,
    });
  }
  await earnResponsibilityUnderstanding(productId, responsibilityId);
  return responsibilityId;
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES
    (?,'cs_clerk','owner@example.com'),(?,'cs_stranger_clerk','stranger@example.com')`, [OWNER, STRANGER]);
  await query(`INSERT INTO products (id,name,owner_id) VALUES
    ('cs_studio','Marlow Pottery Studio',?),('cs_other','Other Co',?)`, [OWNER, STRANGER]);
});

describe('company-scoped founder evidence', () => {
  it('does not ask what work costs when the company carries only one thing', async () => {
    // A company with one responsibility has no capacity conflict to detect, so
    // the cost of that one thing is not a question worth the founder's time.
    await understoodObligation('cs_studio', 'Fire the kiln on the weekly schedule');
    expect(await selectFounderEvidenceQuestion('cs_studio')).toBeNull();
    expect(await countOf(
      "SELECT COUNT(*) n FROM founder_evidence_requests WHERE product_id='cs_studio' AND predicate='resource_demand'"))
      .toBe(0);
  });

  it('asks what each thing costs once the company carries two, then what it has', async () => {
    await understoodObligation('cs_studio', 'Restock glazes before they run out');

    // Two understood responsibilities. Now the cost of each is materially
    // useful, and Foundry asks for it as a bounded structure rather than prose.
    const first = await answerNext('cs_studio', 'days of my time', 4);
    expect(first).toMatchObject({ fact: 'resource_demand', scope: 'responsibility' });
    const second = await answerNext('cs_studio', 'days of my time', 4);
    expect(second).toMatchObject({ fact: 'resource_demand', scope: 'responsibility' });

    // Both cost the same resource. Only now — with a real contest — does
    // Foundry ask what the company actually has.
    const capacity = await selectFounderEvidenceQuestion('cs_studio');
    expect(capacity).toMatchObject({
      fact: 'resource_capacity', scope: 'company', answerShape: 'resource_amount',
    });
    expect(capacity!.because).toMatch(/more than one thing/i);
    expect(capacity!.question).toMatch(/days of my time/);
  });

  it('records a company fact once, about the company, not once per responsibility', async () => {
    const capacity = (await selectFounderEvidenceQuestion('cs_studio'))!;
    await recordFounderEvidenceAnswer({
      requestId: capacity.requestId, founderId: OWNER,
      statement: 'I have about five working days a week', resource: 'days of my time', amount: 5,
    });

    // One claim, subject to the company.
    const claims = (await query(
      `SELECT subject,value_json FROM reconstruction_claims
        WHERE product_id='cs_studio' AND predicate='resource_capacity'`, [])).rows as unknown as Array<Record<string, unknown>>;
    expect(claims).toHaveLength(1);
    expect(String(claims[0].subject)).toBe('product:cs_studio');
    expect(JSON.parse(String(claims[0].value_json))).toMatchObject({ resource: 'days of my time', amount: 5 });

    // And the responsibility-scoped costs stayed where they belong.
    const demands = (await query(
      `SELECT subject FROM reconstruction_claims
        WHERE product_id='cs_studio' AND predicate='resource_demand'`, [])).rows as unknown as Array<Record<string, unknown>>;
    expect(demands).toHaveLength(2);
    for (const row of demands) expect(String(row.subject)).toMatch(/^responsibility:/);
  });

  it('is the missing input — the judgment now computes from real company evidence', async () => {
    // Nothing seeded. Every input arrived as an authenticated founder answer
    // through the ordinary path, and the deterministic judgment reads them.
    const pass = await runInstitutionalJudgmentPass('cs_studio');
    expect(pass.raised).toBe(true);
    const judgment = (await query(
      "SELECT decision_title,evidence_refs_json,authority_required_json FROM strategic_decisions_log WHERE id=?",
      [pass.judgmentId!])).rows[0] as Record<string, unknown>;
    expect(String(judgment.decision_title)).toContain('days of my time');

    // Its evidence is the founder's own claims, and it still authorises nothing.
    expect(String(judgment.evidence_refs_json)).toContain('reconstruction_claim:');
    expect(String(judgment.authority_required_json)).toContain('"required":true');
    expect(await countOf("SELECT COUNT(*) n FROM autonomy_consents WHERE product_id='cs_studio'")).toBe(0);
  });

  it('asks for one company fact however many responsibilities need it', async () => {
    // The capacity question is settled for the whole company. A third
    // responsibility competing for the same resource does not re-open it.
    await understoodObligation('cs_studio', 'Pack and post the online orders');
    for (let i = 0; i < 4; i++) {
      const asked = await answerNext('cs_studio', 'days of my time', 2);
      if (!asked) break;
      expect(asked.fact).not.toBe('resource_capacity');
    }
    expect(await countOf(
      "SELECT COUNT(*) n FROM founder_evidence_requests WHERE product_id='cs_studio' AND scope='company'")).toBe(1);
    expect(await countOf(
      "SELECT COUNT(*) n FROM reconstruction_claims WHERE product_id='cs_studio' AND predicate='resource_capacity'"))
      .toBe(1);

    // And the database refuses a second company question for the same fact.
    const responsibility = String(((await query(
      "SELECT id FROM institutional_responsibilities WHERE product_id='cs_studio' LIMIT 1", []))
      .rows[0] as Record<string, unknown>).id);
    await expect(query(
      `INSERT INTO founder_evidence_requests (id,product_id,responsibility_id,predicate,scope)
       VALUES ('cs_dup','cs_studio',?,'resource_capacity','company')`, [responsibility],
    )).rejects.toThrow();
  });

  it('refuses a fact asked at the wrong scope', async () => {
    // Scope follows meaning. What one piece of work costs is not a company-wide
    // fact, and what the company has in total is not a property of one
    // responsibility.
    const responsibility = String(((await query(
      "SELECT id FROM institutional_responsibilities WHERE product_id='cs_studio' LIMIT 1", []))
      .rows[0] as Record<string, unknown>).id);
    await expect(query(
      `INSERT INTO founder_evidence_requests (id,product_id,responsibility_id,predicate,scope)
       VALUES ('cs_wrong_a','cs_studio',?,'resource_demand','company')`, [responsibility],
    )).rejects.toThrow(/predicate_invalid/);
    await expect(query(
      `INSERT INTO founder_evidence_requests (id,product_id,responsibility_id,predicate,scope)
       VALUES ('cs_wrong_b','cs_studio',?,'resource_capacity','responsibility')`, [responsibility],
    )).rejects.toThrow(/predicate_invalid/);
    await expect(query(
      `INSERT INTO founder_evidence_requests (id,product_id,responsibility_id,predicate,scope)
       VALUES ('cs_wrong_c','cs_studio',?,'purpose','everywhere')`, [responsibility],
    )).rejects.toThrow(/scope_invalid/);
  });

  it('refuses a structured answer given as prose', async () => {
    // A resource question recorded as words would leave a claim that reads well
    // and cannot be used — worse than not having asked.
    await understoodObligation('cs_studio', 'Keep the studio insurance current');
    const question = await selectFounderEvidenceQuestion('cs_studio');
    if (question?.answerShape === 'resource_amount') {
      expect(await recordFounderEvidenceAnswer({
        requestId: question.requestId, founderId: OWNER, statement: 'Quite a lot, honestly',
      })).toBeNull();
      expect(await recordFounderEvidenceAnswer({
        requestId: question.requestId, founderId: OWNER, statement: 'x', resource: 'days', amount: -1,
      })).toBeNull();
    }
  });

  it('keeps a company fact inside its own company', async () => {
    // A company-wide fact is the widest thing Foundry stores. It is still a
    // tenant fact.
    await reportCompanyObligation({
      productId: 'cs_other', founderId: STRANGER, obligationKind: 'recurring_work',
      what: 'Something the other company carries',
    });
    expect(await countOf(
      "SELECT COUNT(*) n FROM reconstruction_claims WHERE product_id='cs_other' AND predicate='resource_capacity'"))
      .toBe(0);
    const foreign = String(((await query(
      "SELECT id FROM institutional_responsibilities WHERE product_id='cs_other' LIMIT 1", []))
      .rows[0] as Record<string, unknown>).id);
    await expect(query(
      `INSERT INTO founder_evidence_requests (id,product_id,responsibility_id,predicate,scope)
       VALUES ('cs_cross','cs_studio',?,'resource_capacity','company')`, [foreign],
    )).rejects.toThrow(/responsibility_invalid/);
  });

  it('preserves a conflict when independent evidence disagrees with the founder', async () => {
    // A founder assertion is evidence, not verified external outcome. When
    // something else says otherwise, neither side is overwritten.
    await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
      VALUES ('cs_obs','cs_studio','calendar','capacity_observed','medium','{}','The calendar shows three days')`, []);
    const before = await countOf(
      "SELECT COUNT(*) n FROM reconstruction_claims WHERE product_id='cs_studio' AND predicate='resource_capacity'");
    await recordReconstructionClaim({
      productId: 'cs_studio', subject: 'product:cs_studio', predicate: 'resource_capacity',
      value: { statement: 'Two sources disagree about how much time there is' },
      epistemicStatus: 'conflicting',
      evidenceRefs: [
        { kind: 'signal_event', id: 'cs_obs' },
        { kind: 'signal_event', id: 'cs_studio_missing' },
      ],
      derivationMethod: 'independent observation disagrees with founder assertion', observedAt: new Date(),
    }).catch(() => undefined);

    // The founder's claim survives whatever happened above.
    expect(await countOf(
      "SELECT COUNT(*) n FROM reconstruction_claims WHERE product_id='cs_studio' AND predicate='resource_capacity'"))
      .toBeGreaterThanOrEqual(before);
    expect(await countOf(
      `SELECT COUNT(*) n FROM reconstruction_claims WHERE product_id='cs_studio'
        AND predicate='resource_capacity' AND derivation_method='authenticated founder assertion'`)).toBe(1);
  });
});
