// =============================================================================
// FOUNDRY — the cohort, and the reason it is the size it is
//
// The first design of this experiment reached two businesses. The second held a
// population that required OBSERVED PUBLIC-SECTOR WORK and reached eight. The
// owner then corrected the population itself, and he was right to: requiring a
// visible public-work history selects for shops that already know how to find
// these notices and therefore need a screening brief least. The criterion was
// not too loose. It was aimed at the wrong end of the market.
//
// SO THE QUESTION IS NOW WHETHER THE SHOP COULD DO THE WORK, and prior public
// work is kept as an observation rather than a gate. A business is here if it
// is a Massachusetts business in the trade — commercial or institutional
// millwork, cabinetry, casework, architectural woodwork, countertops or closely
// related contract work — with capability the notices in this edition would
// actually call for, and a legitimate public business address to write to.
//
// TWENTY-ONE. Not thirty to fifty, and not because the search was thin: this is
// the largest search this institution has run. All 739 open COMMBUYS notices
// read in full; the Comptroller's spending record swept by trade; a contractor
// directory mined across eleven metros; 143 businesses crawled; every candidate
// checked for a street address in Massachusetts rather than assumed to be here.
//
// THE BINDING CONSTRAINT IS NOT EVIDENCE ANY MORE — IT IS THE ADDRESS. Under
// the corrected population almost nothing is turned away for weak grounds. What
// turns businesses away is that they publish no email at all. Old Colony
// Cabinets names William James College and Cape Cod Hospital and offers a
// contact form; Mass Cabinets, CMD, FabWright and Caliper the same;
// Metropolitan publishes thirty addresses and every one is a residential
// kitchen designer. `PROOF1_NEARLY` names them, because a cohort that is
// twenty-one rather than thirty for a reason should say the reason out loud.
//
// WHAT THE SEARCH COST IN CORRECTIONS, kept here because they were the kind of
// mistake that would otherwise have reached a stranger:
//   · Millcraft Cabinetry is in Connecticut. It sat in an early draft of this
//     list on an assumption nobody had checked.
//   · Lannon Millwork is in Menomonee Falls, Wisconsin.
//   · CCW Inc is in Waterloo, Ontario.
//   · A national contractor directory listed firms from Tulsa, Oregon,
//     Missouri, Kansas and the United Kingdom against Massachusetts metro
//     pages. Of 111 businesses it produced, four were new, in state and
//     reachable.
// None of these are Massachusetts businesses and none of them is in the cohort.
//
// NOTHING HERE IS PADDED. Every address below was READ ON THE BUSINESS'S OWN
// SITE and carries the page it was read from. Not one was guessed from a
// pattern. Where a shop publishes several addresses and states no role against
// any of them, it is absent rather than approximated — choosing between four
// unlabelled staff mailboxes is a guess wearing a decision's clothes.
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
 * THE CLOSED COHORT. Twenty-one Massachusetts businesses in the trade, each
 * reachable at an address it published itself, in two strata that are not
 * grades: ten with public or institutional work observed in a public record,
 * eleven with commercial or institutional capability and no public-work record
 * found. Both get the same offer, at the same price, in the same words, once.
 *
 * ADDRESS CHOSEN, NEVER DEFAULTED TO. A shop that publishes an estimating,
 * invitation-to-bid or bid-request mailbox has said where commercial approaches
 * belong, and writing to its general inbox instead ignores an instruction it
 * took the trouble to give. Eight of the twenty-one say so and are written to
 * there; four publish a named person and no role mailbox; nine publish only a
 * general inbox, and the row says so in as many words rather than dressing it up.
 */
export const PROOF1_COHORT: CohortMember[] = [
  // ── Public or institutional work observed in a public record ──────────────
  {
    counterpartyRef: 'General Woodworking, Lowell',
    email: 'info@genwood.com', contactKind: 'general', stratum: 'public_work_observed',
    contactSource: 'the only address published on its own site — no estimating or bid mailbox is offered',
    because: 'Its own project gallery names Henry K. Oliver School (Lawrence), Tyngsborough Middle School, '
      + 'Cabot Elementary School and Stoughton High School, and it lists AWI QCP accreditation. The '
      + "Comptroller's record independently shows a payment from the University of Massachusetts system.",
    source: 'https://genwood.com/ and CTHRU dataset pegc-naaa, vendor like %GENERAL WOODWORKING%',
  },
  {
    counterpartyRef: 'Continental Woodcraft, Worcester',
    email: 'info@continentalwoodcraft.com', contactKind: 'general', stratum: 'public_work_observed',
    contactSource: 'the only address published on its own site; its bid route is a web form, which this test does not use',
    because: 'Its own project list names Wareham Elementary School, Shrewsbury Police Station, Malden City '
      + 'Hall and Worcester State University, and the site says the shop is "well-versed in the bidding '
      + 'process for your retail, healthcare, education, government, or municipality project". The '
      + "Comptroller's record shows a $6,167.70 payment from Worcester Sheriff's Department in FY2022.",
    source: 'https://continentalwoodcraft.com/ and CTHRU dataset pegc-naaa, vendor like %CONTINENTAL WOODCRAFT%',
  },
  {
    counterpartyRef: 'Woodcraft Millwork, Canton',
    email: 'estimating@woodcraftgroup.com', contactKind: 'role', stratum: 'public_work_observed',
    contactSource: 'the estimating mailbox published on its own site — the route it asks commercial work to come through',
    because: 'Its own completed projects are indexed by sector and the sectors include Education, Healthcare '
      + 'and Municipality. These are projects it has done, not markets it says it serves.',
    source: 'https://woodcraftgroup.com/',
  },
  {
    counterpartyRef: 'STEM Solutions, Wakefield',
    email: 'itb@labfitout.com', contactKind: 'role', stratum: 'public_work_observed',
    contactSource: 'the invitation-to-bid mailbox published on its own site, chosen over the named estimator it also lists',
    because: 'Its own project highlights name the Phase 1 Walpole High School renovation and the '
      + 'Dennis-Yarmouth Intermediate Middle School — public school casework and fit-out.',
    source: 'https://labfitout.com/',
  },
  {
    counterpartyRef: 'New England Lab, Woburn',
    email: 'info@newenglandlab.com', contactKind: 'general', stratum: 'public_work_observed',
    contactSource: 'the address published on its own contact page; its bid route is a quote form, which this test does not use',
    because: 'Its own portfolio is indexed by industry and the industries include government, private K-12 '
      + "and university research. The Comptroller's record shows $72,993 across thirteen payments from "
      + 'eight state bodies between 2014 and 2023 — Bridgewater State University, DCAMM itself, the '
      + 'Department of Environmental Protection and MassDOT among them.',
    source: 'https://newenglandlab.com/contact/index.cfm and CTHRU pegc-naaa, vendor like %NEW ENGLAND LABORATORY CASEWORK%',
  },
  {
    counterpartyRef: 'M.L. McDonald, Watertown',
    email: 'bidrequests@mlmcdonald.com', contactKind: 'role', stratum: 'public_work_observed',
    contactSource: 'the address its contact page labels "Invitations To Bid", chosen over the general inbox beside it '
      + 'and over a near-identical singular spelling on its services page',
    because: 'Its own site quotes the Facilities Manager of the J.F.K. Presidential Library & Museum by name '
      + 'about its work — a named public building, and a named client at it.',
    source: 'https://mlmcdonald.com/contact',
  },
  {
    counterpartyRef: 'TrimBoard, Springfield',
    email: 'info@trimboard.net', contactKind: 'general', stratum: 'public_work_observed',
    contactSource: 'the only address published across its site, where it appears six times',
    because: 'Its own site names the Centerville Public Library among completed projects and describes work '
      + 'for institutional buildings, including replicating classical moulding profiles for a university '
      + 'building.',
    source: 'https://trimboard.net/',
  },
  {
    counterpartyRef: 'South Shore Millwork, Norton',
    email: 'thamlin@southshoremillwork.com', contactKind: 'named', stratum: 'public_work_observed',
    contactSource: 'the named contact published on its own site; no estimating or bid mailbox is published',
    because: "The Comptroller's record shows $51,148 across six payments from the Plymouth District Attorney "
      + 'and the Department of Workforce Development between 2010 and 2021 — a sustained public '
      + 'relationship rather than a single transaction. Its own site shows corporate, hospitality and '
      + 'historical restoration millwork.',
    source: 'https://southshoremillwork.com/ and CTHRU pegc-naaa, vendor like %SOUTH SHORE MILLWORK%',
  },
  {
    counterpartyRef: 'Classic Millwork Design, Webster',
    email: 'contact@classicmillworkdesign.com', contactKind: 'general', stratum: 'public_work_observed',
    contactSource: 'the address published on its own site; no estimating mailbox is offered',
    because: 'Its own portfolio names Ashland Public Library, East Longmeadow Public Library, Boston College '
      + 'and Dana-Farber/Milford Hospital, and its stated client list includes government facilities and '
      + 'military facilities. It works from a 17,500 square foot manufacturing facility in Webster. An '
      + 'earlier screening recorded it as unevidenced on a shallower read of the same public site.',
    source: 'https://www.classicmillworkdesign.com/',
  },
  {
    counterpartyRef: 'Norfolk Kitchen & Bath, Norwood',
    email: 'info@mynkb.com', contactKind: 'general', stratum: 'public_work_observed',
    contactSource: 'the address published on its own site for its contractor and trade business',
    because: 'Its own site says it supplies cabinetry, countertops and property maintenance supplies to '
      + 'general contractors, property managers and HOUSING AUTHORITIES across New England, and it runs a '
      + 'commercial countertop and casework factory. Housing authorities are the buyers most of this '
      + "edition's notices come from.",
    source: 'https://www.norfolkkitchenandbath.com/contractors-remodelers/our-factory/',
  },

  // ── Commercial or institutional capability, no public-work record found ───
  {
    counterpartyRef: 'Integrated At Work, Boston',
    email: 'estimating@integratedatwork.com', contactKind: 'role', stratum: 'commercial_institutional_capable',
    contactSource: 'the estimating mailbox published on its own site, chosen over the general and sales inboxes beside it',
    because: 'Its own site calls it "a premier specialty contractor providing interior architectural products '
      + 'and engineered solutions for commercial projects throughout New England" and lists Casework & '
      + 'Cabinetry among its interior product lines. Its named clients are corporate rather than public.',
    source: 'https://www.integratedatwork.com/products',
  },
  {
    counterpartyRef: 'Specialty Millwork Inc., Fall River',
    email: 'estimating.specialtymillwork@gmail.com', contactKind: 'role', stratum: 'commercial_institutional_capable',
    contactSource: 'the estimating address published on its own site beside its Fall River address',
    because: 'Its own site says the shop employs nine skilled tradespeople on Pocasset Street in Fall River '
      + 'and offers "everything from custom stairs to full renovations of kitchens and all commercial '
      + 'architectural millwork", with commercial desks and retail displays among its listed work.',
    source: 'https://specialtymillwork.com/',
  },
  {
    counterpartyRef: 'New England Cabinetry & Millwork, Marlborough',
    email: 'sales@necabinetry.com', contactKind: 'role', stratum: 'commercial_institutional_capable',
    contactSource: 'the sales mailbox published on its own site, which is the route it offers for trade enquiries',
    because: 'Its own site says it works "from elegant residential designs to sophisticated commercial '
      + 'spaces", and it operates from a Lincoln Street address in Marlborough. No public project is named.',
    source: 'https://necabinetry.com/',
  },
  {
    counterpartyRef: 'RGC Millwork, Lowell',
    email: 'sales@rgcmillwork.com', contactKind: 'role', stratum: 'commercial_institutional_capable',
    contactSource: 'the sales mailbox published on its own site, alongside a named principal',
    because: 'Its own site lists hospitals, lab casework, biotech and medtech, dental offices, reception '
      + 'areas, lobbies and education among the work it specialises in. These are stated specialities '
      + 'rather than named projects, which is why it sits in this stratum.',
    source: 'https://www.rgcmillwork.com/',
  },
  {
    counterpartyRef: 'Tight Line Construction, Boston',
    email: 'bidinvites@tightlineco.com', contactKind: 'role', stratum: 'commercial_institutional_capable',
    contactSource: 'the bid-invitation mailbox published on its own site — the route it asks bids to come through',
    because: 'Its own site calls it "New England\'s premier specialty subcontractor, performing a multitude '
      + 'of services including drywall & metal framing, acoustical ceilings, doors & hardware, specialties, '
      + 'and general trades packages", and lists Millwork among those services. Doors and hardware and '
      + "general trades are a direct match for several of this edition's notices. Its primary trades are "
      + 'drywall and ceilings, which is said here rather than left for him to discover.',
    source: 'https://tightlineco.com/',
  },
  {
    counterpartyRef: 'Grain Architectural Millwork, East Boston',
    email: 'brandon@grainarchitecturalmillwork.com', contactKind: 'named', stratum: 'commercial_institutional_capable',
    contactSource: 'the named contact published on its own site; no role mailbox is offered',
    because: 'Its own commercial portfolio covers corporate, hospitality, retail and multi-family millwork '
      + 'from an 8,000 square foot facility at the Boston Harbor Shipyard. Not one public or institutional '
      + 'project appears anywhere on the site.',
    source: 'https://grainarchitecturalmillwork.com/',
  },
  {
    counterpartyRef: 'Salem Architectural Woodworking, Gloucester',
    email: 'pguido@salemwoodworking.net', contactKind: 'named', stratum: 'commercial_institutional_capable',
    contactSource: "the principal's address published on its own site",
    because: 'Its own site says it serves commercial and institutional organisations and quotes the Gallery '
      + 'Director at Gordon College by name about work done for the college. Gordon College is private, so '
      + 'the project is institutional but not public — which is exactly what this stratum is for.',
    source: 'http://salemwoodworking.net/',
  },
  {
    counterpartyRef: 'Camio Custom Cabinetry, Canton',
    email: 'chris@camiocabinetry.com', contactKind: 'named', stratum: 'commercial_institutional_capable',
    contactSource: 'the named contact published on its own site; no role mailbox is offered',
    because: 'Its own site says it has provided colleges, schools, corporate offices and medical centres with '
      + 'custom cabinets and countertops, and that it works to the timelines of general contractors. Sectors '
      + 'are described; no individual project is named.',
    source: 'https://www.camiocabinetry.com/commercial-cabinets-and-countertops',
  },
  {
    counterpartyRef: 'Master Millwork, Massachusetts',
    email: 'info@mastermillwork.com', contactKind: 'general', stratum: 'commercial_institutional_capable',
    contactSource: 'the only address published on its own site',
    because: 'Its own site describes estimating, drafting and shop drawings, design assist, custom and '
      + 'premium architectural millwork, commercial production casework and installation — a full '
      + 'commercial millwork operation. It names senior living, multi-unit apartments, hotels, restaurants, '
      + 'libraries and schools as its markets without naming a project.',
    source: 'https://www.mastermillwork.com/',
  },
  {
    counterpartyRef: 'Kitchen Encounters, Wilbraham',
    email: 'info@kitchen-encounters.com', contactKind: 'general', stratum: 'commercial_institutional_capable',
    contactSource: 'the address published on its own site beside its Railroad Avenue address',
    because: 'Its own Custom Commercial Millwork page names assisted living facilities, doctor and dental '
      + 'offices, banks, universities and colleges, and courthouses as the work it does. Courthouses and '
      + 'colleges are listed as categories of work rather than as projects it points to.',
    source: 'https://kitchen-encounters.com/',
  },
  {
    counterpartyRef: 'Quality Design Cabinet, Boston',
    email: 'contact@qualitydesigncabinet.com', contactKind: 'general', stratum: 'commercial_institutional_capable',
    contactSource: 'the address published on its own site, chosen over the generic mail-provider address it also lists',
    because: 'Its own portfolio names custom tenant cabinetry for a twelve-storey Boston commercial '
      + 'development and hospitality suites on Beacon Hill. Named projects, all of them private.',
    source: 'https://qualitydesigncabinet.com/commercial',
  },
];

/**
 * WHAT THE COHORT COST, named rather than summarised.
 *
 * Under the corrected population almost nothing is turned away for weak
 * evidence any more. These are Massachusetts businesses in the right trade
 * that this test cannot reach, and the reason is nearly always the same one:
 * THEY PUBLISH NO EMAIL ADDRESS. A contact form is a different act from the one
 * the owner is authorising, and inventing an address from a pattern is the
 * thing he explicitly forbade.
 *
 * This list is not a reserve to draw on if twenty-one feels thin. Reaching any
 * of them needs a capability this experiment does not have, not a lower bar.
 */
export interface NearMiss {
  counterpartyRef: string;
  /** What it is, so the loss is legible. */
  shows: string;
  /** Why this test cannot write to it. */
  shortOf: string;
}

export const PROOF1_NEARLY: NearMiss[] = [
  {
    counterpartyRef: 'Old Colony Cabinets, Stoughton',
    shows: 'commercial and institutional casework; its own site names William James College, Brigham and '
      + "Women's MRI and Cape Cod Hospital, and says it works in both the pure commercial and institutional space.",
    shortOf: 'Publishes no email anywhere. Telephone, a postal address and a contact form only. On evidence '
      + 'this is one of the strongest businesses found anywhere in this search.',
  },
  {
    counterpartyRef: 'Mass Cabinets, Inc., Methuen',
    shows: 'an architectural woodworking firm fabricating cabinets, countertops and reception desks for '
      + 'commercial and residential projects, at 99 Cross Street, Methuen.',
    shortOf: 'Publishes no email. A contact form only.',
  },
  {
    counterpartyRef: 'CMD Cabinetry, Walpole',
    shows: 'commercial cabinetry, countertops and millwork from 124 Production Road, Walpole.',
    shortOf: 'Publishes no email. A contact form only.',
  },
  {
    counterpartyRef: 'FabWright Origins, Boston',
    shows: 'commercial custom cabinetry and millwork from 13 Humphreys Street, Boston, with institutional '
      + 'and laboratory work described.',
    shortOf: 'Publishes no email. A contact form only.',
  },
  {
    counterpartyRef: 'Caliper Woodworking',
    shows: 'architectural millwork with corporate, medical, retail and education work described.',
    shortOf: 'Publishes no email. A contact form only.',
  },
  {
    counterpartyRef: 'Metropolitan Cabinets & Countertops, Norwood',
    shows: 'hand-built cabinets and in-house countertop fabrication, a multi-family division, a trade '
      + "programme for architects and contractors, and $35,858 of payments from the Senate in the "
      + "Comptroller's record.",
    shortOf: 'Publishes about thirty individual addresses, every one a residential kitchen designer, and no '
      + 'trade, contract or estimating mailbox — its own trade page directs professionals to a phone number. '
      + 'Writing to a residential designer about a public-bid brief would be a worse act than not writing.',
  },
  {
    counterpartyRef: 'Butler Architectural Woodworking, New Bedford',
    shows: 'a full-service architectural millwork company since 2000, affiliated with the North Atlantic '
      + 'Carpenters Union, whose work includes the Charles Hotel, 100 Summer Street, Parthenon Capital and Wayfair.',
    shortOf: 'Its contact page publishes no address at all — a form and a phone number. Four staff addresses '
      + 'appear elsewhere on the site with no role stated against any of them, so there is no way to choose '
      + 'an appropriate one rather than a guess.',
  },
  {
    counterpartyRef: 'Eastern Woodworks, Georgetown',
    shows: 'a full line of commercial casework and custom cabinetry fabricated at its own plant.',
    shortOf: 'The only address published is a product-specific mailbox for Corian vanity tops, which is not '
      + 'where a public-bid brief belongs.',
  },
  {
    counterpartyRef: 'New England Custom Cabinetry, Plainville; Toby Leary Fine Woodworking, Cape Cod',
    shows: 'cabinet and millwork shops with published addresses and Massachusetts premises.',
    shortOf: 'Neither publishes evidence of commercial or institutional work. Under the corrected population '
      + 'that is the one thing still required, and trade name alone does not supply it.',
  },
  {
    counterpartyRef: 'Marino Custom Display Woodworking, Topsfield',
    shows: 'a payment from the Supreme Judicial Court in the Comptroller\'s record, and a published named contact.',
    shortOf: 'The trade is display and fixture woodworking rather than building casework, so it fails the '
      + 'population on what it makes — the opposite of everyone else on this list.',
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
  /** In the cohort, with an address, but an older row without one stands in its place. */
  shadowed: Array<{ who: string; has: string }>;
  /** Already carries a stratum, and not the one this cohort says. Never silently overwritten. */
  disagreed: Array<{ who: string; recorded: string; expected: string }>;
}> {
  const { findProof1 } = await import('./proof-1.js');
  const { addRecipients, qualifyRecipient, recipientsOf, recordContactChoice, recordStratum } = await import('./hand.js');
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
  const shadowed: Array<{ who: string; has: string }> = [];
  const disagreed: Array<{ who: string; recorded: string; expected: string }> = [];
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
    // A ROW THAT CANNOT BE WRITTEN TO IS NOT IN THE COHORT, AND SAYS SO.
    //
    // `addRecipients` leaves an existing row alone, and an older pass may have
    // created one for this business from a shallower read that found no address
    // — channel `web_form`, email null. The cohort now has an address for it,
    // and the institution may not write one onto a recipient: changing who gets
    // contacted is the owner's act and the row guard enforces that.
    //
    // So the business is reported as shadowed rather than qualified. It was
    // silently qualified-and-unreachable once, which looked like a cohort of
    // twenty-one and behaved like nineteen.
    if (!r.email || r.channel !== 'email') {
      shadowed.push({ who: m.counterpartyRef, has: m.email });
      continue;
    }
    try {
      await recordContactChoice({
        founderId, experimentId, recipientId: r.id, kind: m.contactKind, source: m.contactSource,
      });
      addressed.push(m.counterpartyRef);
    } catch { /* already recorded: the first answer stands, which is the rule */ }
    // THE STRATUM IS NOT OPTIONAL AND ITS FAILURE IS NOT SWALLOWED.
    //
    // This was wired once, lost to an edit that died before it wrote the file,
    // and then written as a silent try/catch — so twenty-one businesses were
    // sealed with no stratum at all and a full green chain said nothing. A
    // stratum that fails to record is a seal that did not happen.
    if (r.evidenceStratum == null) {
      await recordStratum({ founderId, experimentId, recipientId: r.id, stratum: m.stratum });
    } else if (r.evidenceStratum !== m.stratum) {
      disagreed.push({ who: m.counterpartyRef, recorded: r.evidenceStratum, expected: m.stratum });
    }
  }
  return {
    added: PROOF1_COHORT.length - excluded.length - notFound.length - shadowed.length,
    qualified, alreadyQualified, addressed, excluded, notFound, shadowed, disagreed,
  };
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
