process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { recordReconstructionClaim, reconstructCompany } from '../../src/services/institution/reconstruction.js';
import {
  discoverCandidatesFromReconstruction, promoteResponsibilityCandidate,
} from '../../src/services/institution/responsibility-candidate.js';
import { discoverResponsibilityFromSignal } from '../../src/services/institution/discovery.js';
import { getResponsibility } from '../../src/services/institution/responsibility.js';
import { reportedObligation } from '../fixtures/responsibility-state.js';
import {
  evaluateE3ResponsibilityRecognitionGate, scoreResponsibilityRecognition,
  type RecognitionActual, type RecognitionTruth,
} from '../../src/services/institution/responsibility-recognition-benchmark.js';

// =============================================================================
// Unfamiliar-company generalization.
//
// Every existing corpus was written alongside the code it scores, and every
// company in it is SaaS-shaped: deployments, dispatch, fulfillment, billing,
// support. AcreOS is deferred by the owner precisely so a genuinely unfamiliar
// company survives as a real test, which leaves a gap: nothing currently checks
// whether recognition keys on institutional *structure* or on the vocabulary of
// its own fixtures.
//
// This corpus is authored from a deliberately different generative principle —
// five companies from domains with no token in common with the existing
// fixtures, none of them software businesses — and run through the frozen
// `2026-08-v1` gate UNCHANGED.
//
// What this proves and what it does not, stated plainly:
//   • It proves the epistemic machinery (known / conflicting / unknown / stale),
//     provenance, tenancy, and authority separation are not domain-keyed.
//   • It proves production discovery ABSTAINS on unfamiliar evidence rather
//     than inventing a responsibility for it.
//   • It does NOT make the corpus independent in the strongest sense: the same
//     author wrote the code. Only a company Foundry has never seen, supplied by
//     someone else, closes that. AcreOS remains DEFERRED BY OWNER, and this is
//     a partial substitute, not a replacement.
// =============================================================================

const OWNER = 'ug_owner';

/** Five companies, none of them software. Vocabulary chosen to share nothing
 * with the existing fixtures so a domain-keyed implementation would fail. */
const truths: RecognitionTruth[] = [
  // Known operating rule, ordinary evidence → recognised and promotable.
  { productId: 'ug_veterinary', expectedCandidates: ['Keep the surgical rota staffed'], expectedResponsibilities: ['Keep the surgical rota staffed'], shouldAbstain: false },
  { productId: 'ug_bakery', expectedCandidates: ['Hold the overnight proving schedule'], expectedResponsibilities: ['Hold the overnight proving schedule'], shouldAbstain: false },
  // Two independent sources disagree about who owns it → visible, not canonical.
  { productId: 'ug_freight', expectedCandidates: ['Settle who books the return legs'], expectedResponsibilities: [], shouldAbstain: true },
  // The company says it does not know → unknown is a legitimate state.
  { productId: 'ug_college', expectedCandidates: [], expectedResponsibilities: [], shouldAbstain: true },
  // The rule was true and has expired → stale evidence promotes nothing.
  { productId: 'ug_translation', expectedCandidates: ['Revisit the retired glossary review'], expectedResponsibilities: [], shouldAbstain: true },
];

async function actual(productId: string): Promise<RecognitionActual> {
  const candidates = await query(
    `SELECT id,product_id,proposed_responsibility,status,epistemic_status,evidence_refs_json
       FROM responsibility_candidates WHERE product_id=?`, [productId]);
  const responsibilities = await query(
    'SELECT product_id,title,state,authority_ref FROM institutional_responsibilities WHERE product_id=?', [productId]);
  const promotions = await query(
    "SELECT candidate_id FROM responsibility_candidate_decisions WHERE product_id=? AND decision='promoted'", [productId]);
  return {
    candidates: (candidates.rows as unknown as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id), productId: String(row.product_id), title: String(row.proposed_responsibility),
      status: String(row.status), epistemicStatus: String(row.epistemic_status),
      evidenceCount: (JSON.parse(String(row.evidence_refs_json)) as unknown[]).length,
    })),
    responsibilities: (responsibilities.rows as unknown as Array<Record<string, unknown>>).map((row) => ({
      productId: String(row.product_id), title: String(row.title), state: String(row.state),
      authorityRef: row.authority_ref == null ? null : String(row.authority_ref),
    })),
    promotionCandidateIds: promotions.rows.map((row) => String(row.candidate_id)),
    createdConsentCount: 0, createdExecutionCount: 0,
  };
}

const OBSERVED = new Date('2026-08-14');

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES
    (?,'ug_clerk','practice@example.com'),('ug_neighbour','ug_neighbour_clerk','neighbour@example.com')`, [OWNER]);
  await query(`INSERT INTO products (id,name,owner_id) VALUES
    ('ug_veterinary','Rowan Veterinary Practice',?),
    ('ug_bakery','Halden Bread Supply',?),
    ('ug_freight','Marsh & Cole Freight Brokerage',?),
    ('ug_college','Ashfield Community College',?),
    ('ug_translation','Vireo Translation Agency',?),
    ('ug_neighbour_co','Unrelated Neighbour Co','ug_neighbour')`,
  [OWNER, OWNER, OWNER, OWNER, OWNER]);

  // Evidence in each company's own language. None of these event types are in
  // production discovery's admitted contract.
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary) VALUES
    ('ug_sig_vet','ug_veterinary','rota','surgery_unstaffed','high','{}','Tuesday theatre list has no second nurse'),
    ('ug_sig_bakery','ug_bakery','production','prove_window_missed','high','{}','Overnight prove started ninety minutes late'),
    ('ug_sig_freight_a','ug_freight','dispatch_desk','return_leg_unbooked','medium','{}','Yard says the desk books return legs'),
    ('ug_sig_freight_b','ug_freight','manual','return_leg_unbooked','medium','{}','Desk says the yard books return legs'),
    ('ug_sig_translation','ug_translation','glossary','term_review_overdue','medium','{}','Glossary review lapsed last winter'),
    ('ug_sig_neighbour','ug_neighbour_co','manual','surgery_unstaffed','high','{}','Neighbour evidence')`, []);

  for (const [productId, subject, title, capability, signal] of [
    ['ug_veterinary', 'surgical_rota', 'Keep the surgical rota staffed', 'operations', 'ug_sig_vet'],
    ['ug_bakery', 'proving_schedule', 'Hold the overnight proving schedule', 'operations', 'ug_sig_bakery'],
  ]) {
    await recordReconstructionClaim({
      productId, subject, predicate: 'operational_responsibility', value: { title, capability },
      epistemicStatus: 'known', evidenceRefs: [{ kind: 'signal_event', id: signal }],
      derivationMethod: 'typed held-out operating rule', observedAt: OBSERVED,
    });
  }
  await recordReconstructionClaim({
    productId: 'ug_freight', subject: 'return_legs', predicate: 'operational_responsibility',
    value: { title: 'Settle who books the return legs', capability: 'operations' }, epistemicStatus: 'conflicting',
    evidenceRefs: [{ kind: 'signal_event', id: 'ug_sig_freight_a' }, { kind: 'signal_event', id: 'ug_sig_freight_b' }],
    derivationMethod: 'unresolved independent sources', observedAt: OBSERVED,
  });
  await recordReconstructionClaim({
    productId: 'ug_college', subject: 'company', predicate: 'operational_responsibility',
    epistemicStatus: 'unknown', derivationMethod: 'explicit unknown', observedAt: OBSERVED,
  });
  await recordReconstructionClaim({
    productId: 'ug_translation', subject: 'glossary', predicate: 'operational_responsibility',
    value: { title: 'Revisit the retired glossary review', capability: 'operations' }, epistemicStatus: 'known',
    evidenceRefs: [{ kind: 'signal_event', id: 'ug_sig_translation' }],
    derivationMethod: 'typed historical rule', observedAt: new Date('2025-01-01'), validUntil: new Date('2025-02-01'),
  });
});

describe('unfamiliar-company generalization', () => {
  it('passes the frozen recognition gate unchanged on companies unlike any it was tuned on', async () => {
    for (const truth of truths) {
      await reconstructCompany(truth.productId, OBSERVED);
      const candidates = await discoverCandidatesFromReconstruction(truth.productId, OBSERVED);
      // Twice, deliberately: a second pass must converge, not duplicate.
      await discoverCandidatesFromReconstruction(truth.productId, OBSERVED);
      for (const candidate of candidates.filter((item) => item.epistemicStatus === 'known')) {
        await promoteResponsibilityCandidate({
          productId: truth.productId, candidateId: candidate.id, mechanism: 'deterministic',
        });
      }
    }
    const results = [];
    for (const truth of truths) results.push(scoreResponsibilityRecognition(await actual(truth.productId), truth));
    expect(evaluateE3ResponsibilityRecognitionGate(results)).toEqual({ passed: true, reasons: [] });
  });

  it('keeps a neighbouring company out of every result', async () => {
    // Tenancy is not a domain concept, so an unfamiliar corpus is a fair test
    // of it: nothing about a company Foundry has never seen may leak sideways.
    for (const truth of truths) {
      expect(JSON.stringify(await actual(truth.productId))).not.toContain('ug_neighbour');
    }
    expect(await actual('ug_neighbour_co')).toMatchObject({ candidates: [], responsibilities: [] });
  });

  it('abstains on unfamiliar evidence instead of inventing a responsibility for it', async () => {
    // Production discovery admits only signal kinds whose operational
    // responsibility is unambiguous. Every signal in this corpus is real
    // company evidence in the company's own language, and none of them are
    // admissible. The correct behaviour is to record nothing — evidence stays
    // evidence, and unknown stays a legitimate state.
    for (const [productId, signalId] of [
      ['ug_veterinary', 'ug_sig_vet'], ['ug_bakery', 'ug_sig_bakery'],
      ['ug_freight', 'ug_sig_freight_a'], ['ug_translation', 'ug_sig_translation'],
    ]) {
      expect(await discoverResponsibilityFromSignal(productId, signalId)).toBeNull();
    }
    // And it abstained rather than doing nothing at all: nothing in this corpus
    // entered the ladder through the signal path.
    //
    // Asked by the ACTOR that path signs its transitions with, not by counting
    // responsibilities carrying a discovery ref. The count answered this only
    // while the signal path was the sole writer of that column; candidate
    // promotion — an explicit owner decision, which is a different thing
    // entirely — now records provenance too, and the proxy started counting it.
    // A test that answers the right question by accident answers a different
    // one the moment anything else fills the column in.
    expect((await query(
      `SELECT COUNT(*) n FROM responsibility_transitions t
         JOIN institutional_responsibilities r ON r.id=t.responsibility_id
        WHERE r.product_id LIKE 'ug_%' AND t.actor_ref LIKE 'intake:signal_event:%'`, [])).rows[0])
      .toMatchObject({ n: 0 });
  });

  it('states the boundary of that generalization instead of implying there is none', async () => {
    // WHAT THE ABSTENTION ABOVE IS AND IS NOT ABOUT.
    //
    // This test used to say the bound was discovery's four SaaS-shaped signal
    // kinds, and demonstrated it by feeding the vet practice a declined-card
    // event so it would be recognised as billing recovery. That framing has
    // been wrong since migration 126, and it flattered the system twice over:
    // it presented the SaaS map as the way in, when nothing in production emits
    // any of those four kinds, and it implied a veterinary practice must
    // disguise itself as a software company to be recognised at all.
    //
    // The real bound is narrower and more honest. Recognition does not key on
    // domain and never did — it keys on the company STATING the kind of
    // obligation, from a closed generic set that names no industry. The corpus
    // above abstains because free-form company evidence is not a statement of
    // obligation, not because a vet practice is unfamiliar.
    const familiar = 'ug_familiar_shape';
    await query('INSERT INTO products (id,name,owner_id) VALUES (?,?,?)',
      [familiar, 'Rowan Veterinary Practice (billing)', OWNER]);

    // The same unfamiliar company IS recognised the moment it says what it
    // owes — in its own words, through the intake production actually has.
    const reported = await reportedObligation(familiar, OWNER,
      { kind: 'revenue_collection', what: 'Collect the fees the practice is still owed' });
    const discovered = await getResponsibility(familiar, reported.responsibilityId);
    expect(discovered).toMatchObject({ state: 'visible', capability: 'billing_recovery' });
    expect(discovered).toMatchObject({ authorityRef: null });
    // Its own words, not a title the institution wrote for it.
    expect(discovered!.title).toBe('Collect the fees the practice is still owed');

    // And there is no second contract beside it. The four SaaS event types were
    // pinned here for as long as they existed, so they could not widen
    // silently; they are deleted now, and their absence is what gets held.
    const contract = (await import('node:fs')).readFileSync(
      new URL('../../src/services/institution/discovery.ts', import.meta.url), 'utf8');
    const admitted = [...contract.matchAll(/^ {2}([a-z_]+): \{ title:/gm)].map((m) => m[1]);
    expect(admitted,
      'a domain-shaped responsibility contract has reappeared beside the generic one')
      .toEqual([]);
  });
});
