// =============================================================================
// WHO ACTUALLY BELONGS TO THE POPULATION EXPERIMENT 001 NAMES.
//
// The design says this test is for shops with OBSERVED PUBLIC-SECTOR WORK —
// named public projects in their own public record, or a public award or
// payment record naming them. Deliberately not "present in COMMBUYS": that
// would select for shops already watching the source, who therefore already
// receive these notices and need a screening brief least, and the vendor
// directory refuses automated queries in any case. `planOffer` refuses anyone
// without a recorded, sourced reason, and this is where the reasons come from.
//
// EVERY LINE BELOW IS AN OBSERVATION, NOT A JUDGEMENT ABOUT A BUSINESS. It
// records what a named public page or public record said on the date given,
// and where to go to check it. A shop is rejected here only in the sense that
// the evidence required by THIS design was not found for it — which is a
// statement about what could be observed, never about the quality of the shop.
//
// Two sources were used, both public and both free, and neither involved
// contacting anyone:
//
//   1. The business's own public site, read for named public or institutional
//      projects — schools, city halls, police stations, state universities —
//      and for explicit statements about bidding public work.
//   2. The Comptroller of the Commonwealth's spending record (CTHRU dataset
//      `pegc-naaa`), searched for the business as a paid vendor.
//
// A hit in the payment record alone is deliberately NOT enough. It shows a
// state entity once paid the business; it does not show the business pursues
// the kind of advertised public solicitation this brief is built from. Both
// businesses below carry named public projects on their own sites AND a
// payment record, which is why they are the only two that qualify.
// =============================================================================

export interface Screening {
  counterpartyRef: string;
  verdict: 'qualifies' | 'rejected';
  because: string;
  source: string;
}

/** Observed 2026-09-09. */
export const PROOF1_SCREENING: Screening[] = [
  {
    counterpartyRef: 'Continental Woodcraft, Worcester',
    verdict: 'qualifies',
    because: 'Its own project list names Shrewsbury Police Station, Malden City Hall and Worcester State University, '
      + 'and the site states the shop is "well-versed in the bidding process for your retail, healthcare, education, '
      + 'government, or municipality project" and carries a "Submit Bid Invite" form. The Comptroller\'s spending '
      + 'record independently shows a $6,167.70 payment from Worcester Sheriff\'s Department in FY2022.',
    source: 'https://www.continentalwoodcraft.com/ and https://cthru.data.socrata.com/resource/pegc-naaa.json?$where=upper(vendor)%20like%20%27%25CONTINENTAL%20WOODCRAFT%25%27',
  },
  {
    counterpartyRef: 'General Woodworking, Lowell',
    verdict: 'qualifies',
    because: 'Its own project gallery names Henry K. Oliver School (Lawrence), Tyngsborough Middle School, Cabot '
      + 'Elementary School and Stoughton High School — public school work is the market this brief serves. The '
      + 'Comptroller\'s spending record independently shows a payment from the University of Massachusetts system '
      + 'in FY2018.',
    source: 'https://www.genwood.com/ and https://cthru.data.socrata.com/resource/pegc-naaa.json?$where=upper(vendor)%20like%20%27%25GENERAL%20WOODWORKING%25%27',
  },

  // ── Looked promising and did not survive reading ───────────────────────────
  {
    counterpartyRef: 'Salem Architectural Woodworking, LLC, Gloucester',
    verdict: 'rejected',
    because: 'The site says it serves "a commercial / institutional organization", but names no public project and '
      + 'describes no bidding. General marketing language about market segments is the same weak inference this '
      + 'design was narrowed to remove. No payment record found.',
    source: 'http://salemwoodworking.net/',
  },
  {
    counterpartyRef: 'Specialty Millwork Inc., Fall River',
    verdict: 'rejected',
    because: 'The only match was "state of the art CNC machine" — a phrase about equipment, not about public work. '
      + 'No named public project, no bidding language, no payment record.',
    source: 'https://specialtymillwork.com/',
  },
  {
    counterpartyRef: 'New England Cabinetry & Millwork, Marlborough',
    verdict: 'rejected',
    because: 'The only match was a "Resource Library" navigation link, not a library project. The site is a '
      + 'cabinetry showroom offering catalogues. No public project, no bidding language, no payment record.',
    source: 'https://necabinetry.com/',
  },
  {
    counterpartyRef: 'SBS OneSource Custom Millwork, Harwich (borderline: building-supply company)',
    verdict: 'rejected',
    because: 'The match was "municipal construction markets" describing a PVC moulding product line, not work the '
      + 'company bids for. It was already recorded as a building-supply company rather than a millwork shop.',
    source: 'https://sbsonesource.com/builders/custom-millwork/',
  },
];

/**
 * The seventeen remaining candidates. Their public sites evidenced residential
 * work, or generic "commercial" work, or carried no project record at all, and
 * none appears in the Comptroller's spending record. Nothing was found either
 * way about whether they bid public work — which under this design means they
 * cannot be written to, not that they do not.
 */
export const PROOF1_UNEVIDENCED: string[] = [
  'Quality Design Cabinet, Boston',
  'Mass Cabinets, Inc., Methuen',
  'CMD Cabinetry, Walpole',
  'RGC Millwork, Lowell',
  'Deerfield Cabinets & Millwork, Greenfield',
  'Westek Architectural Woodworking, South Hadley',
  'Grain Architectural Millwork, East Boston',
  'Hamel Woodworks, Hyannis',
  'Toby Leary Fine Woodworking, Cape Cod',
  'Master Millwork, Massachusetts',
  'Classic Millwork Design, Webster',
  'FabWright Origins, Brookline',
  'Mass Millworks, Massachusetts',
  'ML Custom Millwork and Cabinetry, Massachusetts',
  'New England Custom Cabinetry, Plainville',
  'Architectural Casework & Millwork, Inc., Gloucester',
  'TrimBoard, Springfield (borderline: trim and moulding supplier)',
];

/**
 * APPLY THE SCREENING. Records a qualification for each business the evidence
 * supports and leaves every other candidate exactly as it was — unqualified,
 * and therefore unreachable by the door, which is the point. Idempotent: a
 * qualification already written stands, and re-running changes nothing.
 */
export async function applyProof1Screening(founderId: string): Promise<{
  qualified: string[]; alreadyQualified: string[]; rejected: number; unevidenced: number; notFound: string[];
}> {
  const { findProof1 } = await import('./proof-1.js');
  const { qualifyRecipient, recipientsOf } = await import('./hand.js');
  const experimentId = await findProof1(founderId);
  if (!experimentId) throw new Error('experiment_001_not_found');
  const recipients = await recipientsOf(experimentId);
  const qualified: string[] = []; const alreadyQualified: string[] = []; const notFound: string[] = [];
  for (const s of PROOF1_SCREENING.filter((x) => x.verdict === 'qualifies')) {
    const r = recipients.find((x) => x.counterpartyRef === s.counterpartyRef);
    if (!r) { notFound.push(s.counterpartyRef); continue; }
    if (r.qualifiedAt) { alreadyQualified.push(s.counterpartyRef); continue; }
    await qualifyRecipient({ founderId, experimentId, recipientId: r.id, because: s.because, source: s.source });
    qualified.push(s.counterpartyRef);
  }
  return {
    qualified, alreadyQualified, notFound,
    rejected: PROOF1_SCREENING.filter((x) => x.verdict === 'rejected').length,
    unevidenced: PROOF1_UNEVIDENCED.length,
  };
}
