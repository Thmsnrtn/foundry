// =============================================================================
// FOUNDRY - consequence determines governance, not interface
//
// Every tool at the outbound door is bound to a capability, every capability
// sits on a rung, and the rung says what authority an act on it takes. The
// same rule reaches a browser, a shell or a future computer the moment one is
// bound here, which is the point: there is one ladder, and nothing gets a
// quieter door by arriving through a different interface.
//
// TWO RUNGS ARE NEVER ABSORBED. A legal commitment and an irreversible act are
// the owner's, one at a time, and no allowance, lifted boundary or recognised
// responsibility can pre-authorise them. The table says so; this file only
// asks it.
// =============================================================================

import { query } from '../../db/client.js';

export type Rung = 'observe' | 'prepare' | 'reversible' | 'public' | 'financial'
  | 'legal' | 'destructive';

export interface RungFacts {
  rung: Rung; whatItMeans: string; absorbable: boolean;
  capabilityKey: string; whatItDoes: string;
}

/** Which rung a tool at the door stands on, or null when nothing binds it. */
export async function rungOfTool(tool: string): Promise<RungFacts | null> {
  const row = (await query(
    `SELECT c.capability_key, c.what_it_does, r.rung, r.what_it_means, r.absorbable
       FROM capability_providers p
       JOIN capabilities c ON c.capability_key = p.capability_key
       JOIN consequence_rungs r ON r.rung = c.rung
      WHERE p.tool = ?`, [tool])).rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    rung: String(row.rung) as Rung, whatItMeans: String(row.what_it_means),
    absorbable: Number(row.absorbable) === 1,
    capabilityKey: String(row.capability_key), whatItDoes: String(row.what_it_does),
  };
}

export interface ConsequenceVerdict {
  allowed: boolean;
  rung: Rung | null;
  /** In the owner's words: what this act is, and why it may or may not proceed. */
  reason: string;
}

/**
 * MAY THIS ACT PROCEED ON ITS RUNG?
 *
 * observe and prepare: yes - nothing outside can tell.
 * reversible and public: the boundary door already governs these; nothing
 *   extra here, so the standing "ask me first" and "never" keep working.
 * financial: an allowance for the company, or an exact-act approval.
 * legal and destructive: an exact-act approval, every time. Not absorbable.
 *
 * A tool bound to nothing is refused at every rung above observe: an effect
 * whose consequence nobody has classified is not one the door may let through.
 */
export async function consequenceAllows(input: {
  productId: string; tool: string; paramsFingerprint: string | null;
  /**
   * What the act IS, for a capability whose consequence depends on it rather
   * than on the tool. A browser is the case that matters: reading a page and
   * accepting somebody's terms arrive through the same hand.
   */
  browserAct?: string | null;
  /** What this act will cost, in cents. Required on the financial rung. */
  estimatedCents?: number | null;
}): Promise<ConsequenceVerdict> {
  const facts = await rungOfTool(input.tool);
  if (!facts) {
    return {
      allowed: false, rung: null,
      reason: `nothing says what consequence '${input.tool}' has, so it may not act`,
    };
  }

  // CONSEQUENCE BELONGS TO THE ACT, NOT ONLY TO THE CAPABILITY.
  //
  // `act_in_a_browser` sits at `public` and was therefore waved through, and
  // pressing a button on a site is how one accepts terms, creates an account in
  // the institution's name, or authorises a payment. The constitution says a
  // materially irreversible act may never be silently absorbed into ordinary
  // autonomous authority; a browser at `public` absorbed all of them.
  //
  // The higher of the two rungs governs, and an act that will not say what it
  // is gets refused rather than defaulting to the cheapest reading of itself —
  // the same precedent as a tool bound to nothing.
  const escalated = await rungOfBrowserAct(facts, input.browserAct ?? null);
  if ('refused' in escalated) {
    return { allowed: false, rung: facts.rung, reason: escalated.refused };
  }
  const { rung } = escalated;

  if (rung === 'observe' || rung === 'prepare' || rung === 'reversible' || rung === 'public') {
    return { allowed: true, rung, reason: `${facts.whatItDoes}: ${facts.whatItMeans}` };
  }

  const { spendApprovalFor, allowanceFor } = await import('./standing-intent.js');
  if (rung === 'financial') {
    // AN ACT THAT SPENDS MONEY MUST SAY HOW MUCH.
    //
    // Without this, "is there anything left?" was the whole test, and an
    // allowance with one cent remaining authorised a thousand-dollar act. The
    // amount is the caller's declaration of its own cost, and an act that will
    // not declare one cannot be metered, so it does not proceed.
    const cost = input.estimatedCents ?? null;
    if (cost === null || !Number.isFinite(cost) || cost < 0) {
      return {
        allowed: false, rung,
        reason: `this ${facts.whatItMeans}, and nothing said what it would cost — `
          + 'an act that spends money has to say how much before it may',
      };
    }
    // An allowance is standing money; it does not need to be spent here, only
    // to exist and to cover this act. The budget door spends it.
    const allowance = await allowanceFor(input.productId);
    if (allowance && allowance.remainingCents >= cost) {
      return { allowed: true, rung, reason: `within what you allowed: ${allowance.statement}` };
    }
    if (allowance && cost > allowance.remainingCents) {
      return {
        allowed: false, rung,
        reason: `that would cost $${(cost / 100).toFixed(2)} and $`
          + `${(allowance.remainingCents / 100).toFixed(2)} is left of what you allowed`,
      };
    }
    const approved = await spendApprovalFor({
      productId: input.productId, actionType: input.tool,
      paramsFingerprint: input.paramsFingerprint,
    });
    if (approved) return { allowed: true, rung, reason: 'you approved exactly this act' };
    return {
      allowed: false, rung,
      reason: `this ${facts.whatItMeans}, and you have neither allowed money for this `
        + 'company nor approved this act',
    };
  }

  // legal, destructive: exact-act approval only, and the rung says it cannot
  // be absorbed - so no allowance is consulted, on purpose.
  const approved = await spendApprovalFor({
    productId: input.productId, actionType: input.tool,
    paramsFingerprint: input.paramsFingerprint,
  });
  if (approved) return { allowed: true, rung, reason: 'you approved exactly this act' };
  return {
    allowed: false, rung,
    reason: `this ${facts.whatItMeans}. That is yours to decide each time, and you have `
      + 'not approved this one',
  };
}


/**
 * THE HIGHER OF TWO RUNGS, WHEN THE ACT CARRIES ITS OWN CONSEQUENCE.
 *
 * Only capabilities listed in `browser_act_kinds`' world need this — today that
 * is the browser. Everything else keeps the rung its capability declares, so
 * this is a widening of one door rather than a new ladder.
 */
async function rungOfBrowserAct(
  facts: RungFacts, browserAct: string | null,
): Promise<{ rung: Rung } | { refused: string }> {
  if (facts.capabilityKey !== 'act_in_a_browser') return { rung: facts.rung };
  if (browserAct === null || browserAct.trim() === '') {
    return {
      refused: 'a browser can read a page or accept somebody\'s terms, and this act '
        + 'did not say which, so it may not act',
    };
  }
  const row = (await query(
    `SELECT k.rung, k.what_it_is, r.sort_order AS act_order,
            (SELECT sort_order FROM consequence_rungs WHERE rung = ?) AS cap_order
       FROM browser_act_kinds k
       JOIN consequence_rungs r ON r.rung = k.rung
      WHERE k.kind = ?`, [facts.rung, browserAct.trim()]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    return { refused: `nothing says what kind of act '${browserAct}' in a browser is, `
      + 'so it may not act' };
  }
  return {
    rung: Number(row.act_order) > Number(row.cap_order)
      ? String(row.rung) as Rung
      : facts.rung,
  };
}
