// =============================================================================
// FOUNDRY — Stripe, as a sense
//
// REAL, AND NOT YET USED. This is the adapter a real key would travel through,
// written now so that the day the owner connects one is a day nothing new is
// discovered about how the system should work. It asks for `read_only` and can
// ask for nothing else: the scopes come from the constitutional table
// (migration 231), which is why "minimum required scope" is a property of the
// system rather than a promise in a document.
//
// TEST MODE IS THE SAME ADAPTER. Stripe's test mode is real HTTP, real token
// exchange, real refresh semantics and real failures against money that does
// not exist — so `sandbox` uses this code unchanged and only the provenance
// differs (migration 227). That is what makes replacing a controlled source
// with a real one a row rather than a rebuild.
//
// WHAT IT REFUSES TO DO. Nothing here writes: no charge, no refund, no price,
// no subscription change. That is enforced twice over and neither is this file
// being careful — the scope requested is read-only, and the outbound door
// refuses money regardless of what any credential would permit.
//
// CONFIGURATION IS A DEPLOYMENT FACT. Without `STRIPE_CONNECT_CLIENT_ID` this
// adapter refuses to build an authorize URL and says so in words the owner can
// act on, rather than sending him to a provider page that will reject him.
// =============================================================================

import {
  SenseProviderError, registerSenseProvider,
  type GrantedCredential, type SenseProviderAdapter,
} from './contract.js';

const AUTHORIZE = 'https://connect.stripe.com/oauth/authorize';
const TOKEN = 'https://connect.stripe.com/oauth/token';
const DEAUTHORIZE = 'https://connect.stripe.com/oauth/deauthorize';

function clientId(): string {
  const id = (process.env.STRIPE_CONNECT_CLIENT_ID ?? '').trim();
  if (!id) {
    throw new SenseProviderError({
      ownerWords: 'this deployment has no Stripe connection configured, so I '
        + 'cannot ask Stripe for anything yet',
      recoverable: false,
    });
  }
  return id;
}

function secretKey(): string {
  const key = (process.env.STRIPE_SECRET_KEY ?? '').trim();
  if (!key) {
    throw new SenseProviderError({
      ownerWords: 'this deployment has no Stripe credentials configured',
      recoverable: false,
    });
  }
  return key;
}

/** Provider replies are never shown raw: a body can carry anything. */
async function post(url: string, body: URLSearchParams): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Bearer ${secretKey()}`,
      },
      body,
    });
  } catch {
    throw new SenseProviderError({
      ownerWords: 'I could not reach Stripe', recoverable: true,
    });
  }
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    // The provider's own message, bounded and stripped of anything structural.
    const detail = typeof (payload.error_description ?? payload.error) === 'string'
      ? String(payload.error_description ?? payload.error).slice(0, 200)
      : `it answered ${String(response.status)}`;
    throw new SenseProviderError({
      ownerWords: `Stripe refused: ${detail}`,
      recoverable: response.status >= 500 || response.status === 429,
    });
  }
  return payload;
}

const adapter: SenseProviderAdapter = {
  provider: 'stripe',

  authorizeUrl({ scopes, state, redirectUri }) {
    const params = new URLSearchParams({
      response_type: 'code', client_id: clientId(), state,
      redirect_uri: redirectUri,
      // Exactly what the constitutional table declared, and Stripe's own name
      // for it. Nothing here can widen it.
      scope: scopes.join(' '),
    });
    return `${AUTHORIZE}?${params.toString()}`;
  },

  async exchange({ code }) {
    const payload = await post(TOKEN, new URLSearchParams({
      grant_type: 'authorization_code', code,
    }));
    const account = payload.stripe_user_id;
    const access = payload.access_token;
    if (typeof account !== 'string' || typeof access !== 'string') {
      throw new SenseProviderError({
        ownerWords: 'Stripe answered, but not with an authorisation I can use',
        recoverable: false,
      });
    }
    return {
      secret: {
        access_token: access, stripe_account_id: account,
        refresh_token: typeof payload.refresh_token === 'string'
          ? payload.refresh_token : null,
      },
      grantedScopes: typeof payload.scope === 'string'
        ? payload.scope.split(' ').filter(Boolean) : ['read_only'],
      // Stripe Connect access tokens do not expire on a clock. Saying so
      // explicitly is not the same as saying renewal failed, and the caller
      // must be able to tell those apart.
      expiresAt: null,
    } satisfies GrantedCredential;
  },

  async refresh(secret) {
    const refreshToken = secret.refresh_token;
    // NULL MEANS THERE IS NOTHING TO RENEW, which is a different fact from a
    // renewal that failed — and conflating them would make a perfectly healthy
    // connection look broken every time the renewal job ran.
    if (typeof refreshToken !== 'string' || !refreshToken) return null;
    const payload = await post(TOKEN, new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: refreshToken,
    }));
    const access = payload.access_token;
    if (typeof access !== 'string') {
      throw new SenseProviderError({
        ownerWords: 'Stripe would not renew the authorisation', recoverable: false,
      });
    }
    return {
      secret: { ...secret, access_token: access },
      grantedScopes: typeof payload.scope === 'string'
        ? payload.scope.split(' ').filter(Boolean) : ['read_only'],
      expiresAt: null,
    } satisfies GrantedCredential;
  },

  async revoke(secret) {
    const account = secret.stripe_account_id;
    if (typeof account !== 'string') {
      throw new SenseProviderError({
        ownerWords: 'I do not know which Stripe account to disconnect',
        recoverable: false,
      });
    }
    await post(DEAUTHORIZE, new URLSearchParams({
      client_id: clientId(), stripe_user_id: account,
    }));
  },

  async probe(secret) {
    const account = secret.stripe_account_id;
    if (typeof account !== 'string') {
      return { ok: false, detail: 'the stored authorisation names no account' };
    }
    try {
      const response = await fetch('https://api.stripe.com/v1/balance', {
        headers: {
          authorization: `Bearer ${secretKey()}`,
          'stripe-account': account,
        },
      });
      return response.ok
        ? { ok: true, detail: 'Stripe answered' }
        : { ok: false, detail: `Stripe answered ${String(response.status)}` };
    } catch {
      return { ok: false, detail: 'I could not reach Stripe' };
    }
  },
};

registerSenseProvider(adapter);
export default adapter;
