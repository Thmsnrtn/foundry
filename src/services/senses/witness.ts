// =============================================================================
// FOUNDRY — something witnesses the moment the world answers
//
// THE GAP THIS CLOSES. `MATURITY_MAP.md` says of `read_marketplace_account`:
// "It moves on the first real read and not before." That described a transition
// no code could perform.
//
// The ladder and its witnessed, append-only change ledger are real
// (`capability_providers.maturity`, `capability_maturity_changes`, migration
// 243). What was missing is any call into them from the senses path.
// `bringTheVenueUpToDate` does the authenticated read, writes a
// `market_observations` row and calls `noteSenseObserved` — and never records a
// maturity change. `completeAuthorization` ends at the credential INSERT and
// never asks the provider anything at all.
//
// The consequence, had the owner connected first: a level-5 fact in
// `market_observations` and a level-2 claim in the registry that is supposed to
// speak for it, permanently disagreeing, with the registry the one every reader
// consults.
//
// THE PRECEDENT THIS FOLLOWS. `workshop-standing.ts:144-150` already does this
// for the one other credentialed provider: it probes, and on a reachable
// authenticated read records the acquisition with the provider's own words as
// evidence. This is that pattern, applied where the senses layer already had
// the facts and dropped them.
//
// WHAT IT WILL NOT PROMOTE.
//
// Only providers at the OBSERVE rung. Etsy's three write capabilities carry
// `tool = NULL` and therefore cannot reach the outbound door — but they are
// still rows on the same provider, and a witness that keyed on "this provider
// answered" would promote a publishing capability because a read succeeded.
// Reading proves reading. The rung is the thing that says which is which, and
// it is read from the capability, not passed in by a caller.
//
// And nothing here invents a rung, a tool, or an access basis. A promotion says
// the capability is more PROVEN than it was. It says nothing about whether it
// may be used, which is `capability_access`, `consequenceAllows` and the
// owner's authority — three separate questions this module does not touch.
// =============================================================================

import { query } from '../../db/client.js';
import { log } from '../../lib/logger.js';
import type { Maturity } from '../institution/capabilities.js';

/**
 * How far along the ladder a given kind of evidence licenses.
 *
 * `available` — a credential reached the provider and it confirmed the account.
 *   The machinery works and the grant is live. It is not evidence that anything
 *   useful can be read, because nothing useful was asked for.
 *
 * `reality_proven` — the thing the connection exists for was actually read from
 *   the real account. The trigger at migration 243 refuses this for any
 *   evidence that is not `real`, so a rehearsal cannot reach it even by
 *   mistake, and this module does not try.
 */
const RANK: Record<string, number> = {
  declared: 0, available: 1, controlled_proven: 2,
  reality_proven: 3, reliable: 4, degraded: 0, unavailable: 0,
};

export interface WitnessResult {
  /** Provider rows promoted, by id. Empty is the ordinary case, not a failure. */
  promoted: string[];
  /** Why nothing moved, when nothing did. */
  because: string | null;
}

/**
 * Record that a provider's reading capability proved itself.
 *
 * Idempotent by construction: the ladder's guard aborts a change whose
 * `from_maturity` equals its `to_maturity`, so a second successful read on the
 * same day would throw rather than no-op. This reads the current rung first and
 * moves only what is genuinely behind — which also means a provider a human has
 * marked `degraded` is re-promoted by a read that works, and one already at
 * `reliable` is left alone.
 */
export async function witnessAReading(input: {
  provider: string;
  /** Which world this evidence came from. `reality_proven` demands 'real'. */
  evidenceMode: 'real' | 'sandbox' | 'reference';
  to: Extract<Maturity, 'available' | 'reality_proven'>;
  /** The provider's own words where possible, never a stack trace. */
  evidence: string;
  witnessedBy: string;
}): Promise<WitnessResult> {
  // A REHEARSAL CANNOT PROVE THE WORLD ANSWERED, and the trigger says so too.
  // Refusing here as well means the caller gets a sentence rather than an
  // exception, and the read it just did is not lost to a throw.
  if (input.to === 'reality_proven' && input.evidenceMode !== 'real') {
    return { promoted: [], because: `a ${input.evidenceMode} reading cannot prove the world answered` };
  }

  const rows = (await query(
    `SELECT p.id, p.maturity
       FROM capability_providers p
       JOIN capabilities c ON c.capability_key = p.capability_key
      WHERE p.provider = ? AND c.rung = 'observe'`,
    [input.provider])).rows as unknown as Array<Record<string, unknown>>;

  if (!rows.length) {
    return { promoted: [], because: `no observing capability is declared for ${input.provider}` };
  }

  const target = RANK[input.to] ?? 0;
  const behind = rows.filter((r) => (RANK[String(r.maturity)] ?? 0) < target);
  if (!behind.length) {
    return { promoted: [], because: 'already at least this proven' };
  }

  const { recordMaturity } = await import('../institution/capabilities.js');
  const promoted: string[] = [];
  for (const r of behind) {
    try {
      await recordMaturity({
        providerId: String(r.id), to: input.to,
        evidence: input.evidence, evidenceMode: input.evidenceMode,
        witnessedBy: input.witnessedBy,
      });
      promoted.push(String(r.id));
    } catch (err) {
      // A LADDER THAT REFUSES IS NOT A READ THAT FAILED. The reading happened
      // and its observation is already written; failing to record what it
      // proved is worth saying out loud and is not worth losing the read over.
      log.warn(`witness: ${String(r.id)} would not move to ${input.to}: `
        + `${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { promoted, because: promoted.length ? null : 'the ladder refused every change' };
}
