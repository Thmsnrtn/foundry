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
   * Where to send the owner. The scopes come from the constitutional table and
   * the state is single-use; an adapter that added a scope of its own would be
   * asking for something nobody declared, which is why neither is derived here.
   */
  authorizeUrl(input: { scopes: string[]; state: string; redirectUri: string }): string;
  /** Turn the code he came back with into a credential. */
  exchange(input: { code: string; redirectUri: string }): Promise<GrantedCredential>;
  /**
   * Renew it. Null means this provider's credentials do not expire and there is
   * nothing to renew — which is a different fact from "renewal failed" and the
   * caller must be able to tell them apart.
   */
  refresh(secret: Record<string, unknown>): Promise<GrantedCredential | null>;
  /**
   * Tell the provider to forget it. Throwing means the provider did not confirm,
   * and the caller records the revocation as local-only rather than pretending.
   */
  revoke(secret: Record<string, unknown>): Promise<void>;
  /** Is this credential still good? Used to notice a key that died quietly. */
  probe(secret: Record<string, unknown>): Promise<{ ok: boolean; detail: string }>;
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
