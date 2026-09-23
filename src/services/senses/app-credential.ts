// =============================================================================
// FOUNDRY — the key that says which application this is
//
// An application credential identifies THIS DEPLOYMENT to a provider. It grants
// access to nobody's account: connecting a shop is a separate act, with its own
// consent screen and its own scopes, and this key is only what lets the
// institution ask for one.
//
// VERIFIED BEFORE IT IS KEPT, which is the convention the sending identity
// established and the reason it is worth copying. `setSendingIdentity` will not
// store a Resend key until Resend confirms the domain, because "the owner typed
// something" and "the provider accepts it" are different facts and only the
// second is worth keeping. Etsy has an endpoint for exactly this:
// `openapi-ping` takes an `x-api-key` and no OAuth token, costs nothing, causes
// nothing, and answers with the application id — so a mistyped pair is refused
// in the owner's hands rather than discovered at his consent screen.
//
// THE PLAINTEXT DOES NOT OUTLIVE THE REQUEST. It arrives, it is verified, it is
// encrypted, and what is returned to the caller says whether it worked and
// nothing else. No log line, no error message and no owner-facing sentence in
// this file contains the key.
// =============================================================================

import { query } from '../../db/client.js';
import { encrypt, decrypt } from '../encryption.js';
import { safeFetch } from '../outbound/ssrf.js';

/** Etsy's key is a pair; the header wants them joined and the client id wants one. */
export interface EtsyAppKey { keystring: string; sharedSecret: string }

export interface AppCredential {
  provider: string;
  secret: Record<string, string>;
  /** What the provider said this key is — Etsy's `application_id`. */
  providerAccountRef: string;
  verifiedAt: string;
  setAt: string;
}

export type PlacementFailure = { failed: true; ownerWords: string };

/** `x-api-key` for Etsy v3: the keystring and the shared secret, joined by a colon. */
export const etsyApiKeyHeader = (k: EtsyAppKey): string => `${k.keystring}:${k.sharedSecret}`;

/**
 * DOES THE PROVIDER ACCEPT THIS KEY. A read, with no token and no side effect.
 *
 * Etsy's documented validation endpoint. It is the whole reason the owner can
 * be told "that pair is wrong" while he still has it in front of him, instead
 * of being sent to a consent screen that will fail for a reason neither of us
 * can see from here.
 */
async function askEtsyWhoThisIs(key: EtsyAppKey): Promise<{ applicationId: string } | PlacementFailure> {
  let res: Response;
  try {
    res = await safeFetch('https://openapi.etsy.com/v3/application/openapi-ping', {
      headers: { 'x-api-key': etsyApiKeyHeader(key), accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { failed: true, ownerWords: 'I could not reach Etsy to check that key just now — nothing has been stored' };
  }
  if (res.status === 401 || res.status === 403) {
    return {
      failed: true,
      ownerWords: 'Etsy does not accept that keystring and shared secret. Check both are copied whole '
        + 'from the Seller Apps page — nothing has been stored',
    };
  }
  if (!res.ok) {
    return { failed: true, ownerWords: `Etsy answered ${String(res.status)} when I checked that key — nothing has been stored` };
  }
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  const id = body.application_id;
  if (id === undefined || id === null || String(id).trim() === '') {
    return {
      failed: true,
      ownerWords: 'Etsy answered, but did not say which application that key belongs to — nothing has been stored',
    };
  }
  return { applicationId: String(id) };
}

/**
 * PLACE A KEY, ONCE IT IS KNOWN TO WORK.
 *
 * Replaces whatever stood for that provider, which is what rotation is: the
 * same row rewritten, with a fresh verification and a fresh date. Nothing is
 * written on a failure, so a wrong pair leaves the working one in place.
 */
export async function setAppCredential(input: {
  provider: 'etsy'; secret: EtsyAppKey; by: string;
}): Promise<{ placed: true; providerAccountRef: string } | PlacementFailure> {
  const keystring = input.secret.keystring.trim();
  const sharedSecret = input.secret.sharedSecret.trim();
  if (!keystring || !sharedSecret) {
    return { failed: true, ownerWords: 'both the keystring and the shared secret are needed; Etsy checks the pair' };
  }
  // A PAIR PASTED WHOLE, WITH THE COLON STILL IN IT, is the likeliest slip:
  // Etsy shows them side by side and its own examples join them. Saying so
  // beats a refusal from Etsy that reads as a wrong key.
  if (keystring.includes(':')) {
    return {
      failed: true,
      ownerWords: 'the keystring field has a colon in it — paste the keystring and the shared secret '
        + 'into their own boxes rather than the joined form Etsy shows in its examples',
    };
  }

  const who = await askEtsyWhoThisIs({ keystring, sharedSecret });
  if ('failed' in who) return who;

  const verifiedAt = new Date().toISOString();
  const secretJson = encrypt(JSON.stringify({ keystring, sharedSecret }));
  await query(
    `INSERT INTO app_credentials (provider, secret_json, provider_account_ref, verified_at, set_by)
     VALUES (?,?,?,?,?)
     ON CONFLICT(provider) DO UPDATE SET
       secret_json = excluded.secret_json,
       provider_account_ref = excluded.provider_account_ref,
       verified_at = excluded.verified_at,
       set_at = datetime('now'),
       set_by = excluded.set_by,
       forgotten_at = NULL,
       forget_reason = NULL`,
    [input.provider, secretJson, who.applicationId, verifiedAt, input.by]);
  return { placed: true, providerAccountRef: who.applicationId };
}

/**
 * THE WHOLE RECORD OF A PLACEMENT, AND NOTHING OF THE SECRET.
 *
 * WHY THIS EXISTS. The owner asked me to reconcile a discrepancy: I had once
 * reported his application credentials verified and saved, and later reported
 * that no key was placed. Neither statement was something I could establish.
 * I cannot authenticate to production, so I could not read this table either
 * time; the first claim was repeating what the act was supposed to do, and
 * the later ones hardened "nothing in this session placed one" into "no key
 * is placed", which is a different sentence about a system I was not reading.
 *
 * The fix is not for me to guess more carefully. It is for the institution to
 * answer the question where the owner is already standing, from the row, with
 * the dates on it — so the answer does not depend on anybody's memory of what
 * was done in a chat window.
 *
 * Forgotten keys are included on purpose. A key that was placed and then
 * removed is a different history from one that never existed, and showing
 * only the living row makes them look identical.
 */
export interface PlacementRecord {
  provider: string;
  /** The provider's own id for the application. Never a secret. */
  applicationId: string;
  /** When the PROVIDER last confirmed the pair. Not when it was typed. */
  verifiedAt: string;
  setAt: string;
  setBy: string;
  forgottenAt: string | null;
  forgetReason: string | null;
}

export async function placementRecord(provider: string): Promise<PlacementRecord | null> {
  const row = (await query(
    `SELECT provider, provider_account_ref, verified_at, set_at, set_by,
            forgotten_at, forget_reason
       FROM app_credentials WHERE provider = ?`, [provider]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    provider: String(row.provider),
    applicationId: String(row.provider_account_ref),
    verifiedAt: String(row.verified_at),
    setAt: String(row.set_at),
    setBy: String(row.set_by),
    forgottenAt: row.forgotten_at == null ? null : String(row.forgotten_at),
    forgetReason: row.forget_reason == null ? null : String(row.forget_reason),
  };
}

/**
 * ASK THE PROVIDER AGAIN, NOW.
 *
 * `verified_at` records when Etsy last confirmed the pair, which may be weeks
 * ago and says nothing about whether the key still works — a key can be
 * revoked at Etsy without anything here noticing. This re-asks, using the same
 * free, read-only, no-OAuth ping the placement used, and writes the answer
 * down. It changes no secret and grants nothing; the worst it can do is
 * discover that a key stopped working, which is the point.
 */
export async function recheckAppCredential(provider: string):
Promise<{ ok: true; applicationId: string; at: string } | PlacementFailure> {
  const held = await appCredentialFor(provider);
  if (!held) return { failed: true, ownerWords: 'There is no key to check.' };
  if (provider !== 'etsy') {
    return { failed: true, ownerWords: `I have no way to check a ${provider} key.` };
  }
  const key = await etsyAppKey();
  if (!key) return { failed: true, ownerWords: 'There is no key to check.' };
  const who = await askEtsyWhoThisIs(key);
  if ('failed' in who) return who;
  const at = new Date().toISOString();
  await query(
    `UPDATE app_credentials SET verified_at = ?, provider_account_ref = ?
      WHERE provider = ? AND forgotten_at IS NULL`, [at, who.applicationId, provider]);
  return { ok: true, applicationId: who.applicationId, at };
}

/**
 * WHICH APPLICATION IS PLACED, WITHOUT OPENING THE ENVELOPE.
 *
 * A surface that only has to say "the key is placed, and Etsy calls it
 * 12345678" was reaching for `appCredentialFor`, which decrypts both halves to
 * answer a question neither half is needed for. Every decryption is a moment
 * the plaintext exists in this process, and a moment it could be logged, put
 * in an error, or read off a heap dump. So the cheap question gets a cheap
 * answer: the provider's own public id for the application, straight off the
 * row, and nothing else.
 *
 * Null means no key is placed, which is the same null the decrypting reader
 * returns — the two answers cannot disagree about whether there is one.
 */
export async function placedApplicationRef(provider: string): Promise<string | null> {
  const row = (await query(
    `SELECT provider_account_ref FROM app_credentials
      WHERE provider = ? AND forgotten_at IS NULL`, [provider]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const ref = row.provider_account_ref;
  return ref == null ? null : String(ref);
}

/** The key this deployment holds for a provider, or null. Decrypts on the way out. */
export async function appCredentialFor(provider: string): Promise<AppCredential | null> {
  const row = (await query(
    `SELECT provider, secret_json, provider_account_ref, verified_at, set_at
       FROM app_credentials WHERE provider = ? AND forgotten_at IS NULL`, [provider]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  let secret: Record<string, string>;
  try {
    secret = JSON.parse(decrypt(String(row.secret_json))) as Record<string, string>;
  } catch {
    // A KEY THAT CANNOT BE DECRYPTED IS NOT A KEY. It happens when
    // `ENCRYPTION_KEY` has moved without the rotation runbook being run, and
    // reporting it as absent is the honest answer: the institution genuinely
    // cannot use it.
    return null;
  }
  return {
    provider: String(row.provider), secret,
    providerAccountRef: String(row.provider_account_ref),
    verifiedAt: String(row.verified_at), setAt: String(row.set_at),
  };
}

/** The Etsy pair, in the shape the adapter and the reader both want. */
export async function etsyAppKey(): Promise<EtsyAppKey | null> {
  const c = await appCredentialFor('etsy');
  if (!c) return null;
  const keystring = c.secret.keystring ?? '';
  const sharedSecret = c.secret.sharedSecret ?? '';
  return keystring && sharedSecret ? { keystring, sharedSecret } : null;
}

/** Forget it here. A reason is required, as everywhere else that forgets something. */
export async function forgetAppCredential(provider: string, reason: string): Promise<void> {
  await query(
    `UPDATE app_credentials SET forgotten_at = datetime('now'), forget_reason = ?
      WHERE provider = ? AND forgotten_at IS NULL`, [reason, provider]);
}
