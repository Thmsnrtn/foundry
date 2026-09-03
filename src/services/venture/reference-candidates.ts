// =============================================================================
// FOUNDRY — candidates for a search that cannot see
//
// `venture_opportunities` is read by the mandate and written by nothing,
// because Foundry has no market sense and will not invent one. A gate caught
// that and was right to: a surface showing permanent emptiness is worse than an
// absent one.
//
// So the writer is the reference world, doing here what it does everywhere
// else — exercising machinery that has no real input yet, through the
// production path, marked so that nothing it produces can walk out.
//
// WHAT THESE ARE. Four declared candidates that exist to put the CANDIDATE
// DISCIPLINE under load, not to be good ideas:
//
//   one that survives on its own merits and is still wrong for THIS portfolio —
//     a perfectly reasonable subscription business that would deepen every
//     concentration he already has, which is the owner's own example of six
//     income streams that are one
//   one that its own kill thesis destroys — the discipline working as intended
//   one that fails the owner's guidance — steering doing something, visibly
//   one that is differently correlated — the answer to "another conventional
//     SaaS would increase a concentration you already have", which has to be a
//     sentence the institution can follow with something rather than a
//     sophisticated way of saying no
//
// AND THEY CARRY EVIDENCE, not just prose. Each one forms claims about the
// world, files dated observations for and AGAINST them, and raises the unknowns
// that would actually decide it. That machinery is what the owner asked to have
// controlled-proven before any real research source exists: collection,
// provenance, contradiction, unknowns, and a candidate that cannot advance
// because something blocking is unanswered.
//
// They are as fictional as the reference companies and refused a real mandate
// by the same trigger. What is real is what happens to them: the unknowns that
// block advancement, the source requirement, the rejection that is kept with
// its reason.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

interface DeclaredClaim {
  claim: string;
  saw: Array<{
    sourceType: string; source: string; saw: string;
    bearing: 'supports' | 'contradicts'; directness: 'direct' | 'inferred';
    daysAgo: number;
  }>;
}

interface DeclaredCandidate {
  headline: string; whoHasIt: string; theProblem: string; whyItMight: string;
  killThesis: string; unknowns: string[]; sources: string[];
  /** How it would make money, on the axes the portfolio is measured on. */
  exposures: Array<[string, string]>;
  claims?: DeclaredClaim[];
  /** Questions that decide it, and the cheapest thing that would answer each. */
  asks?: Array<{ question: string; blocking: boolean; cheapestTest: string | null }>;
  /** What liability it creates, class by class. */
  surfaces?: Array<{
    cls: string; severity: 'minor' | 'material' | 'serious'; needs: boolean;
    creates: string; known?: string | null; unknown?: string | null;
  }>;
  /** The lighter way of building it, or null when nobody has answered yet. */
  lighter?: string | null;
  /** What carrying it would take, as capability keys with the reason. */
  needs?: Array<[string, string]>;
}

const CANDIDATES: DeclaredCandidate[] = [
  {
    headline: 'Shift handover for independent veterinary practices',
    whoHasIt: 'two-to-six-vet practices that run more than one shift',
    theProblem: 'handover happens on paper and in someone\'s head, and the '
      + 'things that get missed are the ones that hurt an animal',
    whyItMight: 'they already pay for practice management software that does '
      + 'not do this, and the people who feel it are the ones who choose tools',
    killThesis: 'practice management vendors ship this as a feature within a '
      + 'year and it stops being a business',
    unknowns: [
      'whether anyone would pay for it separately from their existing system',
      'how many practices actually run multiple shifts',
      'whether the incumbent is already building it',
    ],
    sources: ['reference-world:declared-candidate'],
    // A PERFECTLY REASONABLE BUSINESS THAT IS WRONG FOR THIS PORTFOLIO.
    // Every one of these is something the reference companies already carry.
    // Nothing here is new ground, which is the point: on its own merits it
    // survives, and adding it would make the portfolio more fragile rather
    // than less.
    exposures: [
      ['revenue_model', 'subscription'],
      ['customer_type', 'small businesses'],
      ['pricing_model', 'per-seat monthly'],
      ['acquisition_channel', 'google search'],
      ['provider_dependency', 'stripe'],
      ['support_burden', 'human support inbox'],
    ],
    claims: [{
      claim: 'Independent veterinary practices will pay separately for handover '
        + 'software rather than wait for their practice management vendor',
      saw: [
        { sourceType: 'community', source: 'reference-world:practice-forum-thread',
          saw: 'eleven practice managers describing handover as the thing that '
            + 'goes wrong most often', bearing: 'supports', directness: 'inferred',
          daysAgo: 40 },
        { sourceType: 'job_posting', source: 'reference-world:incumbent-careers-page',
          saw: 'the largest practice management vendor hiring for a handover and '
            + 'shift-notes team', bearing: 'contradicts', directness: 'direct',
          daysAgo: 12 },
      ],
    }],
    asks: [
      { question: 'whether anyone would pay for it separately from their existing system',
        blocking: true,
        cheapestTest: 'take a price to twenty practice managers and count who asks '
          + 'how to buy it' },
      { question: 'whether the incumbent is already building it', blocking: false,
        cheapestTest: 'read their release notes for the last year' },
    ],
    surfaces: [
      { cls: 'professional_reliance', severity: 'serious', needs: true,
        creates: 'a handover note that a vet might act on as if it were clinical guidance',
        known: 'the tool would record what a person said, not generate advice', unknown: 'whether recording it under the practice\'s name changes who is liable when something is missed' },
      { cls: 'privacy_data', severity: 'material', needs: false,
        creates: 'names of animal owners and treatment notes, held on our servers',
        known: 'owner contact details are personal data wherever the practice is', unknown: null },
    ],
    lighter: 'keep it a structured checklist of what was handed over, never clinical guidance - the practice decides, the tool remembers',
    needs: [
      ['write_code_in_branch', 'somebody has to build it'],
      ['run_tests', 'and know whether it works'],
      ['deploy_production', 'it has to run somewhere practices can reach'],
      ['accept_payment', 'they would be paying monthly'],
      ['answer_support', 'a practice with a broken handover will write in'],
    ],
  },
  {
    headline: 'A dashboard that unifies every tool a small agency uses',
    whoHasIt: 'agencies of five to twenty people',
    theProblem: 'context is scattered across six tools and nobody sees the whole',
    whyItMight: 'everybody complains about it',
    // THE DISCIPLINE WORKING AS INTENDED. Everybody complaining is not demand,
    // and a candidate whose own kill thesis lands should die before it reaches
    // the owner rather than after.
    killThesis: 'this has been built dozens of times and dies every time, '
      + 'because the pain is real and the willingness to change tools is not',
    unknowns: [
      'whether anyone has ever paid for one of these',
      'why the previous attempts died',
    ],
    sources: ['reference-world:declared-candidate'],
    exposures: [
      ['revenue_model', 'subscription'],
      ['customer_type', 'small businesses'],
      ['pricing_model', 'flat monthly'],
      ['acquisition_channel', 'community'],
      ['provider_dependency', 'stripe'],
    ],
    claims: [{
      claim: 'Small agencies will change the tools they work in for a unified view',
      saw: [
        { sourceType: 'review', source: 'reference-world:review-site',
          saw: 'four dead products in this category with the same complaint in '
            + 'their final reviews: nobody moved off the tools they had',
          bearing: 'contradicts', directness: 'direct', daysAgo: 70 },
      ],
    }],
    asks: [
      { question: 'why the previous attempts died', blocking: true,
        cheapestTest: 'find two founders of the dead ones and ask them' },
    ],
    surfaces: [
      { cls: 'platform_policy', severity: 'material', needs: false,
        creates: 'reads six vendors\' data through their APIs, each under terms that can change',
        known: 'two of the six forbid caching their data', unknown: null },
    ],
    lighter: null,
  },
  {
    headline: 'A paid-search arbitrage play for local trades',
    whoHasIt: 'plumbers and electricians without their own marketing',
    theProblem: 'they cannot compete for search traffic on their own',
    whyItMight: 'margins on lead generation are good and the buyers are reachable '
      + 'through paid acquisition on search ads',
    killThesis: 'the channel gets more expensive every year and the whole thing '
      + 'is a bet on arbitrage that closes',
    unknowns: ['whether the arbitrage still exists at all'],
    sources: ['reference-world:declared-candidate'],
    exposures: [
      ['revenue_model', 'lead generation'],
      ['customer_type', 'sole traders'],
      ['acquisition_channel', 'paid acquisition'],
      ['pricing_model', 'per lead'],
    ],
    surfaces: [
      { cls: 'claims_advertising', severity: 'material', needs: false,
        creates: 'adverts on behalf of tradespeople that make claims about their work',
        known: 'the advertiser is us, and the claims would be ours to stand behind', unknown: null },
      { cls: 'consumer_protection', severity: 'material', needs: false,
        creates: 'consumers handed to tradespeople with an implied vetting',
        known: null, unknown: 'whether an implied recommendation carries a duty' },
    ],
    lighter: 'sell the leads to one contractor per area on a flat fee, never on a per-lead claim of quality',
    needs: [
      ['run_paid_experiment', 'the whole thesis is buying attention cheaper than it sells'],
      ['publish_page', 'the leads have to land somewhere'],
    ],
  },
  // THE ANSWER, RATHER THAN A BETTER-ARGUED NO.
  //
  // "Another conventional SaaS would deepen a concentration you already have"
  // is only a useful sentence if the institution can follow it with something.
  // This candidate exists to be that something: it earns in a different way,
  // is reached through a different channel, is paid for differently, and wants
  // almost nothing from him week to week. Its merits are unremarkable on
  // purpose — what makes it interesting is that it fails for different reasons
  // than everything he owns.
  {
    headline: 'A maintained dataset of licence and registration deadlines, sold per download',
    whoHasIt: 'developers and small firms building compliance reminders into '
      + 'their own products',
    theProblem: 'the information is public, scattered across dozens of registers, '
      + 'and out of date within a quarter',
    whyItMight: 'gathering it once and keeping it current is dull work that '
      + 'nobody wants to repeat, and the people who need it are already looking '
      + 'for a file to buy rather than a service to adopt',
    killThesis: 'one register publishes a clean feed and the gathering stops '
      + 'being worth paying for',
    unknowns: [
      'how much of it can be kept current without a person doing it',
      'whether buyers come back, or buy once and never again',
    ],
    sources: ['reference-world:declared-candidate'],
    exposures: [
      ['revenue_model', 'one-off purchase'],
      ['customer_type', 'developers'],
      ['pricing_model', 'per download'],
      ['acquisition_channel', 'data marketplace listing'],
      ['provider_dependency', 'marketplace payouts'],
      ['support_burden', 'almost none'],
    ],
    claims: [{
      claim: 'People are already paying for maintained versions of public data '
        + 'they could gather themselves',
      saw: [
        { sourceType: 'marketplace', source: 'reference-world:data-marketplace',
          saw: 'nine comparable datasets listed, three with visible sales counts '
            + 'above four hundred', bearing: 'supports', directness: 'direct',
          daysAgo: 20 },
        { sourceType: 'community', source: 'reference-world:developer-forum',
          saw: 'repeated questions asking where to buy exactly this rather than '
            + 'how to scrape it', bearing: 'supports', directness: 'inferred',
          daysAgo: 30 },
        { sourceType: 'pricing_page', source: 'reference-world:comparable-vendor',
          saw: 'a comparable dataset priced at a one-off fee with paid quarterly '
            + 'refreshes', bearing: 'supports', directness: 'direct', daysAgo: 25 },
      ],
    }],
    asks: [
      { question: 'whether buyers come back, or buy once and never again',
        blocking: false,
        cheapestTest: 'list one small dataset and watch what the first fifty '
          + 'buyers do next quarter' },
    ],
    // WHAT CARRYING IT WOULD TAKE, so the fabric answers on the card: met,
    // acquirable, missing with a route, or the owner's. One of each, on
    // purpose, so every sentence the fabric can say is exercised.
    needs: [
      ['read_public_dataset', 'to gather the registers'],
      ['keep_dataset_fresh', 'to refresh the deadlines each quarter'],
      ['list_on_marketplace', 'to sell it where buyers already look'],
      ['license_data', 'two registers publish no reuse terms'],
      ['send_email', 'to tell buyers when a refresh lands'],
    ],
    surfaces: [
      { cls: 'licensing', severity: 'material', needs: false,
        creates: 'a dataset derived from public registers whose reuse terms differ',
        known: 'most registers permit reuse with attribution', unknown: 'two registers publish no terms at all' },
      { cls: 'intellectual_property', severity: 'minor', needs: false,
        creates: 'a compiled dataset that others could copy',
        known: 'compilation is what we are selling; copying is a business risk, not a legal one', unknown: null },
    ],
    lighter: 'publish derived deadlines only, never the source records, so nothing personal or licensed is redistributed',
  },
];

/**
 * Put candidates in front of a reference mandate.
 *
 * Idempotent: a mandate that already has candidates is left alone, so the
 * routine that keeps the reference world moving does not accumulate them.
 */
export async function exerciseReferenceMandate(mandateId: string): Promise<number> {
  const mandate = (await query(
    `SELECT id, evidence_mode, founder_id FROM venture_mandates
      WHERE id = ? AND closed_at IS NULL`, [mandateId]))
    .rows[0] as Record<string, unknown> | undefined;
  // Real mandates are never seeded. What Foundry knows about a real market has
  // to come from somewhere it actually looked.
  if (!mandate || String(mandate.evidence_mode) !== 'reference') return 0;

  const already = (await query(
    'SELECT COUNT(*) AS n FROM venture_opportunities WHERE mandate_id = ?', [mandateId]))
    .rows[0] as Record<string, unknown>;
  if (Number(already.n) > 0) return 0;

  const founderId = String(mandate.founder_id);
  // THE REHEARSAL SEARCH CAN SEE, AND SAYS WHAT THROUGH. Without this the page
  // reported "I cannot see the market" directly above four candidates — both
  // halves true of different things, and the pairing read as incoherence.
  const { openTheReferenceEyes } = await import('./research-sources.js');
  await openTheReferenceEyes(founderId);
  const { noteExposure } = await import('../founder/resilience.js');
  const { formClaim, observe, raiseUnknown } = await import('./market-evidence.js');

  for (const candidate of CANDIDATES) {
    const opportunityId = nanoid();
    const diesByItsOwnThesis = candidate.headline.includes('dashboard');
    await query(
      `INSERT INTO venture_opportunities
         (id, mandate_id, founder_id, headline, who_has_it, the_problem,
          why_it_might, kill_thesis, unknowns_json, sources_json, evidence_mode)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'reference')`,
      [opportunityId, mandateId, founderId,
        candidate.headline, candidate.whoHasIt,
        candidate.theProblem, candidate.whyItMight, candidate.killThesis,
        JSON.stringify(candidate.unknowns), JSON.stringify(candidate.sources)]);

    // How it would earn, said in the same vocabulary his companies are
    // described in — which is what lets "what would adding this do" be
    // answered at all.
    for (const [dimension, value] of candidate.exposures) {
      await noteExposure({
        founderId, subjectKind: 'opportunity', subjectId: opportunityId,
        dimension, value, howKnown: 'inferred', evidenceMode: 'reference',
      });
    }

    for (const declared of candidate.claims ?? []) {
      const claimId = await formClaim({
        founderId, claim: declared.claim, opportunityId, evidenceMode: 'reference',
      });
      for (const seen of declared.saw) {
        // Dated backwards from now, because staleness is one of the things the
        // standing of a claim is supposed to notice, and observations that all
        // arrived this second could never demonstrate it.
        const observedAt = new Date(Date.now() - seen.daysAgo * 86_400_000);
        await observe({
          founderId, claimId, sourceType: seen.sourceType, source: seen.source,
          saw: seen.saw, bearing: seen.bearing, directness: seen.directness,
          observedAt, evidenceMode: 'reference',
        });
      }
    }

    // WHAT LIABILITY IT CREATES, recorded before anybody argues its merits -
    // and the lighter-architecture question answered where the reference
    // world has an answer, left open where it does not, so that the block on
    // an unasked question is exercised too.
    const { noteLegalSurface, answerLighter } = await import('./legal-surface.js');
    for (const sf of candidate.surfaces ?? []) {
      await noteLegalSurface({
        founderId, subjectKind: 'opportunity', subjectId: opportunityId,
        cls: sf.cls, severity: sf.severity, needsProfessional: sf.needs,
        whatItCreates: sf.creates, known: sf.known ?? null, unknown: sf.unknown ?? null,
        evidenceMode: 'reference',
      });
    }
    if (candidate.lighter) {
      await answerLighter({ opportunityId, answer: candidate.lighter });
    }
    const { noteNeed } = await import('../institution/capabilities.js');
    for (const [capabilityKey, why] of candidate.needs ?? []) {
      await noteNeed({ founderId, subjectKind: 'opportunity', subjectId: opportunityId,
        capabilityKey, why });
    }

    for (const ask of candidate.asks ?? []) {
      await raiseUnknown({
        founderId, opportunityId, question: ask.question,
        blocking: ask.blocking, cheapestTest: ask.cheapestTest,
      });
    }

    // THE DISCIPLINE BURIES ONE, WITH BOTH QUESTIONS ANSWERED. Rejection was
    // counted and displayed and never once written by live code; the
    // graveyard the institution described had no way to be filled. This is
    // the reference world filling it the way a real search would: the kill
    // thesis landed, here is why, and here is what would change the answer.
    if (diesByItsOwnThesis) {
      const { rejectCandidate } = await import('./mandate.js');
      await rejectCandidate({
        opportunityId, by: 'the candidate discipline',
        why: 'its own kill thesis landed - four dead products in this category '
          + 'with the same complaint in their final reviews',
        revisitIf: 'a platform the agencies already live in opens an integration '
          + 'that makes switching unnecessary',
      });
    }
  }
  return CANDIDATES.length;
}
