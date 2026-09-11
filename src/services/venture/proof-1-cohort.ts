// =============================================================================
// FOUNDRY — the cohort, and the reason it is the size it is
//
// The amendment asked for thirty to fifty qualified Massachusetts millwork
// businesses in place of two, because a zero from two carries almost no
// information: it cannot separate a weak proposition from a bad address, or a
// wrong reading of the market from an ordinary quiet week.
//
// EIGHT BUSINESSES MEET THE SEALED STANDARD. Not thirty, and not because the
// search was lazy. The standard was held exactly where Experiment 001 sealed
// it — `proof-1-screening.ts` states it and this file does not move it — and
// the search that ran against it was the largest this institution has done:
// all 739 open COMMBUYS notices read in full, the Comptroller's spending record
// swept by trade, and twenty-one shop websites crawled to depth.
//
// WHY THE NUMBER IS EIGHT, which is a finding about Massachusetts and not about
// the businesses. The sealed standard admits a shop on OBSERVED PUBLIC-SECTOR
// WORK — a named public project in its own public record, or a public payment
// record naming it. For this trade, in this state, that is very nearly
// unobservable by construction, and three independent facts say so:
//
//   1. DCAMM's published categories of work do not name millwork, casework,
//      cabinetry or architectural woodwork among them. That says the registry
//      is not organised around this trade — NOT that such work cannot be done
//      or certified under a broader category, which it plainly can.
//   2. M.G.L. c.149 §44F enumerates named classes of filed sub-bid work and
//      millwork is not among the named ones. The statute also lets an awarding
//      authority require a separate sub-bid for another class of work where it
//      judges that necessary or convenient, so the named list is not a closed
//      set and no inference of the form "millwork can never be filed" follows.
//   3. The Commonwealth's own spending record contains exactly three
//      Massachusetts vendors with "millwork" in the name, and one is a
//      condominium trust. Swept again for "casework" and "cabinet" it yields
//      seven more, and every one fails this design for a reason of its own: a
//      garage-storage installer, a furniture maker, two spellings of one
//      residential distributor, a sales outfit last paid in 2012, and a shop
//      whose site will not answer this environment at all. The buyers in this
//      market are municipalities and local housing authorities, and they pay
//      from their own treasuries — not through the state ledger that record is
//      drawn from.
//
// THE SUPPORTED CONCLUSION IS NARROWER THAN IT FIRST LOOKED, and it is worth
// stating at its real strength rather than its rhetorical one: millwork,
// casework and cabinetry are not clearly represented as named standard
// categories in the public classification surfaces examined, which makes those
// surfaces poor EXHAUSTIVE DISCOVERY MECHANISMS for this market. That is a
// claim about the usefulness of a search method. It is not a claim about how
// public construction law treats the trade, and an earlier draft of this file
// overreached into exactly that.
//
// The fourth door, COMMBUYS' own award and contract search, would name these
// shops; it redirects to a login, and an authentication boundary is not
// something this institution goes around.
//
// THE STANDARD IS ALSO ADVERSELY SELECTED, which the institution noticed when
// it first narrowed the design and is worth repeating here: a shop with a
// visible public-work record is a shop that already finds these notices, and
// therefore needs a screening brief least. Holding the standard costs cohort
// size AND aims at the customers least likely to buy. That is a real cost and
// it is the owner's to weigh, which is why `PROOF1_NEARLY` below is written out
// in full rather than summarised — it is the concrete shape of the alternative,
// not an argument for it.
//
// NOTHING HERE IS PADDED. Every address was READ ON THE BUSINESS'S OWN SITE and
// carries the page it was read from. Not one was guessed from a pattern, and
// where a shop publishes no address this environment can reach, it is absent
// rather than approximated — Old Colony Cabinets and Lannon Millwork are the
// painful cases, both naming institutional work plainly, neither reachable.
// =============================================================================

export type ContactKind = 'role' | 'named' | 'general';

/**
 * WHICH KIND OF EVIDENCE PUT A BUSINESS IN THE POPULATION — and NOT how good
 * the business is, how likely it is to buy, or how much anybody wants it here.
 * Both strata are fully qualified and both get the same offer, at the same
 * price, in the same words, once each.
 */
export type Stratum = 'public_work_observed' | 'commercial_institutional_capable';

export interface CohortMember {
  counterpartyRef: string;
  email: string;
  /** How this address was chosen over the others the business publishes. */
  contactKind: ContactKind;
  contactSource: string;
  /** Which evidence put it in the population. Not a grade. */
  stratum: Stratum;
  /** Why this business is in the population the design names. */
  because: string;
  /** Where both of those can be checked. */
  source: string;
}

/**
 * THE CLOSED COHORT. Eight businesses, each with observed public-sector work,
 * each reachable at an address it published itself.
 *
 * ADDRESS CHOSEN, NEVER DEFAULTED TO. A shop that publishes an estimating,
 * invitation-to-bid or bid-request mailbox has said where commercial approaches
 * belong, and writing to its general inbox instead ignores an instruction it
 * took the trouble to give. Three of the eight say so and are written to there.
 * Where the general inbox genuinely is the best published route, the row says
 * that in as many words rather than dressing it up.
 */
export const PROOF1_COHORT: CohortMember[] = [
  {
    counterpartyRef: 'General Woodworking, Lowell',
    email: 'info@genwood.com',
    contactKind: 'general', stratum: 'public_work_observed',
    contactSource: 'the only address published on its own site — no estimating or bid mailbox is offered',
    because: 'Its own project gallery names Henry K. Oliver School (Lawrence), Tyngsborough Middle School, '
      + 'Cabot Elementary School and Stoughton High School, and it lists AWI QCP accreditation. The '
      + "Comptroller's spending record independently shows a payment from the University of Massachusetts "
      + 'system in FY2018.',
    source: 'https://genwood.com/ (address read there) and CTHRU dataset pegc-naaa, vendor like %GENERAL WOODWORKING%',
  },
  {
    counterpartyRef: 'Continental Woodcraft, Worcester',
    email: 'info@continentalwoodcraft.com',
    contactKind: 'general', stratum: 'public_work_observed',
    contactSource: 'the only address published on its own site; its bid route is a web form, which this test does not use',
    because: 'Its own project list names Wareham Elementary School, Shrewsbury Police Station, Malden City '
      + 'Hall and Worcester State University under Education and Municipality headings, and the site says the '
      + 'shop is "well-versed in the bidding process for your retail, healthcare, education, government, or '
      + 'municipality project". The Comptroller\'s record independently shows a $6,167.70 payment from '
      + "Worcester Sheriff's Department in FY2022.",
    source: 'https://continentalwoodcraft.com/ (address read there) and CTHRU dataset pegc-naaa, vendor like %CONTINENTAL WOODCRAFT%',
  },
  {
    counterpartyRef: 'Woodcraft Millwork, Canton',
    email: 'estimating@woodcraftgroup.com',
    contactKind: 'role', stratum: 'public_work_observed',
    contactSource: 'the estimating mailbox published on its own site — the route it asks commercial work to come through',
    because: 'Its own completed projects are indexed by sector, and the sectors include Education, Healthcare '
      + 'and Municipality alongside Office/Industrial and Retail. These are projects it has done, not markets '
      + 'it says it serves.',
    source: 'https://woodcraftgroup.com/ (address read there)',
  },
  {
    counterpartyRef: 'STEM Solutions, Wakefield',
    email: 'itb@labfitout.com',
    contactKind: 'role', stratum: 'public_work_observed',
    contactSource: 'the invitation-to-bid mailbox published on its own site, chosen over the named estimator it also lists',
    because: 'Its own project highlights name the Phase 1 Walpole High School renovation and the '
      + 'Dennis-Yarmouth Intermediate Middle School — public school casework and fit-out.',
    source: 'https://labfitout.com/ (address read there)',
  },
  {
    counterpartyRef: 'New England Lab, Woburn',
    email: 'info@newenglandlab.com',
    contactKind: 'general', stratum: 'public_work_observed',
    contactSource: 'the address published on its own contact page; its bid route is a quote request form, which this test does not use',
    because: 'Its own portfolio is indexed by industry and the industries include government, private K-12, '
      + "university teaching and university research. The Comptroller's record independently shows $72,993 "
      + 'across thirteen payments from eight state bodies between 2014 and 2023 — Bridgewater State '
      + 'University, DCAMM itself, the Department of Environmental Protection, MassDOT and the Norfolk '
      + "Sheriff's Department among them. It is the most heavily evidenced business in this cohort.",
    source: 'https://newenglandlab.com/contact/index.cfm (address read there) and CTHRU dataset pegc-naaa, '
      + 'vendor like %NEW ENGLAND LABORATORY CASEWORK%',
  },
  {
    counterpartyRef: 'M.L. McDonald, Watertown',
    email: 'bidrequests@mlmcdonald.com',
    contactKind: 'role', stratum: 'public_work_observed',
    contactSource: 'the address its contact page labels "Invitations To Bid", chosen over the general inbox beside it '
      + 'and over a near-identical singular spelling that appears on its services page',
    because: 'Its own site quotes the Facilities Manager of the J.F.K. Presidential Library & Museum by name '
      + 'about its work — a named public building, and a named client at it.',
    source: 'https://mlmcdonald.com/contact (address read there)',
  },
  {
    counterpartyRef: 'TrimBoard, Springfield',
    email: 'info@trimboard.net',
    contactKind: 'general', stratum: 'public_work_observed',
    contactSource: 'the only address published across its site, where it appears six times',
    because: 'Its own site names the Centerville Public Library among completed projects and describes work '
      + 'for institutional buildings, including replicating classical moulding profiles for a university '
      + 'building. It was recorded as an unevidenced trim supplier in the first screening; this is new '
      + 'evidence found by a deeper read of the same public site, not a relaxed standard.',
    source: 'https://trimboard.net/ (address read there)',
  },
  {
    counterpartyRef: 'South Shore Millwork, Norton',
    email: 'thamlin@southshoremillwork.com',
    contactKind: 'named', stratum: 'public_work_observed',
    contactSource: 'the named contact published on its own site; no estimating or bid mailbox is published',
    because: "The Comptroller's spending record shows $51,148 across six payments from the Plymouth District "
      + 'Attorney and the Department of Workforce Development between 2010 and 2021 — a sustained public '
      + 'relationship rather than a single transaction. Its own site shows corporate, hospitality and '
      + 'historical restoration millwork.',
    source: 'https://southshoremillwork.com/ (address read there) and CTHRU dataset pegc-naaa, vendor like %SOUTH SHORE MILLWORK%',
  },
];

/**
 * WHAT HOLDING THE STANDARD COSTS, named rather than summarised.
 *
 * Each of these is a Massachusetts millwork or cabinet shop, reachable at an
 * address it published itself, whose own site shows commercial or institutional
 * work — and none of which clears the sealed standard, because the work it
 * shows is either described rather than named, or named but not public.
 *
 * This list is NOT a reserve to be drawn on if eight feels small. Admitting it
 * would be an amendment to the sealed population, which is the owner's act and
 * nobody else's. It is written out so that if he makes that amendment he is
 * choosing a known set of businesses rather than authorising a direction.
 */
export interface NearMiss {
  counterpartyRef: string;
  email: string;
  contactKind: ContactKind;
  /** What its own site does show. */
  shows: string;
  /** The precise reason that is not enough under the sealed standard. */
  shortOf: string;
}

export const PROOF1_NEARLY: NearMiss[] = [
  {
    counterpartyRef: 'Salem Architectural Woodworking, Gloucester',
    email: 'pguido@salemwoodworking.net',
    contactKind: 'named',
    shows: 'Gordon College work, with the college\'s Gallery Director quoted by name about it.',
    shortOf: 'Gordon College is a private college. The project is named and institutional, but it is not public work.',
  },
  {
    counterpartyRef: 'Camio Custom Cabinetry, Canton',
    email: 'chris@camiocabinetry.com',
    contactKind: 'named',
    shows: 'a statement that it has supplied colleges, schools, corporate offices and medical centres, and that '
      + 'it works to the timelines of general contractors.',
    shortOf: 'Sectors described, no project named. This is the same evidence the first screening rejected Salem for, '
      + 'and it is rejected here for the same reason.',
  },
  {
    counterpartyRef: 'Kitchen Encounters, Wilbraham',
    email: 'info@kitchen-encounters.com',
    contactKind: 'general',
    shows: 'a Custom Commercial Millwork page naming assisted living facilities, doctor and dental offices, banks, '
      + 'universities and colleges, and courthouses as the work it does.',
    shortOf: 'Courthouses and colleges are listed as categories of work, not as projects it can point to.',
  },
  {
    counterpartyRef: 'RGC Millwork, Lowell',
    email: 'sales@rgcmillwork.com',
    contactKind: 'role',
    shows: 'hospitals, lab casework, biotech, dental offices, reception areas, lobbies and education among its '
      + 'stated specialities.',
    shortOf: 'Specialities stated, no project named, no payment record.',
  },
  {
    counterpartyRef: 'Classic Millwork Design, Webster',
    email: 'contact@classicmillworkdesign.com',
    contactKind: 'general',
    shows: 'typical clients given as hospitals, schools, retirement facilities and rehabilitation centres.',
    shortOf: 'Typical clients are not named clients.',
  },
  {
    counterpartyRef: 'Grain Architectural Millwork, East Boston',
    email: 'brandon@grainarchitecturalmillwork.com',
    contactKind: 'named',
    shows: 'a commercial portfolio across corporate, hospitality, retail and multi-family millwork.',
    shortOf: 'Genuinely commercial millwork, and not one public or institutional project anywhere on the site.',
  },
  {
    counterpartyRef: 'Quality Design Cabinet, Boston',
    email: 'contact@qualitydesigncabinet.com',
    contactKind: 'general',
    shows: 'custom tenant cabinetry for a twelve-storey Boston commercial development and hospitality suites on '
      + 'Beacon Hill.',
    shortOf: 'Named projects, all of them private.',
  },
  {
    counterpartyRef: 'Marino Custom Display Woodworking, Topsfield',
    email: 'charlie@marinowoodworking.com',
    contactKind: 'named',
    shows: 'a payment from the Supreme Judicial Court in FY2015 in the Comptroller\'s record.',
    shortOf: 'Public work, but the trade is display and fixture woodworking rather than building casework. It fails '
      + 'the population on trade, not on public work — the opposite of everyone else on this list.',
  },
];

/** What the owner is told the cohort is, without having to count rows. */
export function cohortSummary(): {
  total: number;
  byContact: Record<ContactKind, number>;
  byStratum: Record<Stratum, number>;
  nearly: number;
} {
  const byContact: Record<ContactKind, number> = { role: 0, named: 0, general: 0 };
  const byStratum: Record<Stratum, number> = { public_work_observed: 0, commercial_institutional_capable: 0 };
  for (const m of PROOF1_COHORT) { byContact[m.contactKind] += 1; byStratum[m.stratum] += 1; }
  return { total: PROOF1_COHORT.length, byContact, byStratum, nearly: PROOF1_NEARLY.length };
}

/**
 * SEAL THE COHORT ONTO THE TEST. Idempotent in every part: a business already
 * present is not added twice, a qualification already written stands, and an
 * address whose kind is already recorded keeps it.
 *
 * THE OWNER'S EXCLUSIONS ARE APPLIED FIRST, by `addRecipients`, which asks
 * before it writes. So a business he has said never to is absent from the
 * cohort rather than present and filtered later — and this returns what was
 * dropped and why, because a cohort that is one smaller for a reason he chose
 * should say so rather than look like a miscount.
 *
 * NOTHING HERE APPROVES ANYBODY. Qualification is the institution's observation
 * that a business belongs to the population the design named. Approval is the
 * owner's act, it happens on the decision surface, and it is the only thing
 * that lets a message leave.
 */
export async function applyProof1Cohort(founderId: string): Promise<{
  added: number;
  qualified: string[];
  alreadyQualified: string[];
  addressed: string[];
  excluded: Array<{ who: string; entity: string; matched: string }>;
  notFound: string[];
}> {
  const { findProof1 } = await import('./proof-1.js');
  const { addRecipients, qualifyRecipient, recipientsOf, recordContactChoice } = await import('./hand.js');
  const { applyStandingExclusions } = await import('../institution/owner-exclusions.js');
  const experimentId = await findProof1(founderId);
  if (!experimentId) throw new Error('experiment_001_not_found');

  // THE OWNER'S BOUNDARIES BEFORE THE COHORT, not alongside it. Applying them
  // here rather than trusting whoever calls this means a business he has
  // excluded cannot enter a cohort assembled on a machine that had not heard
  // of the exclusion yet.
  await applyStandingExclusions(founderId);

  const { excluded } = await addRecipients({
    founderId,
    experimentId,
    recipients: PROOF1_COHORT.map((m) => ({
      counterpartyRef: m.counterpartyRef, email: m.email, channel: 'email' as const, sourceUrl: m.source,
    })),
  });

  const rows = await recipientsOf(experimentId);
  const qualified: string[] = []; const alreadyQualified: string[] = [];
  const addressed: string[] = []; const notFound: string[] = [];
  for (const m of PROOF1_COHORT) {
    if (excluded.some((x) => x.who === m.counterpartyRef.trim())) continue;
    const r = rows.find((x) => x.counterpartyRef === m.counterpartyRef);
    if (!r) { notFound.push(m.counterpartyRef); continue; }
    if (r.qualifiedAt) alreadyQualified.push(m.counterpartyRef);
    else {
      await qualifyRecipient({
        founderId, experimentId, recipientId: r.id, because: m.because, source: m.source,
      });
      qualified.push(m.counterpartyRef);
    }
    try {
      await recordContactChoice({
        founderId, experimentId, recipientId: r.id, kind: m.contactKind, source: m.contactSource,
      });
      addressed.push(m.counterpartyRef);
    } catch { /* already recorded: the first answer stands, which is the rule */ }
  }
  return { added: PROOF1_COHORT.length - excluded.length - notFound.length, qualified, alreadyQualified, addressed, excluded, notFound };
}

/**
 * MAKE THE PREDICTION MATCH THE COHORT THAT WILL ACTUALLY BE WRITTEN TO.
 *
 * The sealed question was written for a cohort of twenty-five and says the
 * test fails when "twenty-five businesses receive the offer and none pays".
 * Against a cohort of eight that sentence describes a thing that cannot
 * happen, and an unfalsifiable prediction is worse than a wrong one — it
 * would leave the test settling only on the clock while appearing to have a
 * second, stricter condition it could never meet.
 *
 * SO THE CEILING MOVES TO THE COHORT AND NOTHING ELSE MOVES. Same price, same
 * seven days, same one-payment bar, same $100 ceiling. This is the prediction
 * saying out loud how many businesses there are; it is not a softer test.
 *
 * The database seals a prediction the moment the owner decides, so this
 * refuses outright on a decided test rather than trying and being refused —
 * the rewrite belongs before his decision or not at all.
 */
export async function amendProof1ForTheCohort(founderId: string): Promise<{
  amended: boolean; cohort: number; was: string; now: string; because: string;
}> {
  const { query } = await import('../../db/client.js');
  const { findProof1 } = await import('./proof-1.js');
  const experimentId = await findProof1(founderId);
  if (!experimentId) throw new Error('experiment_001_not_found');

  const e = (await query(
    `SELECT decision, what_we_expect, would_disprove, settles_when
       FROM venture_experiments WHERE id = ?`, [experimentId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!e) throw new Error('experiment_001_not_found');
  if (e.decision != null) {
    return {
      amended: false, cohort: 0, was: String(e.would_disprove), now: String(e.would_disprove),
      because: 'the test is already decided, and a decided prediction is sealed',
    };
  }

  // The cohort as the database has it, not as this file hopes it is.
  const n = Number((await query(
    `SELECT count(*) AS n FROM experiment_recipients
      WHERE experiment_id = ? AND qualified_at IS NOT NULL AND review_status <> 'struck'
        AND channel = 'email' AND email IS NOT NULL`, [experimentId])).rows[0]?.n ?? 0);
  if (n === 0) {
    return {
      amended: false, cohort: 0, was: String(e.would_disprove), now: String(e.would_disprove),
      because: 'no business is qualified yet, so there is no cohort for the prediction to match',
    };
  }

  const expect = `At least one business pays $29 and receives the brief before all ${n} have received `
    + 'the offer, within seven days of the offer being placed';
  const disprove = `All ${n} businesses receive the offer and none pays and receives the brief, or seven `
    + 'days pass without one; a refunded or undelivered purchase does not count';
  const { settlementRuleJson } = await import('./outcome.js');
  const rule = settlementRuleJson({ event: 'delivery', atLeast: 1, outOf: 'offer_delivered', atMost: n, withinDays: 7 });

  const was = String(e.would_disprove);
  await query(
    `UPDATE venture_experiments SET what_we_expect = ?, would_disprove = ?, settles_when = ?
      WHERE id = ? AND decision IS NULL`,
    [expect, disprove, rule, experimentId]);
  return {
    amended: true, cohort: n, was, now: disprove,
    because: 'the ceiling now names the cohort that exists; price, window, bar and spend limit are unchanged',
  };
}
