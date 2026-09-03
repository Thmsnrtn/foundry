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
}): Promise<ConsequenceVerdict> {
  const facts = await rungOfTool(input.tool);
  if (!facts) {
    return {
      allowed: false, rung: null,
      reason: `nothing says what consequence '${input.tool}' has, so it may not act`,
    };
  }
  const { rung } = facts;
  if (rung === 'observe' || rung === 'prepare' || rung === 'reversible' || rung === 'public') {
    return { allowed: true, rung, reason: `${facts.whatItDoes}: ${facts.whatItMeans}` };
  }

  const { spendApprovalFor, allowanceFor } = await import('./standing-intent.js');
  if (rung === 'financial') {
    // An allowance is standing money; it does not need to be spent here, only
    // to exist and have something left. The budget door spends it.
    const allowance = await allowanceFor(input.productId);
    if (allowance && allowance.remainingCents > 0) {
      return { allowed: true, rung, reason: `within what you allowed: ${allowance.statement}` };
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
