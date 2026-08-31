// =============================================================================
// FOUNDRY — Autonomy Consent Ledger (Protective Wrapper primitive 2)
//
// Granting a capability to 'act' requires a recorded acknowledgment. The
// disclosure text is versioned; the acceptance binds a specific founder to a
// specific capability at a specific time under a specific disclosure. This is
// the enforceability the liability audit flagged as missing, scoped to the
// highest-risk moment (autonomy grant) rather than a blanket clickwrap.
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';

// Bump the version whenever the wording changes; old acceptances stay on record
// under the version they saw. Verbatim from LIABILITY-AUDIT.md / pax-jarvis.md.
export const DISCLOSURE_VERSION = '2026-07-14.1';
export const DISCLOSURE_TEXT =
  'By granting this, you authorize Foundry to act on your instructions using ' +
  'services you have connected. You remain responsible for your business and ' +
  'its actions. Foundry is software, not an adviser — this is not investment, ' +
  'legal, or tax advice. You can revoke this anytime; every action is logged ' +
  'and reversible where possible.';

/** Record the founder's acceptance of the autonomy disclosure. Call this at the
 *  moment a capability is raised to 'act'. Returns the consent id. */
export async function recordConsent(opts: {
  founderId: string; productId: string; capability: string;
  fromMode: string; toMode: string;
  responsibilityId?: string; allowedScope?: string[]; consequenceBoundary?: 'low'|'medium'|'high'; expiresAt?: Date;
}): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO autonomy_consents
       (id, founder_id, product_id, capability, from_mode, to_mode, disclosure_version,
        responsibility_id,allowed_scope_json,consequence_boundary,expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, opts.founderId, opts.productId, opts.capability, opts.fromMode, opts.toMode, DISCLOSURE_VERSION,
      opts.responsibilityId??null,opts.allowedScope?JSON.stringify(opts.allowedScope):null,
      opts.consequenceBoundary??null,opts.expiresAt?.toISOString()??null],
  );
  return id;
}

export async function activeResponsibilityAuthority(productId:string,responsibilityId:string,capability:string,scope:string):Promise<{id:string}|null> {
  const result=await query(`SELECT id FROM autonomy_consents WHERE product_id=? AND responsibility_id=? AND capability=?
    AND to_mode='act' AND revoked_at IS NULL AND datetime(expires_at)>datetime('now')
    AND EXISTS (SELECT 1 FROM json_each(allowed_scope_json) WHERE value=?)
    ORDER BY accepted_at DESC LIMIT 1`,[productId,responsibilityId,capability,scope]);
  const row=result.rows[0] as Record<string,unknown>|undefined;
  return row?{id:String(row.id)}:null;
}

/** The live consent licensing 'act' for a capability, if any (unrevoked). */
export async function activeConsent(productId: string, capability: string): Promise<{ id: string; disclosure_version: string } | null> {
  const r = await query(
    `SELECT id, disclosure_version FROM autonomy_consents
      WHERE product_id = ? AND capability = ? AND to_mode = 'act' AND revoked_at IS NULL
        -- An expiry that only one reader honours is not an expiry.
        -- activeResponsibilityAuthority has always checked this; the gate the
        -- autopilot actually calls did not, so a time-boxed grant kept
        -- licensing autonomous action after the hour it was given for.
        --
        -- NULL means "until revoked", and in SQLite datetime(NULL) compared to
        -- anything is NULL rather than false — so the IS NULL branch is what
        -- keeps every standing grant alive. Without it this fix would have
        -- disarmed the product instead of tightening it.
        AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
      ORDER BY accepted_at DESC LIMIT 1`,
    [productId, capability],
  );
  const row = r.rows[0] as Record<string, string> | undefined;
  return row ? { id: row.id, disclosure_version: row.disclosure_version } : null;
}

/** True iff there is a live recorded consent for acting in this capability.
 *  The gate: no autonomous 'act' without this. */
export async function hasActConsent(productId: string, capability: string): Promise<boolean> {
  return (await activeConsent(productId, capability)) != null;
}

/** Revoke consent when a capability drops below 'act' (pause / demotion). */
export async function revokeConsent(productId: string, capability: string): Promise<void> {
  await query(
    `UPDATE autonomy_consents SET revoked_at = CURRENT_TIMESTAMP
      WHERE product_id = ? AND capability = ? AND revoked_at IS NULL`,
    [productId, capability],
  );
}
