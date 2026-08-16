process.env.TURSO_DATABASE_URL = 'file::memory:';

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { reportCompanyObligation } from '../../src/services/founder/company-report.js';
import {
  listFounderFactOpportunities, previewFounderFact, recordFounderEvidenceAnswer,
  selectFounderEvidenceQuestion, submitFounderFact,
} from '../../src/services/institution/founder-evidence.js';
import { earnResponsibilityUnderstanding } from '../../src/services/institution/responsibility-understanding.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';

// =============================================================================
// The explicit founder fact affordance.
//
// Owner decision: no model interprets arbitrary chat into company evidence.
// Chat stays chat. The founder may deliberately state a bounded fact — but only
// one an institutional consumer is currently waiting on, shown back exactly as
// it will be stored, and stored only after explicit authenticated confirmation.
//
// There is no separate founder-knowledge store. This is the founder-initiated
// half of the same elicitation path Foundry uses when it asks.
// =============================================================================

const OWNER = 'fa_owner';
const STRANGER = 'fa_stranger';
const PRODUCT = 'fa_florist';
const FOREIGN = 'fa_foreign';

async function countOf(sql: string, args: unknown[] = []): Promise<number> {
  return Number(((await query(sql, args)).rows[0] as Record<string, unknown>).n);
}

async function understoodObligation(productId: string, what: string, owner = OWNER): Promise<string> {
  const reported = await reportCompanyObligation({
    productId, founderId: owner, obligationKind: 'recurring_work', what,
  });
  const responsibilityId = reported!.responsibility!.id;
  for (let i = 0; i < 40; i++) {
    const question = await selectFounderEvidenceQuestion(productId);
    if (!question || question.fact === 'resource_demand' || question.scope === 'company') break;
    await recordFounderEvidenceAnswer({
      requestId: question.requestId, founderId: owner, statement: `About ${what} (${i})`,
    });
  }
  await earnResponsibilityUnderstanding(productId, responsibilityId);
  return responsibilityId;
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES
    (?,'fa_clerk','owner@example.com'),(?,'fa_stranger_clerk','stranger@example.com')`, [OWNER, STRANGER]);
  await query(`INSERT INTO products (id,name,owner_id) VALUES
    (?,'Wren & Fern Florists',?),(?,'Foreign Co',?)`, [PRODUCT, OWNER, FOREIGN, STRANGER]);
});

describe('explicit founder fact affordance', () => {
  it('offers only facts something is actually waiting on', async () => {
    // A company with nothing recognised has nothing to tell Foundry about.
    expect(await listFounderFactOpportunities(PRODUCT)).toEqual([]);

    await reportCompanyObligation({
      productId: PRODUCT, founderId: OWNER, obligationKind: 'delivery',
      what: 'Get the Saturday wedding flowers out on time',
    });
    const offered = await listFounderFactOpportunities(PRODUCT);
    expect(offered.length).toBeGreaterThan(0);

    // Every offer names a real responsibility and a fact the institution
    // requires — never a field that merely exists.
    for (const o of offered) {
      expect(o.responsibilityTitle).toBe('Get the Saturday wedding flowers out on time');
      expect(o.question).not.toMatch(/predicate|scope|epistemic|claim/i);
    }
    // Bounded, not a questionnaire.
    expect(offered.length).toBeLessThanOrEqual(5);
  });

  it('creates nothing by being opened or previewed', async () => {
    const before = {
      signals: await countOf("SELECT COUNT(*) n FROM signal_events WHERE product_id=? AND source='founder_assertion'", [PRODUCT]),
      claims: await countOf('SELECT COUNT(*) n FROM reconstruction_claims WHERE product_id=?', [PRODUCT]),
      requests: await countOf('SELECT COUNT(*) n FROM founder_evidence_requests WHERE product_id=?', [PRODUCT]),
    };
    const chosen = (await listFounderFactOpportunities(PRODUCT))[0];

    // Listing is pure, and so is the preview: the founder sees the exact
    // sentence before anything is written.
    const preview = previewFounderFact({
      fact: chosen.fact, scope: chosen.scope, responsibilityTitle: chosen.responsibilityTitle,
      statement: 'Because the couple has been waiting six months',
    });
    expect(preview).toContain('Because the couple has been waiting six months');
    expect(preview).toContain(chosen.responsibilityTitle);

    expect(await countOf("SELECT COUNT(*) n FROM signal_events WHERE product_id=? AND source='founder_assertion'", [PRODUCT]))
      .toBe(before.signals);
    expect(await countOf('SELECT COUNT(*) n FROM reconstruction_claims WHERE product_id=?', [PRODUCT]))
      .toBe(before.claims);
    expect(await countOf('SELECT COUNT(*) n FROM founder_evidence_requests WHERE product_id=?', [PRODUCT]))
      .toBe(before.requests);
  });

  it('stores the fact only on explicit authenticated submission', async () => {
    const chosen = (await listFounderFactOpportunities(PRODUCT))[0];
    const recorded = await submitFounderFact({
      productId: PRODUCT, founderId: OWNER, fact: chosen.fact, scope: chosen.scope,
      responsibilityId: chosen.responsibilityId,
      statement: 'Because the couple has been waiting six months',
    });
    expect(recorded).not.toBeNull();

    const claim = (await query('SELECT subject,predicate,derivation_method,evidence_refs_json FROM reconstruction_claims WHERE id=?',
      [recorded!.claimId])).rows[0] as Record<string, unknown>;
    expect(claim).toMatchObject({
      subject: `responsibility:${chosen.responsibilityId}`, predicate: chosen.fact,
      derivation_method: 'authenticated founder assertion',
    });
    // It went through the ordinary evidence path — a signal event, not a
    // separate store.
    const refs = JSON.parse(String(claim.evidence_refs_json)) as Array<{ kind: string; id: string }>;
    expect(refs[0].kind).toBe('signal_event');
    expect(await countOf(
      "SELECT COUNT(*) n FROM signal_events WHERE id=? AND source='founder_assertion'", [refs[0].id])).toBe(1);
  });

  it('is inert on replay', async () => {
    // The same submission arriving twice states a fact that is now grounded, so
    // it is no longer something Foundry is waiting on.
    const claimsBefore = await countOf('SELECT COUNT(*) n FROM reconstruction_claims WHERE product_id=?', [PRODUCT]);
    const responsibilityId = String(((await query(
      'SELECT id FROM institutional_responsibilities WHERE product_id=?', [PRODUCT]))
      .rows[0] as Record<string, unknown>).id);
    expect(await submitFounderFact({
      productId: PRODUCT, founderId: OWNER, fact: 'purpose', scope: 'responsibility',
      responsibilityId, statement: 'Because the couple has been waiting six months',
    })).toBeNull();
    expect(await countOf('SELECT COUNT(*) n FROM reconstruction_claims WHERE product_id=?', [PRODUCT]))
      .toBe(claimsBefore);
  });

  it('refuses a fact nothing is waiting on', async () => {
    // A founder cannot volunteer into a predicate the institution does not
    // consume, however well-formed the submission looks.
    const responsibilityId = String(((await query(
      'SELECT id FROM institutional_responsibilities WHERE product_id=?', [PRODUCT]))
      .rows[0] as Record<string, unknown>).id);
    for (const fact of ['annual_revenue', 'favourite_colour', 'resource_capacity']) {
      expect(await submitFounderFact({
        productId: PRODUCT, founderId: OWNER, fact, scope: 'responsibility',
        responsibilityId, statement: 'Something true but unasked',
      })).toBeNull();
    }
  });

  it('refuses a foreign tenant and a caller-supplied identity', async () => {
    const chosen = (await listFounderFactOpportunities(PRODUCT))[0];
    // A stranger cannot speak for this company.
    expect(await submitFounderFact({
      productId: PRODUCT, founderId: STRANGER, fact: chosen.fact, scope: chosen.scope,
      responsibilityId: chosen.responsibilityId, statement: 'Not mine to say',
    })).toBeNull();
    // Nor can this founder write into another company.
    expect(await submitFounderFact({
      productId: FOREIGN, founderId: OWNER, fact: chosen.fact, scope: chosen.scope,
      responsibilityId: chosen.responsibilityId, statement: 'Not my company',
    })).toBeNull();
    expect(await countOf(
      "SELECT COUNT(*) n FROM signal_events WHERE product_id=? AND source='founder_assertion'", [FOREIGN])).toBe(0);
  });

  it('keeps responsibility facts and company facts at their own scope', async () => {
    // Drive the company to where a company-wide fact is genuinely needed.
    await understoodObligation(PRODUCT, 'Keep the cold room stocked');
    await understoodObligation(PRODUCT, 'Answer the shop phone during opening hours');
    for (let i = 0; i < 4; i++) {
      const offers = await listFounderFactOpportunities(PRODUCT);
      const demand = offers.find((o) => o.fact === 'resource_demand');
      if (!demand) break;
      await submitFounderFact({
        productId: PRODUCT, founderId: OWNER, fact: 'resource_demand', scope: 'responsibility',
        responsibilityId: demand.responsibilityId, statement: 'About two days',
        resource: 'days of my time', amount: 2,
      });
    }
    const capacity = (await listFounderFactOpportunities(PRODUCT)).find((o) => o.fact === 'resource_capacity');
    expect(capacity).toMatchObject({ scope: 'company', answerShape: 'resource_amount' });

    // A structured fact stated as prose is refused rather than stored unusable.
    expect(previewFounderFact({
      fact: 'resource_capacity', scope: 'company', responsibilityTitle: capacity!.responsibilityTitle,
      statement: 'Quite a lot',
    })).toBeNull();

    await submitFounderFact({
      productId: PRODUCT, founderId: OWNER, fact: 'resource_capacity', scope: 'company',
      responsibilityId: capacity!.responsibilityId, statement: 'Five working days',
      resource: 'days of my time', amount: 5,
    });
    const rows = (await query(
      `SELECT subject,predicate FROM reconstruction_claims WHERE product_id=?
        AND predicate IN ('resource_capacity','resource_demand')`, [PRODUCT]))
      .rows as unknown as Array<Record<string, unknown>>;
    for (const row of rows) {
      if (row.predicate === 'resource_capacity') expect(String(row.subject)).toBe(`product:${PRODUCT}`);
      else expect(String(row.subject)).toMatch(/^responsibility:/);
    }
  });

  it('creates no consent, action, execution, or maturity', async () => {
    // Telling Foundry how the company works is evidence and nothing else.
    expect(await countOf('SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=?', [PRODUCT])).toBe(0);
    expect(await countOf('SELECT COUNT(*) n FROM action_executions WHERE product_id=?', [PRODUCT])).toBe(0);
    expect(await countOf(
      "SELECT COUNT(*) n FROM institutional_responsibilities WHERE product_id=? AND state NOT IN ('visible','understood')",
      [PRODUCT])).toBe(0);
    expect(await countOf(
      'SELECT COUNT(*) n FROM institutional_responsibilities WHERE product_id=? AND authority_ref IS NOT NULL',
      [PRODUCT])).toBe(0);
  });

  it('preserves a conflict when independent evidence later disagrees', async () => {
    await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
      VALUES ('fa_obs',?,'calendar','capacity_observed','medium','{}','The calendar shows three days')`, [PRODUCT]);
    const founderClaims = await countOf(
      `SELECT COUNT(*) n FROM reconstruction_claims WHERE product_id=? AND predicate='resource_capacity'
        AND derivation_method='authenticated founder assertion'`, [PRODUCT]);
    await recordReconstructionClaim({
      productId: PRODUCT, subject: `product:${PRODUCT}`, predicate: 'resource_capacity',
      value: { statement: 'Two sources disagree about how much time there is' },
      epistemicStatus: 'conflicting',
      evidenceRefs: [{ kind: 'signal_event', id: 'fa_obs' }, { kind: 'product', id: PRODUCT }],
      derivationMethod: 'independent observation disagrees with founder assertion', observedAt: new Date(),
    });
    // Neither side is overwritten.
    expect(await countOf(
      `SELECT COUNT(*) n FROM reconstruction_claims WHERE product_id=? AND predicate='resource_capacity'
        AND derivation_method='authenticated founder assertion'`, [PRODUCT])).toBe(founderClaims);
    expect(await countOf(
      `SELECT COUNT(*) n FROM reconstruction_claims WHERE product_id=? AND epistemic_status='conflicting'`, [PRODUCT]))
      .toBe(1);
    // And Foundry does not re-offer the contested fact.
    expect((await listFounderFactOpportunities(PRODUCT)).find((o) => o.fact === 'resource_capacity'))
      .toBeUndefined();
  });

  it('does not treat chat as evidence', () => {
    // The conversational surface writes no canonical company fact, and no model
    // interprets prose into one. The affordance above is the only founder-
    // initiated path into evidence.
    const chat = readFileSyncSafe('src/services/chat/institution.ts');
    expect(chat).not.toMatch(/recordReconstructionClaim|founder_assertion|submitFounderFact/);
  });
});

function readFileSyncSafe(relative: string): string {
  const path = resolve(process.cwd(), relative);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}
