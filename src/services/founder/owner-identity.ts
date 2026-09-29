// =============================================================================
// FOUNDRY — the owner's founder row, found or rebound, and nobody else's made
//
// THE SWITCH TO A PRODUCTION CLERK INSTANCE WOULD HAVE LOCKED THE OWNER OUT.
// A new instance gives the same person a new Clerk user id. A session finds its
// founder by `clerk_user_id`, and `founders.email` is UNIQUE — so the first
// sign-in on the new instance found no row, tried to insert one with the
// owner's email, collided, and was sent back to sign in. PENDING 24 said the
// code change for that switch was nil; it was not.
//
// ONE RULE, BOTH DOORS. A founder row comes into being in two places — the auth
// middleware on first sign-in, and the signature-verified Clerk webhook — and
// both call this. In order:
//
//   1. A caller cannot declare the address is the owner's: `mayBeAdmitted` is
//      asked here, whatever the caller already checked. Null (unverified) or
//      anyone else's address is refused, and nothing is written.
//   2. A row with this Clerk id is found and returned.
//   3. A row with the owner's email and ANOTHER Clerk id is rebound to this
//      one, and the rebind is recorded (migration 369). That is the switch.
//   4. Otherwise the owner's row is created.
//
// A rebind moves the owner's own row to the owner's own new identity. It can
// never attach anyone to it: step 1 has already refused every other address,
// and the email is the one the identity provider verified as primary.
// =============================================================================

import { nanoid } from 'nanoid';
import { batch, query } from '../../db/client.js';
import { mayBeAdmitted } from '../../lib/instance-posture.js';

export type OwnerIdentityResult =
  | { founderId: string; action: 'found' | 'rebound' | 'created' }
  | { founderId: null; action: 'refused' };

export async function bindOwnerIdentity(input: {
  clerkUserId: string;
  /** The identity provider's VERIFIED primary address, or null when there is none. */
  verifiedPrimaryEmail: string | null;
  name: string | null;
}): Promise<OwnerIdentityResult> {
  const email = (input.verifiedPrimaryEmail ?? '').trim().toLowerCase();
  if (!input.clerkUserId || !email || !mayBeAdmitted(email)) {
    return { founderId: null, action: 'refused' };
  }

  const byId = await query('SELECT id FROM founders WHERE clerk_user_id = ?', [input.clerkUserId]);
  if (byId.rows.length > 0) {
    return { founderId: String((byId.rows[0] as Record<string, unknown>).id), action: 'found' };
  }

  const byEmail = await query(
    'SELECT id, clerk_user_id FROM founders WHERE lower(email) = ?', [email]);
  const existing = byEmail.rows[0] as Record<string, unknown> | undefined;
  if (existing) {
    const founderId = String(existing.id);
    await batch([
      { sql: 'UPDATE founders SET clerk_user_id = ? WHERE id = ?', args: [input.clerkUserId, founderId] },
      {
        sql: `INSERT INTO owner_identity_rebinds (id, founder_id, from_clerk_user_id, to_clerk_user_id)
              VALUES (?, ?, ?, ?)`,
        args: [nanoid(), founderId, String(existing.clerk_user_id), input.clerkUserId],
      },
    ]);
    return { founderId, action: 'rebound' };
  }

  const founderId = nanoid();
  await query(
    `INSERT INTO founders (id, clerk_user_id, email, name)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (clerk_user_id) DO NOTHING`,
    [founderId, input.clerkUserId, email, input.name]);
  const made = await query('SELECT id FROM founders WHERE clerk_user_id = ?', [input.clerkUserId]);
  return { founderId: String((made.rows[0] as Record<string, unknown>).id), action: 'created' };
}

/**
 * Every time the owner's sign-in moved to a new identity, newest first — what
 * the Settings page shows, so a rebind the owner did not expect is something
 * they can see rather than something only a database knows.
 */
export async function signInMoves(founderId: string): Promise<Array<{
  at: string; from: string; to: string;
}>> {
  const res = await query(
    `SELECT rebound_at, from_clerk_user_id, to_clerk_user_id
       FROM owner_identity_rebinds WHERE founder_id = ?
      ORDER BY rebound_at DESC, rowid DESC LIMIT 10`, [founderId]);
  return (res.rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    at: String(r.rebound_at), from: String(r.from_clerk_user_id), to: String(r.to_clerk_user_id),
  }));
}
