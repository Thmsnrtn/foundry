// =============================================================================
// FOUNDRY — the life of a credential
//
// Asked for, granted, stored, renewed, failing, revoked, gone. Every step is
// here rather than spread across a route, a sync job and a settings page,
// because the steps that go wrong are the ones between: a callback replayed, a
// scope granted narrower than the one requested, a renewal that failed being
// mistaken for a provider outage, a local delete reported as a revocation the
// provider never confirmed.
//
// THE OWNER NEVER MEETS ANY OF IT. He answers one question — "may I see your
// revenue?" — and everything in this file is what that costs. What he is told
// afterwards is what Foundry can now UNDERSTAND and what it still may not DO.
// =============================================================================

import { nanoid } from 'nanoid';
import { randomBytes } from 'node:crypto';
import { query } from '../../db/client.js';
import { decryptCredentialPayload, encryptCredentialPayload } from '../encryption.js';
import { SenseProviderError, senseProvider } from './providers/contract.js';
import { disclosureFor, offerFor, type SourceMode } from './index.js';

/** Long enough to sign in at a provider, short enough not to sit around. */
const AUTHORIZATION_MINUTES = 15;

/**
 * THE MINIMUM SCOPE, AND THE ONLY PLACE IT COMES FROM.
 *
 * Read from the constitutional table (migration 231) and passed to the adapter,
 * which has no other way to obtain one. "Minimum required scope" stops being a
 * promise the moment there is no parameter through which to ask for more.
 */
export async function requiredScopes(
  provider: string, senseKey: string, mode: SourceMode,
): Promise<Array<{ scope: string; because: string }>> {
  return ((await query(
    `SELECT scope, because FROM sense_provider_scopes
      WHERE provider = ? AND sense_key = ? AND mode = ?
      ORDER BY scope`, [provider, senseKey, mode]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    scope: String(r.scope), because: String(r.because),
  }));
}

export interface AuthorizationStart {
  state: string;
  authorizeUrl: string;
  scopes: Array<{ scope: string; because: string }>;
  disclosure: string;
}

export type StartFailure = { failed: true; ownerWords: string };

/**
 * Begin an authorisation.
 *
 * Refuses rather than guesses at every step where it could not be certain: an
 * offer nobody declared, a provider with no adapter, a provider/sense pair with
 * no declared scopes. Each refusal says what is missing in words the owner can
 * act on, because a button that leads to a provider error page is worse than a
 * button that is not there.
 */
export async function beginAuthorization(input: {
  productId: string; founderId: string; companyName: string;
  senseKey: string; provider: string; mode: SourceMode; redirectUri: string;
}): Promise<AuthorizationStart | StartFailure> {
  const offer = await offerFor(input.senseKey, input.provider, input.mode);
  if (!offer) {
    return { failed: true, ownerWords: 'I do not know that source for this' };
  }
  // SCOPES FIRST, AND THE ORDER IS THE GUARANTEE.
  //
  // GitHub has no read-only repository scope, so migration 232 left it with
  // none it could honestly request. If that refusal came from the adapter being
  // absent, it would disappear the day somebody wrote one — and the sense would
  // start asking for push access to read code. The rule has to be about what
  // can be granted, not about what happens to be implemented.
  const scopes = await requiredScopes(input.provider, input.senseKey, input.mode);
  if (scopes.length === 0) {
    return {
      failed: true,
      ownerWords: `there is no permission ${input.provider} could give me that `
        + 'would let me read this without also letting me change it, and I will '
        + 'not ask for that one',
    };
  }
  const adapter = await senseProvider(input.provider);
  if (!adapter) {
    return {
      failed: true,
      ownerWords: `I know ${input.provider} could tell me this, but I cannot ask `
        + 'it for permission yet',
    };
  }

  // 192 bits. A callback that could be reached by guessing a state is a door
  // anyone can knock on, and the whole point of the row is that only the person
  // who left can come back.
  const state = randomBytes(24).toString('base64url');
  const disclosure = disclosureFor(offer, input.companyName);

  let authorizeUrl: string;
  try {
    authorizeUrl = adapter.authorizeUrl({
      scopes: scopes.map((s) => s.scope), state, redirectUri: input.redirectUri,
    });
  } catch (err) {
    return {
      failed: true,
      ownerWords: err instanceof SenseProviderError ? err.ownerWords
        : 'I could not work out where to send you',
    };
  }

  await query(
    `INSERT INTO sense_authorizations
       (state, product_id, founder_id, sense_key, provider, mode, scopes_json,
        disclosure, expires_at)
     VALUES (?,?,?,?,?,?,?,?, datetime('now', ?))`,
    [state, input.productId, input.founderId, input.senseKey, input.provider,
      input.mode, JSON.stringify(scopes.map((s) => s.scope)), disclosure,
      `+${String(AUTHORIZATION_MINUTES)} minutes`]);

  return { state, authorizeUrl, scopes, disclosure };
}

export interface Connected {
  connected: true; senseId: string; senseKey: string; productId: string;
  grantedScopes: string[];
}
export type CompleteFailure = {
  connected: false; ownerWords: string; productId: string | null; recoverable: boolean;
};

/**
 * Finish it: he came back with a code.
 *
 * CONSUMED ONCE, EVER. The row is marked spent before the exchange, so a
 * replayed callback — the same code arriving twice, whether from a retry, a
 * back button or someone else — cannot bind a second credential. Marking it
 * after would leave a window exactly as wide as the provider's response time.
 */
export async function completeAuthorization(input: {
  state: string; code: string; founderId: string; redirectUri: string;
}): Promise<Connected | CompleteFailure> {
  // NO REALITY PREDICATE, DELIBERATELY. This reads no company answer: it
  // resolves ONE authorisation by a state only the person who started it could
  // have, and joins products solely for the name that goes in the disclosure.
  // Scoping it to real companies would strand the reference world — which is
  // made to travel this exact path so the lifecycle is proven before a real key
  // is asked for — and that is the one shape this predicate must never take.
  const row = (await query(
    `SELECT a.state, a.product_id, a.sense_key, a.provider, a.mode, a.scopes_json,
            a.disclosure, a.consumed_at, a.expires_at, p.name
       FROM sense_authorizations a
       JOIN products p ON p.id = a.product_id
      WHERE a.state = ? AND a.founder_id = ?`, [input.state, input.founderId]))
    .rows[0] as Record<string, unknown> | undefined;

  // A state nobody started, or somebody else's, answers the same: nothing is
  // revealed about whether it existed.
  if (!row) {
    return {
      connected: false, productId: null, recoverable: true,
      ownerWords: 'I do not have a record of that request. Start again and I '
        + 'will take you back.',
    };
  }
  const productId = String(row.product_id);
  if (row.consumed_at != null) {
    return {
      connected: false, productId, recoverable: true,
      ownerWords: 'that authorisation was already used.',
    };
  }

  await query(
    "UPDATE sense_authorizations SET consumed_at = datetime('now') WHERE state = ?",
    [input.state]);

  const expired = (await query(
    "SELECT datetime(?) <= datetime('now') AS gone", [String(row.expires_at)]))
    .rows[0] as Record<string, unknown>;
  if (Number(expired.gone) === 1) {
    return {
      connected: false, productId, recoverable: true,
      ownerWords: 'that took longer than I hold a request for. Start again.',
    };
  }

  const provider = String(row.provider);
  const senseKey = String(row.sense_key);
  const mode = String(row.mode) as SourceMode;
  const adapter = await senseProvider(provider);
  if (!adapter) {
    return {
      connected: false, productId, recoverable: false,
      ownerWords: `I can no longer ask ${provider} for anything.`,
    };
  }

  let granted;
  try {
    granted = await adapter.exchange({ code: input.code, redirectUri: input.redirectUri });
  } catch (err) {
    return {
      connected: false, productId,
      recoverable: err instanceof SenseProviderError ? err.recoverable : true,
      ownerWords: err instanceof SenseProviderError ? err.ownerWords
        : `${provider} did not complete the connection.`,
    };
  }

  // WHAT WAS GRANTED IS NOT ALWAYS WHAT WAS ASKED. A provider that hands back
  // less than the minimum leaves Foundry with a credential that cannot answer
  // the question it was obtained for — so the connection is refused rather than
  // made, and the owner is told which permission is missing instead of
  // discovering it as an empty page a week later.
  const asked = JSON.parse(String(row.scopes_json)) as string[];
  const missing = asked.filter((s) => !granted.grantedScopes.includes(s));
  if (missing.length > 0) {
    // Nothing was stored, so nothing needs revoking locally — but the provider
    // now holds a grant Foundry will not use, and leaving it is untidy at best.
    try { await adapter.revoke(granted.secret); } catch { /* said below */ }
    return {
      connected: false, productId, recoverable: true,
      ownerWords: `${provider} granted less than I need — ${missing.join(', ')} `
        + 'was not included — so I have not connected it.',
    };
  }

  const { connectSense } = await import('./index.js');
  const connected = await connectSense({
    productId, companyName: String(row.name), senseKey, provider, mode,
  });
  if (!connected) {
    try { await adapter.revoke(granted.secret); } catch { /* nothing to say */ }
    return {
      connected: false, productId, recoverable: true,
      ownerWords: 'I could not attach that here — something else may already be '
        + 'answering this question.',
    };
  }

  await query(
    `INSERT INTO sense_credentials
       (id, company_sense_id, product_id, provider, granted_scopes_json,
        secret_json, expires_at)
     VALUES (?,?,?,?,?,?,?)`,
    [nanoid(), connected.id, productId, provider,
      JSON.stringify(granted.grantedScopes),
      encryptCredentialPayload(JSON.stringify(granted.secret)),
      granted.expiresAt?.toISOString() ?? null]);

  return {
    connected: true, senseId: connected.id, senseKey, productId,
    grantedScopes: granted.grantedScopes,
  };
}

// ─── keeping it alive ────────────────────────────────────────────────────────

export interface CredentialState {
  id: string; provider: string; senseId: string;
  expiresAt: string | null; failures: number; lastFailure: string | null;
}

export async function credentialFor(senseId: string): Promise<CredentialState | null> {
  const row = (await query(
    `SELECT id, provider, company_sense_id, expires_at, failures, last_failure
       FROM sense_credentials WHERE company_sense_id = ? AND revoked_at IS NULL`,
    [senseId])).rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id), provider: String(row.provider),
    senseId: String(row.company_sense_id),
    expiresAt: row.expires_at == null ? null : String(row.expires_at),
    failures: Number(row.failures), lastFailure:
      row.last_failure == null ? null : String(row.last_failure),
  };
}

async function secretOf(credentialId: string): Promise<Record<string, unknown> | null> {
  const row = (await query(
    'SELECT secret_json FROM sense_credentials WHERE id = ? AND revoked_at IS NULL',
    [credentialId])).rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const plain = decryptCredentialPayload(String(row.secret_json));
  return plain === null ? null : JSON.parse(plain) as Record<string, unknown>;
}

export interface RenewalOutcome {
  renewed: number; nothingToDo: number; failed: number;
  broke: Array<{ productId: string; provider: string; why: string }>;
}

/**
 * Renew what is close to expiring, and notice what has died.
 *
 * A FAILURE HERE IS A SENSE GOING BLIND, and it is written where the owner
 * reads it — `company_senses.last_error` — because the company page must say
 * "I have stopped being able to see this" BEFORE it shows anything derived from
 * what that sense last said. Presenting stale numbers with a confident face is
 * the failure mode this whole path exists to prevent.
 *
 * `null` from an adapter means the credential does not expire. That is not a
 * failure and is not counted as one; conflating them would make a healthy
 * connection look broken on every run.
 */
export async function renewCredentials(withinHours = 24): Promise<RenewalOutcome> {
  const due = (await query(
    `SELECT c.id, c.provider, c.product_id, c.company_sense_id
       FROM sense_credentials c
       JOIN company_senses s ON s.id = c.company_sense_id
      WHERE c.revoked_at IS NULL AND s.disconnected_at IS NULL
        AND (c.expires_at IS NULL
             OR datetime(c.expires_at) <= datetime('now', ?))
      ORDER BY c.rowid`, [`+${String(withinHours)} hours`]))
    .rows as unknown as Array<Record<string, unknown>>;

  const outcome: RenewalOutcome = { renewed: 0, nothingToDo: 0, failed: 0, broke: [] };
  for (const row of due) {
    const credentialId = String(row.id);
    const provider = String(row.provider);
    const adapter = await senseProvider(provider);
    const secret = await secretOf(credentialId);
    if (!adapter || !secret) { outcome.failed += 1; continue; }

    try {
      const renewed = await adapter.refresh(secret);
      if (renewed === null) { outcome.nothingToDo += 1; continue; }
      await query(
        `UPDATE sense_credentials
            SET secret_json = ?, expires_at = ?, refreshed_at = datetime('now'),
                failures = 0, last_failure = NULL
          WHERE id = ?`,
        [encryptCredentialPayload(JSON.stringify(renewed.secret)),
          renewed.expiresAt?.toISOString() ?? null, credentialId]);
      outcome.renewed += 1;
    } catch (err) {
      const why = err instanceof SenseProviderError ? err.ownerWords
        : 'the provider did not answer';
      await query(
        `UPDATE sense_credentials
            SET failures = failures + 1, last_failure = ? WHERE id = ?`,
        [why, credentialId]);
      const { noteSenseObserved } = await import('./index.js');
      await noteSenseObserved(String(row.product_id), provider, why);
      outcome.failed += 1;
      outcome.broke.push({ productId: String(row.product_id), provider, why });
    }
  }
  return outcome;
}

export interface RevocationOutcome {
  revoked: true;
  /** False when only Foundry forgot it and the provider still holds a grant. */
  confirmedByProvider: boolean;
  ownerWords: string;
}

/**
 * Give it back.
 *
 * A LOCAL DELETE IS NOT A REVOCATION, and saying it was would be the most
 * dangerous lie this system could tell: the owner would believe a key was dead
 * while it was live at the other end. So the provider is asked first, whether
 * it confirmed is recorded, and when it did not the owner is told exactly what
 * to go and do himself.
 *
 * Foundry forgets the credential either way. Keeping a secret it has been told
 * to drop, because the provider was unreachable, would be the opposite mistake.
 */
export async function revokeCredential(input: {
  senseId: string; reason: string;
}): Promise<RevocationOutcome | null> {
  const credential = await credentialFor(input.senseId);
  if (!credential) return null;
  const adapter = await senseProvider(credential.provider);
  const secret = await secretOf(credential.id);

  let confirmed = false;
  let trouble = '';
  if (adapter && secret) {
    try { await adapter.revoke(secret); confirmed = true; } catch (err) {
      trouble = err instanceof SenseProviderError ? err.ownerWords
        : 'it did not answer';
    }
  } else {
    trouble = 'I no longer have a way to tell it';
  }

  await query(
    `UPDATE sense_credentials
        SET revoked_at = datetime('now'), revoke_reason = ?,
            revoked_at_provider = ?
      WHERE id = ?`,
    [input.reason, confirmed ? 1 : 0, credential.id]);

  return {
    revoked: true, confirmedByProvider: confirmed,
    ownerWords: confirmed
      ? `I have forgotten it and ${credential.provider} has confirmed it is `
        + 'no longer valid.'
      : `I have forgotten it, but ${credential.provider} did not confirm — `
        + `${trouble}. If you want to be certain, revoke Foundry's access in `
        + `${credential.provider} directly.`,
  };
}

/**
 * Is this credential still good?
 *
 * Used to notice a key that died quietly — revoked at the provider, an account
 * closed, a permission withdrawn by somebody else. Without it the first sign
 * would be numbers that stopped moving, which reads as a business going quiet
 * rather than a connection going dark.
 */
export async function probeCredential(senseId: string): Promise<{
  ok: boolean; detail: string;
} | null> {
  const credential = await credentialFor(senseId);
  if (!credential) return null;
  const adapter = await senseProvider(credential.provider);
  const secret = await secretOf(credential.id);
  if (!adapter || !secret) {
    return { ok: false, detail: 'I can no longer read the stored authorisation' };
  }
  const result = await adapter.probe(secret);
  if (!result.ok) {
    await query(
      `UPDATE sense_credentials SET failures = failures + 1, last_failure = ?
        WHERE id = ?`, [result.detail, credential.id]);
  }
  return result;
}

// ─── what the owner can see about the key itself ─────────────────────────────

/**
 * WHAT FOUNDRY ACTUALLY HOLDS.
 *
 * He agreed to a sentence — "it reads charges and subscriptions, and would not
 * let me move money". This is the check on that sentence: the permission the
 * provider actually granted, and when the authorisation was last renewed. If
 * those ever diverge from what he was told, he should be able to see it rather
 * than take the sentence on trust for a year.
 */
export interface CredentialHealth {
  senseId: string; provider: string;
  grantedScopes: string[];
  renewedAt: string | null;
  expiresAt: string | null;
  failures: number;
}

export async function credentialHealthFor(
  productId: string,
): Promise<CredentialHealth[]> {
  return ((await query(
    `SELECT c.company_sense_id, c.provider, c.granted_scopes_json,
            c.refreshed_at, c.expires_at, c.failures
       FROM sense_credentials c
       JOIN company_senses s ON s.id = c.company_sense_id
      WHERE c.product_id = ? AND c.revoked_at IS NULL AND s.disconnected_at IS NULL
      ORDER BY c.rowid`, [productId]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    senseId: String(r.company_sense_id), provider: String(r.provider),
    grantedScopes: JSON.parse(String(r.granted_scopes_json)) as string[],
    renewedAt: r.refreshed_at == null ? null : String(r.refreshed_at).slice(0, 10),
    expiresAt: r.expires_at == null ? null : String(r.expires_at).slice(0, 10),
    failures: Number(r.failures),
  }));
}

/**
 * WHAT HE MAY STILL NEED TO GO AND DO HIMSELF.
 *
 * A disconnection the provider never confirmed leaves a grant alive at the
 * other end. He is told at the moment it happens — and a banner he scrolled
 * past is not a record, so it is also here, on the company, until he has dealt
 * with it. This is the one piece of credential bookkeeping that is genuinely
 * his problem rather than Foundry's.
 */
export interface UnconfirmedRevocation {
  provider: string; when: string; reason: string;
}

export async function unconfirmedRevocations(
  productId: string,
): Promise<UnconfirmedRevocation[]> {
  return ((await query(
    `SELECT provider, revoked_at, revoke_reason FROM sense_credentials
      WHERE product_id = ? AND revoked_at IS NOT NULL AND revoked_at_provider = 0
      ORDER BY revoked_at DESC`, [productId]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    provider: String(r.provider), when: String(r.revoked_at).slice(0, 10),
    reason: String(r.revoke_reason),
  }));
}
