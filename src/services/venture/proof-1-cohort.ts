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
//   1. DCAMM certifies contractors in thirty-odd categories of work. None of
//      them is millwork, casework, cabinetry or architectural woodwork. A
//      millwork shop cannot be certified as one, so no state registry lists it.
//   2. The filed sub-bid trades are fixed by M.G.L. c.149 §44F and there are
//      seventeen of them — acoustical tile through terrazzo. Millwork is not
//      among them either, so no shop appears in a filed sub-bid record.
//   3. The Commonwealth's own spending record contains exactly three
//      Massachusetts vendors with "millwork" in the name, and one is a
//      condominium trust. The buyers in this market are municipalities and
//      local housing authorities, and they pay from their own treasuries — not
//      through the state ledger that record is drawn from.
//
// So the shops doing this work are real and numerous, and the public record
// simply does not name them. The fourth door, COMMBUYS' own award and contract
// search, would name them; it redirects to a login, and an authentication
// boundary is not something this institution goes around.
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

export interface CohortMember {
  counterpartyRef: string;
  email: string;
  /** How this address was chosen over the others the business publishes. */
  contactKind: ContactKind;
  contactSource: string;
  /** Why this business is in the population the sealed design names. */
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
    contactKind: 'general',
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
    contactKind: 'general',
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
    contactKind: 'role',
    contactSource: 'the estimating mailbox published on its own site — the route it asks commercial work to come through',
    because: 'Its own completed projects are indexed by sector, and the sectors include Education, Healthcare '
      + 'and Municipality alongside Office/Industrial and Retail. These are projects it has done, not markets '
      + 'it says it serves.',
    source: 'https://woodcraftgroup.com/ (address read there)',
  },
  {
    counterpartyRef: 'STEM Solutions, Wakefield',
    email: 'itb@labfitout.com',
    contactKind: 'role',
    contactSource: 'the invitation-to-bid mailbox published on its own site, chosen over the named estimator it also lists',
    because: 'Its own project highlights name the Phase 1 Walpole High School renovation and the '
      + 'Dennis-Yarmouth Intermediate Middle School — public school casework and fit-out.',
    source: 'https://labfitout.com/ (address read there)',
  },
  {
    counterpartyRef: 'New England Lab, Woburn',
    email: 'info@newenglandlab.com',
    contactKind: 'general',
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
    contactKind: 'role',
    contactSource: 'the address its contact page labels "Invitations To Bid", chosen over the general inbox beside it '
      + 'and over a near-identical singular spelling that appears on its services page',
    because: 'Its own site quotes the Facilities Manager of the J.F.K. Presidential Library & Museum by name '
      + 'about its work — a named public building, and a named client at it.',
    source: 'https://mlmcdonald.com/contact (address read there)',
  },
  {
    counterpartyRef: 'TrimBoard, Springfield',
    email: 'info@trimboard.net',
    contactKind: 'general',
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
    contactKind: 'named',
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
  nearly: number;
} {
  const byContact: Record<ContactKind, number> = { role: 0, named: 0, general: 0 };
  for (const m of PROOF1_COHORT) byContact[m.contactKind] += 1;
  return { total: PROOF1_COHORT.length, byContact, nearly: PROOF1_NEARLY.length };
}
