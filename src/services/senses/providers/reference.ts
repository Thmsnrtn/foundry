// =============================================================================
// FOUNDRY — the reference world, as a provider that must be authorised
//
// It needs no secret. It is given one anyway, and made to travel every step of
// the credential lifecycle — authorize, exchange, refresh, expire, fail, probe,
// revoke — because the owner asked for that lifecycle to be CONTROLLED-PROVEN
// before a real key is requested, and a lifecycle is only proven if something
// walks all of it.
//
// A reference provider that skipped authorization "because it does not need
// one" would leave exactly the steps that matter untested: the ones where a
// replayed callback binds a second credential, where a refresh failure is
// mistaken for a provider outage, where a local delete is reported as a
// revocation the provider never confirmed.
//
// NO NETWORK, AND THAT IS THE POINT. The authorize URL is an internal route
// that plays the provider's part and redirects back with a code, so the full
// round trip — leaving, coming back, exchanging, storing — runs in a test with
// no key, no secret and nothing to reach.
// =============================================================================

import { createHash, randomBytes } from 'node:crypto';
import {
  SenseProviderError, registerSenseProvider,
  type GrantedCredential, type SenseProviderAdapter,
} from './contract.js';

/** Codes this loopback has issued and not yet spent. */
const issued = new Map<string, { scopes: string[]; at: number }>();

/**
 * A CODE ONLY THIS PROCESS COULD HAVE ISSUED.
 *
 * Derived rather than stored so the route that plays the provider does not need
 * shared state with the exchange — and unguessable, because a callback that
 * accepted any string would be a door anyone could knock on. Real providers
 * give this property by being the other end of a TLS connection; here it has to
 * be constructed.
 */
export function referenceCodeFor(state: string): string {
  return 'refcode_' + createHash('sha256')
    .update(`${state}\n${REFERENCE_ISSUER_SALT}`).digest('hex').slice(0, 40);
}

const REFERENCE_ISSUER_SALT = randomBytes(24).toString('hex');

/** Where the reference provider "lives". An internal route, not the internet. */
export const REFERENCE_AUTHORIZE_PATH = '/foundry/senses/reference-authorize';

const adapter: SenseProviderAdapter = {
  provider: 'reference_world',

  authorizeUrl({ scopes, state, redirectUri }) {
    const params = new URLSearchParams({
      state, redirect_uri: redirectUri, scope: scopes.join(' '),
    });
    return `${REFERENCE_AUTHORIZE_PATH}?${params.toString()}`;
  },

  exchange({ code }) {
    // THE CODE MUST BE ONE THIS PROVIDER ISSUED. Without this the callback
    // would accept anything shaped like a code, which is the same hole a real
    // provider closes by being the only party that could have minted it.
    if (!code.startsWith('refcode_')) {
      throw new SenseProviderError({
        ownerWords: 'the reference world did not recognise that authorisation',
        recoverable: true,
      });
    }
    const known = issued.get(code);
    if (!known) {
      throw new SenseProviderError({
        ownerWords: 'that authorisation was already used, or it expired',
        recoverable: true,
      });
    }
    issued.delete(code);
    return Promise.resolve({
      secret: { token: 'reference-token-' + randomBytes(8).toString('hex') },
      grantedScopes: known.scopes,
      // Deliberately short, so expiry and refresh are exercised rather than
      // assumed. A provider whose tokens never expire proves nothing about the
      // code that renews them.
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    } satisfies GrantedCredential);
  },

  refresh(secret) {
    if (typeof secret.token !== 'string') {
      throw new SenseProviderError({
        ownerWords: 'the stored authorisation is not one I can renew',
        recoverable: false,
      });
    }
    // A REFUSAL THAT CAN BE ASKED FOR. Set by a test to prove that a failed
    // renewal makes the sense go blind rather than silently serving old data.
    if (secret.token === 'reference-token-refuse-refresh') {
      throw new SenseProviderError({
        ownerWords: 'the reference world refused to renew the authorisation',
        recoverable: false,
      });
    }
    return Promise.resolve({
      secret: { token: 'reference-token-' + randomBytes(8).toString('hex') },
      grantedScopes: ['reference:read'],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    } satisfies GrantedCredential);
  },

  revoke(secret) {
    if (secret.token === 'reference-token-refuse-revoke') {
      throw new SenseProviderError({
        ownerWords: 'the reference world could not confirm the disconnection',
        recoverable: true,
      });
    }
    return Promise.resolve();
  },

  probe(secret) {
    return Promise.resolve(typeof secret.token === 'string'
      && secret.token !== 'reference-token-dead'
      ? { ok: true, detail: 'the reference world answered' }
      : { ok: false, detail: 'the reference world did not accept it' });
  },
};

/** Called by the route that plays the provider's part. */
export function issueReferenceCode(state: string, scopes: string[]): string {
  const code = referenceCodeFor(state);
  issued.set(code, { scopes, at: Date.now() });
  return code;
}

registerSenseProvider(adapter);
export default adapter;
