// =============================================================================
// FOUNDRY — Who is acting, and by what means
//
// AUTHENTICATION TRANSPORT IS NOT A PRINCIPAL, AND A PRINCIPAL IS NOT AN
// AUTHORITY.
//
// Both role guards used to read `c.get('userId')` and `c.get('productId')` —
// two untyped strings that any middleware could set and any guard could
// interpret. That produced two defects at once:
//
//   1. Nothing on the dashboard set them, so `requireRole('owner')` returned
//      401 to the founder who owned the company. Twelve routes unreachable.
//
//   2. On the API surface they WERE set, and `userId` there is `api_keys
//      .created_by` — the founder who minted the key. So a scoped, revocable,
//      expiring machine credential satisfied a HUMAN owner check. The key was
//      issued to call `/v1/metrics`; it could pause the company.
//
// The second is the one this file exists for. A credential and a person are
// different principals even when the same row names them both, and a guard
// that asks "is this the owner?" must be able to tell which it is looking at.
//
// Deliberately small (§19): four kinds, one discriminant, no shared context
// object. Each authenticator declares what it authenticated; guards match on
// the kind they mean. Nothing derives a principal by guessing from loose keys.
// =============================================================================

/** An authenticated human, in a browser session. Carries a founder identity and
 * whatever company they have selected — but NOT scopes: a person's authority
 * comes from their role on the company, not from a credential's grant list. */
export interface HumanSessionPrincipal {
  kind: 'human_session';
  founderId: string;
  productId?: string;
}

/** A public API credential. Carries the company it was issued for and the
 * scopes it was granted. `keyOwnerId` records who minted it, for attribution
 * and revocation — it is NOT the acting human, and must never be read as one. */
export interface ApiKeyPrincipal {
  kind: 'api_key';
  keyOwnerId: string;
  productId: string;
  scopes: string[];
}

/** An intake credential. One company, one server-owned purpose, no human role. */
export interface IngestPrincipal {
  kind: 'ingest';
  credentialId: string;
  productId: string;
  purpose: string;
}

/** Foundry's own machinery acting for a company: a job, a scheduler, an agent.
 * Named explicitly so "no principal at all" and "the platform itself" stop
 * being the same absence. */
export interface ServicePrincipal {
  kind: 'service';
  service: string;
  capability: string;
  productId?: string;
}

export type Principal =
  | HumanSessionPrincipal
  | ApiKeyPrincipal
  | IngestPrincipal
  | ServicePrincipal;

export const PRINCIPAL_KEY = 'principal' as const;

/**
 * The principal on this request, or null.
 *
 * AMBIGUITY FAILS CLOSED. A request carrying both a session cookie and an API
 * key has two candidate principals, and picking the stronger is how privilege
 * escalation by header stuffing works. Two principals is not a principal.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function principalOf(c: any): Principal | null {
  const declared = c.get(PRINCIPAL_KEY) as Principal | undefined;
  if (declared) return declared;

  // Nothing declared: derive from what the older middlewares set, and refuse
  // when more than one of them spoke. This branch exists so a surface that has
  // not been migrated yet is refused rather than guessed at.
  const founder = c.get('founder') as { id?: string } | undefined;
  const apiUserId = c.get('userId') as string | undefined;
  const apiProductId = c.get('productId') as string | undefined;
  const looksHuman = Boolean(founder?.id);
  const looksApi = Boolean(apiUserId && apiProductId);
  if (looksHuman && looksApi) return null;
  if (looksHuman) return { kind: 'human_session', founderId: founder!.id! };
  if (looksApi) {
    return {
      kind: 'api_key',
      keyOwnerId: apiUserId!,
      productId: apiProductId!,
      scopes: (c.get('scopes') as string[] | undefined) ?? [],
    };
  }
  return null;
}

/** The company a principal is acting on, when it carries one itself. */
export function principalProductId(p: Principal): string | undefined {
  return p.kind === 'human_session' ? p.productId : p.kind === 'service' ? p.productId : p.productId;
}
