// =============================================================================
// FOUNDRY — Etsy, as a sense
//
// REAL, AND NOT YET USED, exactly as the Stripe adapter was written and for the
// same reason: the day the owner connects a shop should be a day nothing new is
// discovered about how the system should work. Not one request in this file has
// had a reply. Every shape in it comes from Etsy's published Open API v3
// documentation, read on 22 September 2026, and is marked where it is assumed.
//
// WHAT IT ASKS FOR AND CANNOT WIDEN. `shops_r`, `listings_r`, `transactions_r`
// — the three read scopes the constitutional table declares (migration 338),
// handed in rather than chosen here. There is no `listings_w` anywhere in this
// file. Creating a draft, uploading a file and activating a listing are
// capabilities behind the outbound door, judged one at a time by their own
// rungs; a credential that could publish would make that judgement optional.
//
// PKCE IS MANDATORY HERE, which is why the contract grew a code challenge.
// Etsy's documentation: "The Etsy Open API requires a PKCE on every
// authorization flow request." The verifier lives on the single-use
// authorization row and never leaves it.
//
// THE SHOP IS VERIFIED, NEVER ASSUMED. The owner renamed his shop from
// Printbls4YouStudio to ApexMicro. A rename changes a display name and a public
// URL; it does not change a shop id, and it does not tell this institution
// which shop a credential actually belongs to. So the identity comes back from
// `getMe` and `getShop` at exchange time and is recorded as what the account
// says it is. Nothing here hard-codes a shop name, and `probe` re-reads it, so
// a shop renamed again — or a credential that turns out to belong to a
// different shop entirely — is a fact this institution notices rather than a
// mismatch it carries silently.
//
// THE APPLICATION KEY IS HANDED IN, NOT FETCHED. This file read
// `process.env.ETSY_API_KEY` — the one thing in it the adapter chose for
// itself, while its scopes were handed to it precisely so it could not. The
// owner places the key through the institution's own surface now, verified
// against Etsy before it is kept, and this adapter has no way to obtain one it
// was not given. Without a key it refuses to build an authorize URL and says so
// in words he can act on, rather than sending him to a page that will reject him.
//
// TWO THINGS IN HERE WERE WRONG AGAINST ETSY'S PUBLISHED CONTRACT, and finding
// them before he connected anything is the entire reason this adapter was
// written before it was needed. `x-api-key` carries the keystring AND the
// shared secret joined by a colon, not the keystring alone; and the token
// request is form-encoded, not JSON. Every call would have been refused.
// =============================================================================

import {
  SenseProviderError, registerSenseProvider,
  type GrantedCredential, type SenseProviderAdapter,
} from './contract.js';
import { safeFetch } from '../../outbound/ssrf.js';
import { etsyApiKeyHeader, type EtsyAppKey } from '../app-credential.js';

const AUTHORIZE = 'https://www.etsy.com/oauth/connect';
const TOKEN = 'https://api.etsy.com/v3/public/oauth/token';
const API = 'https://openapi.etsy.com/v3/application';

/**
 * THE APPLICATION, HANDED IN RATHER THAN FETCHED.
 *
 * This read `process.env.ETSY_API_KEY` — the one thing in this adapter it chose
 * for itself, while its scopes were handed to it precisely so it could not.
 * The owner now places the key through the institution's own surface, so it
 * arrives the same way the scopes do and this file has no way to obtain one it
 * was not given.
 */
function appKey(given: Record<string, string> | null): EtsyAppKey {
  const keystring = (given?.keystring ?? '').trim();
  const sharedSecret = (given?.sharedSecret ?? '').trim();
  if (!keystring || !sharedSecret) {
    throw new SenseProviderError({
      ownerWords: 'this deployment has no Etsy application key yet, so I cannot ask '
        + 'Etsy for permission to read your shop',
      recoverable: false,
    });
  }
  return { keystring, sharedSecret };
}

/**
 * ETSY ANSWERS 200 WITH AN ERROR BODY OFTEN ENOUGH THAT STATUS ALONE IS NOT THE
 * TEST. Both are checked, and neither the raw body nor the token ever reaches
 * the owner's words.
 *
 * THROUGH `safeFetch`, THOUGH THIS FILE COULD HAVE CLAIMED AN EXEMPTION. Every
 * host here is compiled in and the only value that reaches a path is a shop id
 * Etsy itself returned, percent-encoded — so nothing a founder supplies chooses
 * a destination, which is the exemption the sibling Stripe adapter takes. It is
 * deliberately not taken: `safeFetch` re-screens every redirect hop for SSRF
 * AND, since a review found that screening an address is not the same as
 * deciding who may hold a credential, drops `Authorization` and the api key
 * when a hop changes origin. An adapter that carries a bearer token should not
 * hand it to wherever a provider's redirect points.
 */
async function call(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await safeFetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new SenseProviderError({
      ownerWords: 'I could not reach Etsy just now', recoverable: true,
    });
  }
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try { body = text ? (JSON.parse(text) as Record<string, unknown>) : {}; } catch { body = {}; }
  if (!res.ok) {
    throw new SenseProviderError({
      // 401 and 403 mean the grant is gone or was never enough; retrying those
      // is asking the same question again and getting the same answer.
      ownerWords: res.status === 401 || res.status === 403
        ? 'Etsy would not accept the connection; it needs granting again'
        : `Etsy answered ${String(res.status)}`,
      recoverable: res.status !== 401 && res.status !== 403,
    });
  }
  return body;
}

/**
 * ETSY WANTS BOTH HALVES OF THE APPLICATION KEY IN ONE HEADER. Its
 * documentation: "Every request to a v3 endpoint must include an `x-api-key`
 * header containing your keystring and shared secret separated by a colon."
 *
 * This sent the keystring alone. Every call would have been refused — found by
 * reading Etsy's own contract before the owner connected anything, which is the
 * entire reason this adapter was written before it was needed.
 */
const auth = (accessToken: string, key: EtsyAppKey): Record<string, string> => ({
  'x-api-key': etsyApiKeyHeader(key), Authorization: `Bearer ${accessToken}`,
});

/**
 * WHOSE SHOP THIS CREDENTIAL ACTUALLY OPENS. `getMe` returns the user and the
 * shop the token belongs to; `getShop` names it. Read at exchange and again at
 * every probe, because the answer can change under the institution's feet and
 * the owner has already renamed one shop while this was being built.
 */
async function whoseShop(accessToken: string, key: EtsyAppKey): Promise<{ shopId: string | null; shopName: string | null; url: string | null }> {
  const me = await call(`${API}/users/me`, { headers: auth(accessToken, key) });
  const shopId = me.shop_id == null ? null : String(me.shop_id);
  if (!shopId) return { shopId: null, shopName: null, url: null };
  const shop = await call(`${API}/shops/${encodeURIComponent(shopId)}`, { headers: auth(accessToken, key) });
  return {
    shopId,
    shopName: typeof shop.shop_name === 'string' ? shop.shop_name : null,
    url: typeof shop.url === 'string' ? shop.url : null,
  };
}

const adapter: SenseProviderAdapter = {
  provider: 'etsy',

  authorizeUrl({ scopes, state, redirectUri, codeChallenge, appCredential }) {
    const key = appKey(appCredential);
    if (!codeChallenge) {
      throw new SenseProviderError({
        ownerWords: 'I cannot start an Etsy connection without the proof Etsy requires',
        recoverable: false,
      });
    }
    const params = new URLSearchParams({
      // THE KEYSTRING ALONE, never the joined pair: `client_id` identifies the
      // application and `x-api-key` authenticates the request, and they are not
      // the same string. Storing the two halves apart is what makes that
      // distinction impossible to get wrong here.
      response_type: 'code', client_id: key.keystring, redirect_uri: redirectUri,
      // Exactly what the constitutional table declared. Nothing here widens it,
      // and every one of them is a read.
      scope: scopes.join(' '),
      state, code_challenge: codeChallenge, code_challenge_method: 'S256',
    });
    return `${AUTHORIZE}?${params.toString()}`;
  },

  async exchange({ code, redirectUri, codeVerifier, appCredential }) {
    const key = appKey(appCredential);
    if (!codeVerifier) {
      throw new SenseProviderError({
        ownerWords: 'that Etsy connection cannot be completed; please start it again',
        recoverable: true,
      });
    }
    // FORM-ENCODED, WHICH IS WHAT ETSY DOCUMENTS. This posted JSON. Etsy's own
    // example is `Content-Type: application/x-www-form-urlencoded`, and there is
    // no `client_secret` in it — PKCE stands in for one, which is why Etsy
    // requires PKCE on every authorization.
    const payload = await call(TOKEN, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', client_id: key.keystring,
        redirect_uri: redirectUri, code, code_verifier: codeVerifier,
      }).toString(),
    });
    const access = payload.access_token;
    if (typeof access !== 'string') {
      throw new SenseProviderError({
        ownerWords: 'Etsy answered, but not with an authorisation I can use',
        recoverable: false,
      });
    }
    // THE IDENTITY IS READ, NOT ASSUMED, and this is the whole reason the shop
    // rename is not a problem: what is recorded is what the account says it is
    // at the moment it is connected.
    const shop = await whoseShop(access, key);
    // Etsy access tokens last an hour; the refresh token lasts ninety days,
    // which is an operating limitation named in the maturity map rather than
    // buried here.
    const expires = typeof payload.expires_in === 'number' ? payload.expires_in : 3600;
    return {
      secret: {
        access_token: access,
        refresh_token: typeof payload.refresh_token === 'string' ? payload.refresh_token : null,
        shop_id: shop.shopId, shop_name: shop.shopName, shop_url: shop.url,
      },
      grantedScopes: scopesFrom(payload),
      expiresAt: new Date(Date.now() + expires * 1000),
    } satisfies GrantedCredential;
  },

  async refresh(secret, appCredential) {
    const key = appKey(appCredential);
    const refreshToken = secret.refresh_token;
    // NULL MEANS THERE IS NOTHING TO RENEW, a different fact from a renewal
    // that failed, and the caller must be able to tell them apart.
    if (typeof refreshToken !== 'string' || !refreshToken) return null;
    const payload = await call(TOKEN, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token', client_id: key.keystring, refresh_token: refreshToken,
      }).toString(),
    });
    const access = payload.access_token;
    if (typeof access !== 'string') {
      throw new SenseProviderError({
        ownerWords: 'Etsy would not renew the connection; it needs granting again',
        recoverable: false,
      });
    }
    const expires = typeof payload.expires_in === 'number' ? payload.expires_in : 3600;
    return {
      secret: {
        access_token: access,
        refresh_token: typeof payload.refresh_token === 'string' ? payload.refresh_token : refreshToken,
        shop_id: secret.shop_id ?? null, shop_name: secret.shop_name ?? null,
        shop_url: secret.shop_url ?? null,
      },
      grantedScopes: scopesFrom(payload),
      expiresAt: new Date(Date.now() + expires * 1000),
    } satisfies GrantedCredential;
  },

  async revoke() {
    // ETSY PUBLISHES NO REVOCATION ENDPOINT that this environment could read.
    // Throwing is the contract's way of saying the provider did not confirm,
    // so the caller records the revocation as local-only rather than pretending
    // the token is dead at Etsy. The owner is told to remove the app in his
    // Etsy account, which is the act that actually kills it.
    throw new SenseProviderError({
      ownerWords: 'I have forgotten the Etsy connection here. Etsy publishes no way '
        + 'for me to cancel it on their side, so remove this app under your Etsy '
        + 'account settings to be certain it is gone',
      recoverable: false,
    });
  },

  async probe(secret, appCredential) {
    const access = secret.access_token;
    if (typeof access !== 'string' || !access) return { ok: false, detail: 'no access token' };
    try {
      const shop = await whoseShop(access, appKey(appCredential));
      if (!shop.shopId) return { ok: true, detail: 'the account answers, and has no shop' };
      // A RENAME IS A FACT, NOT A FAILURE. The probe reports what the shop is
      // called now; whether that matches what was recorded is the caller's
      // question, and it is asked where the answer matters rather than here.
      return { ok: true, detail: `${shop.shopName ?? 'unnamed'} (${shop.shopId})${shop.url ? ` at ${shop.url}` : ''}` };
    } catch (err) {
      return { ok: false, detail: err instanceof SenseProviderError ? err.ownerWords : 'Etsy did not answer' };
    }
  },
};

/**
 * WHAT ETSY SAYS IT GRANTED, AND NOTHING ELSE.
 *
 * This used to answer the three read scopes when the token response carried no
 * `scope` field at all — "the read floor if it says nothing". That was a lie
 * told on the provider's behalf, and it defeated the one guard that exists to
 * catch a grant narrower than the one asked for: `credentials.ts` computes
 * `asked − granted` and raises whatever is missing, so substituting the asked
 * set for silence made that difference empty by construction and recorded a
 * credential as carrying permissions Etsy never confirmed.
 *
 * Silence is `[]`. That makes the guard fire and name the missing permission,
 * which is what the owner needs to hear, rather than discovering it at the
 * first request that comes back 403.
 */
function scopesFrom(payload: Record<string, unknown>): string[] {
  return typeof payload.scope === 'string' && payload.scope.trim()
    ? payload.scope.split(' ').filter(Boolean)
    : [];
}

registerSenseProvider(adapter);

export default adapter;
