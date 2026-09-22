// =============================================================================
// FOUNDRY — what a sense provider has to be able to do
//
// One contract, four operations, and every provider implements all of them —
// including the reference world. That is not symmetry for its own sake: the
// owner's instruction was to controlled-prove the COMPLETE credential lifecycle
// before a real key is asked for, and a lifecycle is only proven if something
// travels all of it. A reference provider that skipped authorization because it
// needs no secret would leave the exact steps that matter untested.
//
// WHAT IS DELIBERATELY NOT HERE.
//
//   No `read`. Fetching a company's numbers is the provider sync's job and it
//   already exists; this contract is about the KEY, and mixing the two is how
//   a credential layer ends up knowing what a subscription is.
//
//   No scope parameter that a caller chooses. `authorizeUrl` is handed the
//   scopes the constitutional table declares for this (provider, sense, mode)
//   and can be handed nothing else, because "minimum required scope" is only a
//   promise until something can refuse to ask for more.
//
//   No way to surface the secret. Nothing returns it to a route, and nothing
//   renders it. What the owner is shown is what the connection lets Foundry
//   UNDERSTAND, and what it still does not let it do.
// =============================================================================

/** What a provider handed back. The secret is opaque here and stays that way. */
export interface GrantedCredential {
  secret: Record<string, unknown>;
  grantedScopes: string[];
  /** When the access token dies, if it does. */
  expiresAt?: Date | null;
}

export interface ProviderFailure {
  /** What to tell the owner. Never a stack trace, never a raw provider body. */
  ownerWords: string;
  /** Whether trying again could work, or whether he has to reconnect. */
  recoverable: boolean;
}

export class SenseProviderError extends Error {
  readonly ownerWords: string;
  readonly recoverable: boolean;
  constructor(failure: ProviderFailure) {
    super(failure.ownerWords);
    this.name = 'SenseProviderError';
    this.ownerWords = failure.ownerWords;
    this.recoverable = failure.recoverable;
  }
}

export interface SenseProviderAdapter {
  provider: string;
  /**
   * WHETHER THIS DEPLOYMENT HAS TO HOLD AN APPLICATION KEY BEFORE ANYTHING CAN
   * BE ASKED. `senseProvider` returning an adapter used to be read as "this can
   * be authorised", and for Etsy that became untrue the moment the application
   * key moved out of the environment and into something the owner places by
   * hand: the adapter registers, so a button appeared, and the button threw.
   *
   * The comment on `senseProvider` below promises a surface that says what is
   * missing "rather than offering a button that would fail". This is the fact
   * that promise needs in order to stay true.
   */
  needsAppCredential?: boolean;
  /**
   * THE OTHER PLACE A KEY CAN BE MISSING FROM. Stripe's application identity is
   * a deployment fact in the environment rather than something the owner
   * places, and it had the identical defect: the adapter registers, so the
   * button appeared, and `clientId()` threw on the tap.
   *
   * Two questions rather than one, because the answers lead different places.
   * A key the owner can place is an obstacle he can clear where he is standing;
   * a key that belongs in the environment is genuinely not his to supply, and
   * telling him so is the honest thing rather than handing him a form for a
   * box that does not exist.
   */
  configured?: () => boolean;
  /**
   * Where to send the owner. The scopes come from the constitutional table and
   * the state is single-use; an adapter that added a scope of its own would be
   * asking for something nobody declared, which is why neither is derived here.
   */
  authorizeUrl(input: {
    scopes: string[]; state: string; redirectUri: string;
    /**
     * WHICH APPLICATION IS ASKING, handed in for the same reason the scopes
     * are: what a credential is, is decided outside the adapter. The Etsy
     * adapter used to reach into `process.env` for it, which made it the one
     * thing in this contract an adapter could choose for itself.
     *
     * Null when this deployment holds no key for the provider; the adapter
     * refuses and says so, rather than building a URL that would be rejected.
     */
    appCredential: Record<string, string> | null;
    /**
     * THE HALF OF THE PROOF THAT TRAVELS IN THE OPEN. The S256 hash of a
     * verifier only the caller holds. A provider that does not use PKCE
     * ignores it; one that requires it — Etsy requires it on every
     * authorization request — puts it in the URL and demands the other half
     * at the exchange.
     */
    codeChallenge: string | null;
  }): string;
  /** Turn the code he came back with into a credential. */
  exchange(input: {
    code: string; redirectUri: string;
    /** The other half, read back from the single-use authorization row. */
    codeVerifier: string | null;
    appCredential: Record<string, string> | null;
  }): Promise<GrantedCredential>;
  /**
   * Renew it. Null means this provider's credentials do not expire and there is
   * nothing to renew — which is a different fact from "renewal failed" and the
   * caller must be able to tell them apart.
   */
  refresh(secret: Record<string, unknown>, appCredential: Record<string, string> | null): Promise<GrantedCredential | null>;
  /**
   * Tell the provider to forget it. Throwing means the provider did not confirm,
   * and the caller records the revocation as local-only rather than pretending.
   */
  revoke(secret: Record<string, unknown>): Promise<void>;
  /** Is this credential still good? Used to notice a key that died quietly. */
  probe(secret: Record<string, unknown>, appCredential: Record<string, string> | null): Promise<{ ok: boolean; detail: string }>;
}

const adapters = new Map<string, SenseProviderAdapter>();
let loaded = false;

export function registerSenseProvider(adapter: SenseProviderAdapter): void {
  adapters.set(adapter.provider, adapter);
}

async function load(): Promise<void> {
  if (loaded) return;
  loaded = true;
  // Imported here rather than at module top so the contract has no dependency
  // on its implementations — a provider is added by writing one and adding a
  // line, and nothing that only needs the TYPES drags in an HTTP client.
  await import('./reference.js');
  await import('./stripe.js');
  await import('./etsy.js');
}

/**
 * The adapter for a provider, or null.
 *
 * Null is the honest answer for a provider Foundry has declared it could learn
 * from but cannot yet authorise against — and the surface says exactly that
 * rather than offering a button that would fail.
 */
export async function senseProvider(
  provider: string,
): Promise<SenseProviderAdapter | null> {
  await load();
  return adapters.get(provider) ?? null;
}

export async function registeredSenseProviders(): Promise<string[]> {
  await load();
  return [...adapters.keys()].sort();
}
