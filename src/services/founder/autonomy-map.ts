// =============================================================================
// FOUNDRY — what I may do on my own, across everything he owns
//
// `authorityOf` answers the question for ONE company, and answers it well: the
// setting, every door, the allowance, what each setting would have meant over
// thirty days, and the exact sentences that would widen or narrow it. What
// there was no way to ask is the question an owner of several things actually
// asks, which is not about any one of them:
//
//     Across everything, what can this thing do without me?
//
// Controls had a Permissions section that rendered ONLY when there were none.
// The moment he granted something it disappeared — so the screen whose title is
// "What I'm allowed to do" said nothing at all about permissions in exactly the
// state where the answer matters.
//
// THE WIDEST THING FIRST. An estate's autonomy is not an average; it is its
// loosest point. One company set to carry with a live allowance and no boundary
// is the answer to "what can it do without me", whatever the other four say. So
// this sorts by reach and leads with it.
//
// NOTHING HERE GRANTS OR CHANGES ANYTHING. It is a reading. Every act that
// would widen or narrow authority goes through the company's own page, one
// sentence at a time, because that is where the confirmation and the
// fingerprint live.
// =============================================================================

import { query, realCompany } from '../../db/client.js';
import { authorityOf, type AuthorityReading, type Setting } from './authority.js';

export interface CompanyAutonomy {
  productId: string;
  name: string;
  setting: Setting;
  sentence: string;
  /** Doors the owner has shut or narrowed here, in his words. */
  shut: Array<{ ownerWords: string; mode: 'never' | 'ask_first'; everywhere: boolean }>;
  /** Money it may spend without asking, and what is left of it. */
  allowance: { amountCents: number; remainingCents: number; statement: string } | null;
  /** Standing grants: what it may carry without asking, and until when. */
  grants: Array<{ what: string; until: string | null }>;
  /** How far it actually went in thirty days, from the acts themselves. */
  last30: AuthorityReading['last30'];
  /** Higher means it can do more without him. Ordering only; never displayed. */
  reach: number;
}

/**
 * WHAT MAY HAPPEN WITHOUT HIM, BY KIND OF ACT RATHER THAN BY COMPANY.
 *
 * "Across everything, what can this thing do without me" has two honest
 * answers, and this map only had one of them. Sorted by company, an estate's
 * autonomy is its loosest point; sorted by KIND OF ACT it is something quite
 * different, and more useful, because the kinds are not interchangeable.
 * "It can spend without asking" and "it can publish without asking" are not the
 * same sentence even when both are true of the same company, and an owner who
 * reads only the company-shaped answer has to reconstruct the other one himself.
 *
 * THE KINDS ARE NOT A NEW TAXONOMY. They are the seven consequence rungs the
 * door already gates on, read from the constitutional table with their own
 * words, so there is nothing here to keep in step with anything. A rung that is
 * not `absorbable` says so as a fact about the ladder rather than as a summary
 * of the current state: no policy can ever pre-authorise it, and that does not
 * change when the owner grants something.
 */
export interface ByConsequence {
  rung: string;
  /** The ladder's own words for what acts on this rung do. */
  whatItMeans: string;
  /** How many capabilities can reach this rung at all. */
  capabilities: number;
  /**
   * Whether anything here can happen without him being asked, and why.
   * 'never' is constitutional; the others are the current state.
   */
  standing: 'never' | 'nothing_can_do_this' | 'only_within_an_allowance' | 'where_you_allowed_it' | 'nowhere';
  sentence: string;
}

export interface AutonomyMap {
  /** One sentence for the whole estate, led by its loosest point. */
  sentence: string;
  companies: CompanyAutonomy[];
  /** The same estate read by kind of act rather than by company. */
  byConsequence: ByConsequence[];
  /** True when nothing anywhere may act or spend without him. */
  nothingWithoutHim: boolean;
  /** Acts proposed and still waiting on him, across everything. */
  waitingOnHim: number;
}

/** What a setting can reach, for ordering. Money widens it; a shut door narrows. */
function reachOf(a: AuthorityReading): number {
  const base = a.setting === 'carry' ? 3 : a.setting === 'mixed' ? 2 : a.setting === 'propose' ? 1 : 0;
  const money = a.allowance && a.allowance.remainingCents > 0 ? 2 : 0;
  const grants = Math.min(a.grants.length, 2);
  const shut = a.doors.filter((d) => d.mode !== 'open').length;
  return base * 10 + money * 3 + grants - shut;
}

export async function autonomyAcross(founderId: string): Promise<AutonomyMap> {
  // Every company he actually owns. `realCompany` because a reference company is
  // synthetic: telling him the institution may act on its own somewhere, on the
  // strength of a company that does not exist, is the one answer this page must
  // never give.
  //
  // STANDING DOES NOT APPLY, AND LEAVING IT OUT WOULD BE THE DEFECT. An
  // EXPERIMENTAL asset is where this institution's authority actually bites —
  // the money is authorised for experiments and the acts that reach strangers
  // are placed from them. A map of what may happen without him that showed only
  // earned companies would omit exactly the companies things happen at.
  const products = await query(
    `SELECT id, name FROM products
      WHERE owner_id = ? AND ${realCompany()} AND COALESCE(status,'active') <> 'archived'
      ORDER BY name`, [founderId]);

  const readings: CompanyAutonomy[] = [];
  for (const raw of products.rows) {
    const row = raw as Record<string, unknown>;
    const a = await authorityOf(founderId, String(row.id));
    if (!a) continue;
    readings.push({
      productId: a.productId,
      name: a.name,
      setting: a.setting,
      sentence: a.sentence,
      shut: a.doors
        .filter((d) => d.mode !== 'open')
        .map((d) => ({ ownerWords: d.ownerWords, mode: d.mode as 'never' | 'ask_first', everywhere: d.everywhere })),
      allowance: a.allowance
        ? {
          amountCents: a.allowance.amountCents,
          remainingCents: a.allowance.remainingCents,
          statement: a.allowance.statement,
        }
        : null,
      grants: a.grants.map((g) => ({ what: g.what, until: g.until })),
      last30: a.last30,
      reach: reachOf(a),
    });
  }
  readings.sort((x, y) => y.reach - x.reach || x.name.localeCompare(y.name));

  const waitingOnHim = readings.reduce((n, r) => n + r.last30.pendingOutbound, 0);
  const canAct = readings.filter((r) => r.setting === 'carry' || r.setting === 'mixed');
  const canSpend = readings.filter((r) => r.allowance && r.allowance.remainingCents > 0);
  const nothingWithoutHim = canAct.length === 0 && canSpend.length === 0;

  return {
    sentence: sentenceFor(readings, canAct, canSpend, waitingOnHim),
    companies: readings,
    byConsequence: await byConsequence(canAct, canSpend),
    nothingWithoutHim, waitingOnHim,
  };
}

async function byConsequence(
  canAct: CompanyAutonomy[], canSpend: CompanyAutonomy[],
): Promise<ByConsequence[]> {
  const rungs = (await query(
    `SELECT r.rung, r.what_it_means, r.absorbable,
            (SELECT COUNT(*) FROM capabilities c WHERE c.rung = r.rung) AS n
       FROM consequence_rungs r ORDER BY r.sort_order`, []))
    .rows as unknown as Array<Record<string, unknown>>;

  const where = (rows: CompanyAutonomy[]): string => rows.length === 1
    ? rows[0].name : `${String(rows.length)} of them`;

  return rungs.map((r) => {
    const rung = String(r.rung);
    const capabilities = Number(r.n);
    const whatItMeans = String(r.what_it_means);
    // NOT ABSORBABLE IS A PROPERTY OF THE LADDER, not of today. It is said the
    // same way whether or not he has granted anything, because no grant can
    // change it — and a sentence that softened when the estate got looser would
    // be describing the estate rather than the rule.
    if (Number(r.absorbable) === 0) {
      return { rung, whatItMeans, capabilities, standing: 'never' as const,
        sentence: `Never without asking you, wherever it is and whatever you have allowed `
          + `elsewhere. Something that ${whatItMeans} is yours to decide one act at a time.` };
    }
    if (capabilities === 0) {
      return { rung, whatItMeans, capabilities, standing: 'nothing_can_do_this' as const,
        sentence: `Nothing here can do this at all yet, so there is nothing to allow.` };
    }
    if (rung === 'financial') {
      return canSpend.length === 0
        ? { rung, whatItMeans, capabilities, standing: 'nowhere' as const,
          sentence: 'Nowhere. No allowance of yours is live, so anything that spends asks first.' }
        : { rung, whatItMeans, capabilities, standing: 'only_within_an_allowance' as const,
          sentence: `Only up to $${(canSpend.reduce((n, c) => n + (c.allowance?.remainingCents ?? 0), 0) / 100).toFixed(2)}, `
            + `at ${where(canSpend)}, and only for what you said the allowance was for. `
            + 'Past that it asks.' };
    }
    return canAct.length === 0
      ? { rung, whatItMeans, capabilities, standing: 'nowhere' as const,
        sentence: 'Nowhere on its own. Everything of this kind is proposed to you first.' }
      : { rung, whatItMeans, capabilities, standing: 'where_you_allowed_it' as const,
        sentence: `At ${where(canAct)}, within what you allowed there.` };
  });
}

function sentenceFor(
  all: CompanyAutonomy[],
  canAct: CompanyAutonomy[],
  canSpend: CompanyAutonomy[],
  waiting: number,
): string {
  if (all.length === 0) return 'There is nothing here for me to act on yet.';
  if (canAct.length === 0 && canSpend.length === 0) {
    return all.length === 1
      ? 'I cannot act or spend anywhere without asking you first.'
      : `I cannot act or spend on my own at any of the ${String(all.length)} companies you own.`;
  }
  const parts: string[] = [];
  if (canAct.length > 0) {
    parts.push(canAct.length === 1
      ? `I carry things through on my own at ${canAct[0].name}`
      : `I carry things through on my own at ${String(canAct.length)} companies`);
  }
  if (canSpend.length > 0) {
    const left = canSpend.reduce((n, r) => n + (r.allowance?.remainingCents ?? 0), 0);
    parts.push(`I may spend up to $${(left / 100).toFixed(2)} more without asking`);
  }
  const tail = waiting > 0
    ? ` ${String(waiting)} ${waiting === 1 ? 'thing is' : 'things are'} waiting on you.`
    : '';
  return `${parts.join(', and ')}.${tail}`;
}
