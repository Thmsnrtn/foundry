// =============================================================================
// ASK EVERY LIVE CONNECTION WHOSE IT IS, AND SAY SO WHEN THE ANSWER CHANGES.
//
// TWO PROBLEMS, ONE PASS, because they are the same question asked at two
// moments and splitting them would give the institution two answers about who
// a connection belongs to.
//
//   RECOVERY. `completeAuthorization` reads the account back at the moment of
//   connection — but only since migration 346. Every connection made before
//   that carries a live credential and no identity at all, so the owner is
//   shown a connection nothing can name and has nothing to recognise. He
//   cannot recognise what has not been read.
//
//   DISAGREEMENT. A connection recognised in March can be answering with a
//   different account in November: a token replaced out of band, a grant
//   re-issued against another shop, an account switched at the provider. The
//   owner: "Foundry must not silently continue operating under the previous
//   recognition."
//
// WHAT THIS IS ALLOWED TO CONCLUDE, AND WHAT IT IS NOT.
//
//   A PROBE IS AN IDENTITY READ, NOT AN OPERATION. The owner's boundary says
//   an unrecognised connection may not act, and in the same breath: "The system
//   should still permit the minimum identity-establishing reads necessary to
//   present the correct account for recognition." That is exactly this and
//   nothing more — `adapter.probe`, which asks who this is and changes nothing
//   at the other end.
//
//   RECOVERY IS NOT RECOGNITION. Recovering an identity writes `346`'s three
//   columns and never `347`'s two. A connection that has been in place for a
//   year, has worked perfectly, and whose account name matches what the owner
//   expects is STILL unrecognised afterwards, because none of those facts is
//   him saying so. The owner was explicit: "Do not automatically interpret an
//   existing credential, successful historical operation, matching account
//   name, or historical connection record as evidence of owner recognition."
//
//   SILENCE IS NOT AN ACCUSATION. A provider that does not answer has said
//   nothing about whose account this is. Converting every outage into "your
//   shop may have changed" would stop real work on no evidence and teach the
//   owner to dismiss the one alarm that matters. An unreachable provider leaves
//   the connection exactly as it was.
//
//   AN UNPARSEABLE ANSWER IS NOT AN IDENTITY. `identityFromProbe` yields a null
//   reference rather than a guess, and a null reference writes nothing. An
//   incomplete recovery is reported as incomplete; it is never reported as a
//   recognised account, which would be the one failure that makes every
//   downstream boundary meaningless.
//
// NOTHING HERE DECIDES ANYTHING. It reads the world, writes what the world
// said into the columns that already exist for it, and leaves every judgement
// to the owner and every refusal to the gate that already refuses.
// =============================================================================

import { query } from '../../db/client.js';
import { log } from '../../lib/logger.js';
import { identityFromProbe, probeCredential } from './credentials.js';

/**
 * What one connection turned out to be. Seven outcomes rather than a boolean,
 * because "it did not work" covers a provider being down, a provider naming
 * somebody else's shop, and a provider answering in a shape we cannot read —
 * and those want three different things from the owner, one of which is
 * nothing at all.
 */
export type IdentityOutcome =
  /** Had no identity; the provider named one. Recorded, and awaiting his word. */
  | 'recovered'
  /** Same account, same name. The ordinary case, and it costs him nothing. */
  | 'unchanged'
  /** Same account, new display name. A rename is a fact, not a failure. */
  | 'renamed'
  /** The provider named a DIFFERENT account. Recorded; not applied. */
  | 'disputed'
  /** A standing disagreement ended: the recognised account is named again. */
  | 'resolved'
  /** The provider answered and named nothing this can read. Nothing written. */
  | 'unnamed'
  /** The provider did not answer, or the authorisation is no longer usable. */
  | 'unavailable';

export interface IdentityFinding {
  senseId: string;
  productId: string;
  provider: string;
  outcome: IdentityOutcome;
  /** The account the provider named this time, when it named one. */
  observedRef: string | null;
  /** What the owner would be told, in his words rather than the schema's. */
  ownerWords: string;
}

export interface IdentityPassOutcome {
  looked: number;
  findings: IdentityFinding[];
}

/**
 * THE CONNECTIONS THIS MAY ASK ABOUT: live sense, live credential.
 *
 * A disconnected sense is history and is never probed — its credential is
 * revoked, and asking would be using an authorisation the owner withdrew. A
 * revoked credential is the same fact from the other side. Neither is a
 * candidate for recovery, and both keep whatever identity they had, because
 * the historical record of what a grant reached is exactly what an incident
 * reconstruction needs.
 */
const LIVE = `FROM company_senses s
   JOIN sense_credentials c ON c.company_sense_id = s.id AND c.revoked_at IS NULL
  WHERE s.disconnected_at IS NULL`;

export async function recoverIdentities(opts: {
  /** One company, or every company when absent. */
  productId?: string;
  /** One provider, or every provider when absent. */
  provider?: string;
} = {}): Promise<IdentityPassOutcome> {
  const where: string[] = [];
  const args: string[] = [];
  if (opts.productId) { where.push('AND s.product_id = ?'); args.push(opts.productId); }
  if (opts.provider) { where.push('AND lower(s.provider) = lower(?)'); args.push(opts.provider); }

  const live = (await query(
    `SELECT s.id, s.product_id, s.provider, s.provider_account_ref,
            s.provider_account_label, s.identity_verified_at,
            s.identity_confirmed_at, s.identity_disputed_ref
       ${LIVE} ${where.join(' ')} ORDER BY s.rowid`, args))
    .rows as unknown as Array<Record<string, unknown>>;

  const findings: IdentityFinding[] = [];
  for (const row of live) {
    findings.push(await lookAt(row));
  }
  return { looked: live.length, findings };
}

/** One connection, asked who it is. */
async function lookAt(row: Record<string, unknown>): Promise<IdentityFinding> {
  const senseId = String(row.id);
  const productId = String(row.product_id);
  const provider = String(row.provider);
  const heldRef = row.provider_account_ref == null ? null : String(row.provider_account_ref);
  const heldLabel = row.provider_account_label == null ? null : String(row.provider_account_label);
  const disputedRef = row.identity_disputed_ref == null ? null : String(row.identity_disputed_ref);
  const say = (outcome: IdentityOutcome, observedRef: string | null, ownerWords: string): IdentityFinding =>
    ({ senseId, productId, provider, outcome, observedRef, ownerWords });

  // THE EXISTING PROBE, NOT A SECOND ONE. `probeCredential` decrypts through
  // the one path secrets leave by, records a failure against the credential
  // when the provider refuses, and returns the provider's own sentence. A
  // second implementation here would be a second place a credential is read.
  let probe: { ok: boolean; detail: string } | null;
  try {
    probe = await probeCredential(senseId);
  } catch (err) {
    // A throw is the provider being unreachable, not the account changing.
    return say('unavailable', null,
      `I could not ask ${provider} which account this reaches: ${
        err instanceof Error ? err.message : 'it did not answer'}`);
  }
  if (probe === null) {
    return say('unavailable', null,
      `this connection no longer holds an authorisation I can use`);
  }
  if (!probe.ok) {
    return say('unavailable', null,
      `${provider} did not answer when I asked which account this reaches: ${probe.detail}`);
  }

  const named = identityFromProbe(probe.detail);
  if (named.ref == null) {
    // Answered, and said nothing this can hold on to. Recorded as incomplete
    // rather than dressed up: a guessed reference is worse than none, because
    // the next reader has no way of knowing it was invented here.
    return say('unnamed', null,
      `${provider} answered, and did not name an account I can record: ${probe.detail}`);
  }

  // ── it named one, and we held none ──────────────────────────────────────
  if (heldRef == null) {
    await query(
      `UPDATE company_senses
          SET provider_account_ref = ?, provider_account_label = ?,
              identity_verified_at = datetime('now')
        WHERE id = ?`, [named.ref, named.label, senseId]);
    log.info('sense identity recovered', { senseId, provider });
    return say('recovered', named.ref,
      `${provider} says this opens ${named.label ?? named.ref}. I have recorded that, `
      + 'and it is not the same as you telling me it is the one you meant.');
  }

  // ── it named the one we hold ────────────────────────────────────────────
  if (named.ref === heldRef) {
    if (disputedRef != null) {
      // AUTONOMOUS, AND IT GRANTS NOTHING. The recognition this stood in front
      // of was never touched, so what resumes is exactly what he recognised.
      await query(
        `UPDATE company_senses
            SET identity_disputed_at = NULL, identity_disputed_ref = NULL,
                identity_disputed_detail = NULL
          WHERE id = ?`, [senseId]);
      const { noteSenseObserved } = await import('./index.js');
      await noteSenseObserved(productId, provider, null);
      log.info('sense identity dispute resolved', { senseId, provider });
      return say('resolved', named.ref,
        `${provider} is naming ${named.label ?? named.ref} again — the account you `
        + 'recognised. Nothing needs you; I have taken the hold off.');
    }
    if (named.label != null && named.label !== heldLabel) {
      // A rename is a fact, not a failure, and 346 permits the label to move
      // while the reference cannot. Recognition survives untouched, which is
      // the point: the owner renamed this shop once already.
      await query(
        'UPDATE company_senses SET provider_account_label = ? WHERE id = ?',
        [named.label, senseId]);
      return say('renamed', named.ref,
        `the same account, now called ${named.label}. Still the shop you recognised.`);
    }
    return say('unchanged', named.ref, `${provider} names the account you recognised.`);
  }

  // ── it named somebody else ──────────────────────────────────────────────
  //
  // NOT WRITTEN OVER. 346's `immutable_once_set` would refuse it anyway, and
  // that refusal is correct: a connection does not become a connection to a
  // different account by an UPDATE. What was missing was anywhere to put the
  // disagreement, which is what 348's columns are.
  if (disputedRef !== named.ref) {
    await query(
      `UPDATE company_senses
          SET identity_disputed_at = datetime('now'), identity_disputed_ref = ?,
              identity_disputed_detail = ?
        WHERE id = ?`, [named.ref, probe.detail, senseId]);
    const { noteSenseObserved } = await import('./index.js');
    // Written where the company page already looks, so nothing derived from
    // this connection is presented with a confident face while the provider
    // and the record disagree about whose account it is.
    await noteSenseObserved(productId, provider,
      `${provider} is naming a different account (${named.label ?? named.ref}) than the `
      + 'one recorded for this connection');
    log.warn('sense identity disputed', { senseId, provider });
  }
  return say('disputed', named.ref,
    `${provider} now says this reaches ${named.label ?? named.ref}, and the account `
    + `recorded for this connection is ${heldLabel ?? heldRef}. I have stopped acting `
    + 'through it. Nothing has been changed on your behalf.');
}

/**
 * IS THIS CONNECTION IN DISPUTE — the one reader, for the gate and the page.
 *
 * Returns the provider's words when there is a disagreement, null when there
 * is not. A second way of asking this question is how one surface ends up
 * saying a connection is fine while another says it is not.
 */
export interface Dispute { observedRef: string; detail: string; since: string }

export async function disputeOn(senseId: string): Promise<Dispute | null> {
  const row = (await query(
    `SELECT identity_disputed_at, identity_disputed_ref, identity_disputed_detail
       FROM company_senses WHERE id = ?`, [senseId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!row || row.identity_disputed_at == null) return null;
  return {
    observedRef: String(row.identity_disputed_ref),
    detail: String(row.identity_disputed_detail),
    since: String(row.identity_disputed_at),
  };
}
