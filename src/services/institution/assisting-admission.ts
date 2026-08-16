// =============================================================================
// FOUNDRY — Founder-granted responsibility authority, and Assisting admission
//
// Reachability audit that produced this, verified rather than assumed:
//
//   • `recordConsent` (src/services/autopilot/consent.ts) already supports
//     responsibility-bound authority with exact scope, consequence boundary and
//     expiry — and had **no caller anywhere in src/**. The authority writer
//     existed; nothing could reach it.
//   • `enterResponsibilityAssisting` had one caller, inside the development
//     path, which is itself not driven in production.
//
// So the gap between Shadowing and Assisting was not missing architecture. It
// was two missing production writers. This is them.
//
// WHAT A GRANT IS, AND IS NOT:
//
//   consent != Assisting        — the grant makes admission possible; the
//                                 database still requires real shadow evidence.
//   Assisting != execution      — admission sends nothing.
//   plan != execution           — and a plan is a separate call again.
//
// The grant is deliberately narrow: one product, one responsibility, one
// capability, one explicit scope string, low consequence only, and an expiry.
// There is no generic "autopilot" permission here and no way to widen one.
// =============================================================================

import { query } from '../../db/client.js';
import { recordConsent } from '../autopilot/consent.js';
import { enterResponsibilityAssisting } from './responsibility-assisting.js';
import { getResponsibility, type Responsibility } from './responsibility.js';

/** Capabilities a founder may currently grant, with the exact effect each
 * permits. Closed on purpose: a capability appears here only when a bounded,
 * governed action exists for it. */
export const GRANTABLE_CAPABILITIES: Record<string, { scope: string; may: string; mayNot: string }> = {
  customer_support: {
    scope: 'send_email:support_reply',
    may: 'write and send one reply to a customer who is waiting on this',
    mayNot: 'contact anyone else, promise anything, change your systems, or spend money',
  },
};

export interface AssistingCandidate {
  responsibilityId: string;
  title: string;
  capability: string;
  /** Plain-language description of the exact permission being requested. */
  may: string;
  mayNot: string;
  /** Whether Foundry has actually watched this and has something to show. */
  comparisons: number;
  granted: boolean;
  grantExpiresAt: string | null;
}

/**
 * Responsibilities Foundry has genuinely watched and could now ask to help
 * with. A responsibility appears only when it is in Shadowing **and** at least
 * one real comparison exists — Foundry does not ask for permission on the
 * strength of having been told about something.
 */
export async function getAssistingCandidates(productId: string): Promise<AssistingCandidate[]> {
  const rows = await query(
    `SELECT r.id, r.title, r.capability,
            (SELECT COUNT(*) FROM responsibility_shadow_comparisons c
               JOIN responsibility_shadow_expectations x ON x.id=c.expectation_id
              WHERE x.responsibility_id=r.id AND c.classification IN ('matched','deviated')) AS comparisons,
            (SELECT a.expires_at FROM autonomy_consents a
              WHERE a.responsibility_id=r.id AND a.product_id=r.product_id AND a.capability=r.capability
                AND a.to_mode='act' AND a.revoked_at IS NULL AND datetime(a.expires_at)>datetime('now')
              ORDER BY a.accepted_at DESC LIMIT 1) AS grant_expires_at
       FROM institutional_responsibilities r
      WHERE r.product_id=? AND r.state IN ('shadowing','assisting') AND r.disposition='active'
      ORDER BY r.created_at, r.id`,
    [productId],
  );
  return (rows.rows as unknown as Array<Record<string, unknown>>)
    .filter((r) => Number(r.comparisons) > 0 && GRANTABLE_CAPABILITIES[String(r.capability)])
    .map((r) => {
      const capability = String(r.capability);
      return {
        responsibilityId: String(r.id), title: String(r.title), capability,
        may: GRANTABLE_CAPABILITIES[capability].may,
        mayNot: GRANTABLE_CAPABILITIES[capability].mayNot,
        comparisons: Number(r.comparisons),
        granted: r.grant_expires_at != null,
        grantExpiresAt: r.grant_expires_at == null ? null : String(r.grant_expires_at),
      };
    });
}

/**
 * The founder grants exact, bounded, revocable authority — and Foundry then
 * attempts admission.
 *
 * Admission is attempted, never assumed: the database re-checks that real
 * shadow evidence exists and that the grant is current, and a grant with no
 * evidence behind it simply sits unused rather than moving anything.
 */
export async function grantAssistingAuthority(input: {
  productId: string; responsibilityId: string; founderId: string; durationDays?: number;
}): Promise<{ consentId: string; responsibility: Responsibility | null; admitted: boolean } | null> {
  const owned = (await query(
    `SELECT r.capability, r.state FROM institutional_responsibilities r
       JOIN products p ON p.id=r.product_id
      WHERE r.id=? AND r.product_id=? AND p.owner_id=? AND r.disposition='active'`,
    [input.responsibilityId, input.productId, input.founderId],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!owned) return null;
  const capability = String(owned.capability);
  const grantable = GRANTABLE_CAPABILITIES[capability];
  if (!grantable) return null;

  // Permission is asked for only on something Foundry has actually watched.
  const comparison = (await query(
    `SELECT c.id FROM responsibility_shadow_comparisons c
       JOIN responsibility_shadow_expectations x ON x.id=c.expectation_id
      WHERE x.responsibility_id=? AND x.product_id=? AND c.classification IN ('matched','deviated')
      ORDER BY c.created_at DESC LIMIT 1`,
    [input.responsibilityId, input.productId],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!comparison) return null;

  const days = Math.min(Math.max(input.durationDays ?? 30, 1), 90);
  const consentId = await recordConsent({
    founderId: input.founderId, productId: input.productId, capability,
    fromMode: 'draft', toMode: 'act',
    responsibilityId: input.responsibilityId,
    allowedScope: [grantable.scope],
    consequenceBoundary: 'low',
    expiresAt: new Date(Date.now() + days * 86_400_000),
  });

  // Admission is a separate, database-verified step. A grant is permission to
  // be admitted, not the admission itself, and it sends nothing either way.
  let admitted = false;
  if (String(owned.state) === 'shadowing') {
    try {
      await enterResponsibilityAssisting({
        productId: input.productId, responsibilityId: input.responsibilityId,
        shadowComparisonId: String(comparison.id), authorityConsentId: consentId,
      });
      admitted = true;
    } catch {
      admitted = false; // the guard refused; the grant stands, unused
    }
  }
  return {
    consentId, admitted,
    responsibility: await getResponsibility(input.productId, input.responsibilityId),
  };
}

/**
 * The founder withdraws permission. Revocation is immediate and needs no
 * reason: the authority checks read `revoked_at IS NULL` at execution time, so
 * a revoked grant stops authorising the next action even mid-flight.
 *
 * The responsibility's own state is not rewound. What Foundry learned while
 * assisting remains true; what it may now do does not.
 */
export async function revokeAssistingAuthority(input: {
  productId: string; responsibilityId: string; founderId: string;
}): Promise<boolean> {
  const owned = await query(
    `SELECT 1 FROM institutional_responsibilities r JOIN products p ON p.id=r.product_id
      WHERE r.id=? AND r.product_id=? AND p.owner_id=?`,
    [input.responsibilityId, input.productId, input.founderId],
  );
  if (!owned.rows.length) return false;
  const result = await query(
    `UPDATE autonomy_consents SET revoked_at=datetime('now')
      WHERE product_id=? AND responsibility_id=? AND to_mode='act' AND revoked_at IS NULL`,
    [input.productId, input.responsibilityId],
  );
  return Number(result.rowsAffected ?? 0) > 0;
}
