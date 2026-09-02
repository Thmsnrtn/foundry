// =============================================================================
// FOUNDRY - the ways of looking, one at a time
//
// "Market" is not a switch. It is a family of partial, disagreeing ways of
// seeing what is happening outside the owner's companies, and each one arrives,
// is accounted for, and can be revoked on its own.
//
// SO "CAN FOUNDRY SEE THE MARKET" IS THE WRONG QUESTION. The answerable one is
// which ways of looking are live, what each of them can and cannot tell you,
// and what is therefore still guesswork. An institution that reported a single
// boolean would be claiming a market had been comprehended the moment one
// source was connected.
//
// AND CONNECTING ONE NEVER GRANTS ANYTHING. Reading what people say about a
// market has never implied permission to write to them, and the sentence saying
// so is stored on the row and cannot be edited afterwards.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

export interface WayOfLooking {
  id: string;
  sourceType: string;
  named: string;
  /** What kind of knowing this is, from the constitutional vocabulary. */
  whatItIs: string;
  /** Somebody's account of themselves, something observed, or something asked. */
  stance: 'self_reported' | 'observed' | 'solicited';
  neverGrants: string;
  reference: boolean;
  connectedOn: string;
}

/** Every live way this person has of looking outside their own companies. */
export async function waysOfLooking(
  founderId: string, world: 'real' | 'reference' = 'real',
): Promise<WayOfLooking[]> {
  return ((await query(
    `SELECT r.id, r.source_type, r.named, r.never_grants, r.evidence_mode,
            r.connected_at, t.what_it_is, t.stance
       FROM research_sources r
       JOIN market_source_types t ON t.source_type = r.source_type
      WHERE r.founder_id = ? AND r.disconnected_at IS NULL
        AND r.evidence_mode = ?
      ORDER BY t.sort_order`, [founderId, world]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), sourceType: String(r.source_type), named: String(r.named),
    whatItIs: String(r.what_it_is),
    stance: String(r.stance) as 'self_reported' | 'observed' | 'solicited',
    neverGrants: String(r.never_grants),
    reference: String(r.evidence_mode) === 'reference',
    connectedOn: String(r.connected_at).slice(0, 10),
  }));
}

/**
 * WHAT IS STILL DARK, said as the kinds of knowing that are missing.
 *
 * Not "you have 3 of 16 sources". The useful sentence is which kind of question
 * still cannot be answered — nobody has been asked anything, or nothing has
 * been watched happening — because those are different holes and a count would
 * hide which one you are in.
 */
export async function whatIsStillDark(
  founderId: string, world: 'real' | 'reference' = 'real',
): Promise<string[]> {
  const live = await waysOfLooking(founderId, world);
  const stances = new Set(live.map((w) => w.stance));
  const dark: string[] = [];
  if (live.length === 0) {
    dark.push('nothing at all — I have no way to look outside your companies');
    return dark;
  }
  if (!stances.has('observed')) {
    dark.push('I have nothing that watched something happen, so everything I '
      + 'know is what somebody said');
  }
  if (!stances.has('solicited')) {
    dark.push('nobody has been asked anything directly, so I cannot tell you '
      + 'what people would say if you offered them this');
  }
  if (!stances.has('self_reported')) {
    dark.push('I cannot see what anyone is charging or claiming about themselves');
  }
  return dark;
}

/**
 * Connect one.
 *
 * `neverGrants` is required rather than defaulted, because a default would get
 * written once and read never, and the whole value of the sentence is that
 * somebody had to say it about this particular source.
 */
export async function connectResearchSource(input: {
  founderId: string; sourceType: string; named: string; neverGrants: string;
  evidenceMode: 'real' | 'reference';
}): Promise<string | null> {
  const id = nanoid();
  try {
    await query(
      `INSERT INTO research_sources
         (id, founder_id, source_type, named, never_grants, evidence_mode)
       VALUES (?,?,?,?,?,?)`,
      [id, input.founderId, input.sourceType, input.named.trim(),
        input.neverGrants.trim(), input.evidenceMode]);
    return id;
  } catch {
    // Already connected. The unique index is the idempotency, and a second
    // connection of the same thing is a retry rather than a second source.
    return null;
  }
}

export async function disconnectResearchSource(id: string): Promise<void> {
  await query(
    `UPDATE research_sources SET disconnected_at = datetime('now')
      WHERE id = ? AND disconnected_at IS NULL`, [id]);
}

/**
 * THE SOURCES THE REFERENCE WORLD LOOKS THROUGH.
 *
 * Declared here rather than invented at the point of use, so a rehearsal search
 * sees through a stated set of ways of looking - and so the sentence "here is
 * what I still cannot see" is exercised against a portfolio of sources that is
 * deliberately incomplete. It has nothing solicited: nobody in the reference
 * world has been asked anything, which is the most common real hole and the one
 * worth rehearsing.
 */
const REFERENCE_WAYS: Array<[string, string]> = [
  ['community', 'an invented forum where people describe their problems'],
  ['marketplace', 'an invented marketplace listing what sells'],
  ['pricing_page', 'invented vendor pricing pages'],
  ['job_posting', 'invented job adverts, which say what companies are doing'],
  ['reference_world', 'the rehearsal world itself'],
];

export async function openTheReferenceEyes(founderId: string): Promise<number> {
  let opened = 0;
  for (const [sourceType, named] of REFERENCE_WAYS) {
    const made = await connectResearchSource({
      founderId, sourceType, named,
      neverGrants: 'contact anyone I find, spend anything, or commit you to anything',
      evidenceMode: 'reference',
    });
    if (made !== null) opened += 1;
  }
  return opened;
}
