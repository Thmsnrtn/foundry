// =============================================================================
// FOUNDRY — where the owner's decision about a workshop has actually got to
//
// A decision that costs money has a life after the tap, and most of it happens
// somewhere this institution cannot see: he goes to the provider, takes a plan,
// issues a credential, sets it where the deployment reads secrets, and comes
// back. Every one of those can half-happen.
//
// So the state is DERIVED, never asserted. Nothing here asks him to confirm
// that something worked — he should not have to tell an application whether the
// thing he just did took effect, and an app that believes him rather than
// checking will eventually be confidently wrong in front of him.
//
// AND AUTHORISED IS NOT REACHABLE IS NOT PROVEN. Three different facts, and the
// gap between them is exactly where a product would like to congratulate
// itself. A plan purchased is money spent, not a capability demonstrated; a
// credential accepted means the provider will talk to us, not that anything has
// ever run. The words the owner sees keep them apart.
//
// `reachable` rather than `connected` on purpose. "Connected" is the word a
// product reaches for when it wants the setup to feel finished, and finished is
// the one thing this state is not — the provider answering the phone is the
// weakest true thing that can be said about it.
// =============================================================================

import { query } from '../../db/client.js';

export type WorkshopState =
  /** Nothing has been asked, because nothing has needed it. */
  | 'not_needed'
  /** Raised and waiting on him. */
  | 'waiting_on_you'
  /** He said not yet. The need is kept; the isolation rule is not weakened. */
  | 'not_yet'
  /** He said yes. The provider side is not done. */
  | 'authorized'
  /** The provider accepts us. Nothing has run. */
  | 'reachable'
  /** Something really ran, somewhere this institution is not. */
  | 'proven';

export interface WorkshopStanding {
  state: WorkshopState;
  /** What he reads. One sentence, no jargon, true in every branch. */
  says: string;
  /** The acquisition this hangs off, when there is one. */
  acquisitionId: string | null;
  /** What he could do next, or null when the next move is not his. */
  next: { label: string; href: string } | null;
}

const CAPABILITY = 'run_in_workspace';

export async function workshopStanding(founderId: string): Promise<WorkshopStanding> {
  const a = (await query(
    `SELECT id, decision, withdrawn_at FROM capability_acquisitions
      WHERE founder_id = ? AND capability_key = ?
      ORDER BY proposed_at DESC LIMIT 1`, [founderId, CAPABILITY]))
    .rows[0] as Record<string, unknown> | undefined;

  if (!a || a.withdrawn_at != null) {
    return { state: 'not_needed', acquisitionId: null, next: null,
      says: 'I am not using an outside workshop.' };
  }
  const id = String(a.id);

  if (a.decision == null) {
    return { state: 'waiting_on_you', acquisitionId: id,
      next: { label: 'Look at it', href: '/foundry' },
      says: 'I have asked you about this and I am waiting.' };
  }
  if (String(a.decision) === 'declined') {
    // NOT YET IS A REAL ANSWER AND IT HOLDS. The need is kept, the
    // responsibility is kept, and the isolation rule is not quietly relaxed to
    // get on without him. What the institution knows is simply that this piece
    // of work cannot be absorbed yet.
    return { state: 'not_yet', acquisitionId: id, next: null,
      says: 'You said not yet, so I am leaving it. The work it was for stays '
        + 'undone rather than being done somewhere unsafe.' };
  }

  // Approved. Where the provider side has got to is read, never assumed.
  const p = (await query(
    `SELECT maturity FROM capability_providers
      WHERE capability_key = ? ORDER BY sort_order LIMIT 1`, [CAPABILITY]))
    .rows[0] as Record<string, unknown> | undefined;
  const maturity = p == null ? 'declared' : String(p.maturity);

  if (maturity === 'reality_proven' || maturity === 'reliable') {
    return { state: 'proven', acquisitionId: id, next: null,
      says: 'I produced and checked a change to my own software in a workshop '
        + 'outside myself. Nothing was published.' };
  }
  if (maturity === 'declared' || maturity === 'unavailable') {
    return { state: 'authorized', acquisitionId: id,
      next: { label: 'Finish setting it up', href: '/foundry/workshop' },
      says: 'You have said yes. There is a step left at their end before I can '
        + 'use it.' };
  }
  return { state: 'reachable', acquisitionId: id,
    next: { label: 'See how it is going', href: '/foundry/workshop' },
    says: 'The workshop answers me. Nothing has run in it yet.' };
}

/**
 * ASK THE PROVIDER, AND PROMOTE ONLY ON WHAT IT ANSWERED.
 *
 * A read against the real service. When it works the provider moves from
 * declared to available on THAT as evidence — not on the owner's approval,
 * which is a decision rather than a demonstration, and not on a plan purchase,
 * which is money rather than a capability.
 *
 * IT DOES NOT REACH `reality_proven` AND MUST NOT. A provider that will talk to
 * us has not run anything. The record says available, the owner is told the
 * workshop answers, and the sentence that says work happened outside this
 * institution waits for work to have happened outside this institution.
 */
export async function checkTheWorkshop(input: {
  founderId: string; by: string;
}): Promise<{ reachable: boolean; says: string }> {
  const standing = await workshopStanding(input.founderId);
  if (standing.state !== 'authorized' && standing.state !== 'reachable') {
    return { reachable: false, says: standing.says };
  }

  const { spritesReachable } = await import('../workshop/fly-sprites.js');
  const probe = await spritesReachable();

  if (!probe.ok) {
    // THE RECOVERY IS THE POINT OF THIS SENTENCE. A raw provider error tells
    // him nothing he can act on; which of the three things went wrong tells him
    // exactly what to go and do.
    return { reachable: false, says: probe.what === 'no_credential'
      ? 'Nothing has been set for this yet. The last step happens in your '
        + 'account with them, not here — I never want the key itself.'
      : probe.what === 'rejected'
        ? 'They have something from you but are refusing it. It is usually a key '
          + 'that was replaced or is for a different organisation. Issuing a new '
          + 'one and setting it again fixes it, and nothing you decided is lost.'
        : `I could not reach them just now — ${probe.detail}. Your decision `
          + 'stands; I will keep trying.' };
  }

  if (standing.state === 'authorized' && standing.acquisitionId !== null) {
    const { recordAcquired } = await import('./acquisition.js');
    await recordAcquired({
      id: standing.acquisitionId,
      evidence: `an authenticated read reached the provider: ${probe.detail}`,
      witnessedBy: input.by,
    });
  }
  return { reachable: true,
    says: 'The workshop answers me. Nothing has run in it yet — that is the '
      + 'next thing, and you will hear what it found and what it cost.' };
}
