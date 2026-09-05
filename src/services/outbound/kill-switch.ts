// =============================================================================
// FOUNDRY — Tool Gateway Kill-Switch (V3.1 Layer C)
// Refuses outbound when the product is paused, the specific tool is disabled,
// or the calling agent is paused. Reads existing fields plus the new
// products.disabled_tools JSON column added in migration 068.
//
// TWO PAUSE AXES, BOTH LOAD-BEARING. `products.status` is the archive axis: the
// record is gone. `products.scp_status` is the acting axis: the company is not
// operating right now. Three separate places write `scp_status='paused'` — a
// cancelled Stripe subscription, a founder pausing from settings, and the
// hourly entitlement sweep that enforces "unpaid means read-only" — and until
// this file read it, none of them stopped a single outbound effect. The SCP
// scheduler honoured the pause, so no NEW agent work started; but every job
// that emails on its own timer (red daily, yellow pulse, DNA nudge, behavioural
// triggers) filtered on `status='active'` and sent anyway. The pause looked
// total from the code that wrote it and was not.
//
// It is checked HERE rather than at those call sites deliberately. This is the
// single door every outbound effect passes through, and the alternative —
// adding `AND scp_status='active'` to a dozen SELECTs — is the exact shape this
// codebase keeps finding broken: several implementations of one rule, drifting
// apart, with the weakest one live.
// =============================================================================

import { query } from '../../db/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KillSwitchResult {
  blocked: boolean;
  reason: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** SCP states in which the company is not acting outward.
 *
 * Named rather than inverted — `scp_status <> 'active'` would also catch
 * 'provisioning', and onboarding email is sent before a product is ever marked
 * active. Blocking signup in order to enforce billing is not the trade the
 * owner decision asked for. */
const NOT_ACTING = new Set(['paused', 'archived']);

/**
 * Check whether (product, tool, agent) is allowed to invoke. Blocks on:
 *   - product status != 'active' (the record is archived or deleted)
 *   - product scp_status in ('paused','archived') (the company is not acting)
 *   - tool listed in products.disabled_tools (per-tool kill)
 *   - agent_instances row for (product, agent) with status='paused'
 *
 * Agent check is skipped when agentName is omitted or 'system'.
 */
export async function checkKillSwitch(
  productId: string,
  tool: string,
  agentName?: string | null,
  /** Server-owned capability facts. Supplied by the gateway from the REGISTERED
   * policy for the tool — never from the request, which is why this parameter
   * has no route to a caller. */
  capability?: { deliverableWhilePaused?: boolean; paramsFingerprint?: string },
): Promise<KillSwitchResult> {
  const productResult = await query(
    `SELECT status, scp_status, entitlement_paused_at, erasure_scheduled_at, disabled_tools,
            reality, standing
       FROM products WHERE id = ?`,
    [productId]
  );
  const productRow = productResult.rows[0] as Record<string, unknown> | undefined;
  if (!productRow) {
    return { blocked: true, reason: `product ${productId} not found` };
  }
  // A COMPANY THAT IS NOT REAL MAY NOT REACH THE WORLD.
  //
  // This is the door every consequential effect passes through, which is why
  // the refusal belongs here rather than in each handler: a reference company
  // exists to exercise the institution, and the institution's job includes
  // sending email, charging cards and writing to repositories. The handlers use
  // the COMPANY's credential and fall back to the deployment's own — so a
  // rehearsal that reached `sendEmailHandler` would send a real message to a
  // real address from a real account, and the audit log would record it as
  // allowed because every other check passed.
  //
  // Refused FIRST, and before the exemptions below. Account mail is exempt from
  // the pause axes because a founder whose card was declined still needs to
  // hear it; nobody needs to hear anything about a company that does not exist.
  // 'deliverableWhilePaused' is about a real relationship in a paused state,
  // and there is no relationship here.
  if (productRow.reality === 'reference') {
    return {
      blocked: true,
      reason: 'company is a reference company and may not reach the world',
    };
  }
  // A TEST OBJECT HAS NO AUTHORITY OF ITS OWN. An experimental asset exists so
  // an approved test has something to be; the only external effect it may
  // ever produce is one its approved experiment carries, named in the act
  // and bounded by the allowance the approval wrote. Nothing at this door
  // carries an experiment yet — no hand does — so the door refuses, and says
  // what would pass. This is the shape the first hand will fill: an
  // act-scoped experiment reference supplied by the gateway, never by the
  // caller, checked here against `venture_experiments.decision = 'approved'`
  // on this asset. Refused ahead of the exemptions below for the same reason
  // a reference company is: none of them describe a relationship this object
  // has.
  if (productRow.standing === 'experimental') {
    return {
      blocked: true,
      reason: 'this is an experimental asset — it may reach the world only through an '
        + 'act its approved experiment carries, and this act names none',
    };
  }
  // WHAT THE OWNER SAID, BEFORE ANYTHING ELSE HE MIGHT HAVE CONFIGURED.
  //
  // A standing boundary is the owner speaking directly, and it outranks every
  // pause axis, tool list and agent state below — those are settings, and this
  // is an instruction. It is checked here for the reason everything else is:
  // this is the single door, and a boundary enforced at nine call sites is a
  // boundary that will be missing from the tenth.
  //
  // His own words come back with the refusal. A reason that said
  // 'boundary:contact_people' would be true and useless; what he needs to see,
  // months later, is the sentence he typed.
  const { boundaryStandingInTheWay } = await import('../institution/standing-intent.js');
  const said = await boundaryStandingInTheWay({
    productId, door: 'outbound', tool,
    // Server-computed by the gateway from the params it is about to use. A
    // caller has no route to this value, which is what makes an "ask me first"
    // approval bind to the act rather than to the kind of act.
    paramsFingerprint: capability?.paramsFingerprint,
  });
  if (said) {
    return { blocked: true, reason: `${said.refusal} — you said: "${said.statement}"` };
  }
  if (productRow.status && productRow.status !== 'active') {
    return {
      blocked: true,
      reason: `product status is '${productRow.status}'`,
    };
  }
  // A missing scp_status does not block. The column has been on products since
  // migration 017 with a default, so NULL means a row older than the SCP model
  // rather than a company anybody paused — and refusing outbound for those
  // would silence accounts nobody made a decision about.
  // TWO PAUSE REASONS, ONE ANSWER TO "MAY WE ACT", DIFFERENT ANSWERS TO "MAY WE
  // WRITE TO THE ACCOUNT". `scp_status` is the founder's or an operator's
  // decision to stop the company; `entitlement_paused_at` is the billing
  // sweep's. Both stop the institution acting. Neither stops account mail,
  // because account mail is about the pause — and a founder who paused their
  // own company still needs to hear that their card was declined.
  //
  // 'archived' is exempt from nothing: that record is gone and there is no
  // relationship left to write to.
  //
  // A THIRD AXIS: a scheduled erasure. For the thirty days of the grace window
  // this company kept mailing its customers on the way out. Unlike the other
  // two it exempts nothing — not even account mail. There is a difference
  // between telling a founder their card was declined, which they need, and
  // continuing to reach their customers on behalf of a company being deleted.
  const scpStatus = String(productRow.scp_status ?? '');
  const entitlementPaused = productRow.entitlement_paused_at != null;
  const erasureScheduled = productRow.erasure_scheduled_at != null;
  const pausedReason = NOT_ACTING.has(scpStatus) ? scpStatus
    : erasureScheduled ? 'scheduled for deletion'
    : entitlementPaused ? 'unentitled' : null;
  if (pausedReason) {
    const exempt = capability?.deliverableWhilePaused === true
      && pausedReason !== 'archived' && pausedReason !== 'scheduled for deletion';
    if (!exempt) {
      return {
        blocked: true,
        reason: `company is ${pausedReason} — Foundry is not acting for this product`,
      };
    }
  }
  if (isToolDisabledForRow(productRow.disabled_tools, tool)) {
    return {
      blocked: true,
      reason: `tool '${tool}' is disabled for this product`,
    };
  }

  if (agentName && agentName !== 'system') {
    const agentResult = await query(
      `SELECT status FROM agent_instances WHERE product_id = ? AND agent_name = ?`,
      [productId, agentName]
    );
    const agentRow = agentResult.rows[0] as Record<string, unknown> | undefined;
    if (agentRow && agentRow.status === 'paused') {
      return { blocked: true, reason: `agent '${agentName}' is paused` };
    }
  }

  return { blocked: false, reason: 'ok' };
}

/**
 * Disable a tool for a product. Idempotent — adds the tool to
 * products.disabled_tools if not already present.
 */
export async function disableTool(productId: string, tool: string): Promise<void> {
  const current = await loadDisabledTools(productId);
  if (current.includes(tool)) return;
  current.push(tool);
  await query(`UPDATE products SET disabled_tools = ? WHERE id = ?`, [
    JSON.stringify(current),
    productId,
  ]);
}

/**
 * Re-enable a tool for a product. Idempotent — removes the tool from
 * products.disabled_tools if present.
 */
export async function enableTool(productId: string, tool: string): Promise<void> {
  const current = await loadDisabledTools(productId);
  const next = current.filter((t) => t !== tool);
  if (next.length === current.length) return;
  await query(`UPDATE products SET disabled_tools = ? WHERE id = ?`, [
    JSON.stringify(next),
    productId,
  ]);
}

// ─── Internals ────────────────────────────────────────────────────────────────

async function loadDisabledTools(productId: string): Promise<string[]> {
  const result = await query(`SELECT disabled_tools FROM products WHERE id = ?`, [
    productId,
  ]);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return [];
  return parseToolList(row.disabled_tools);
}

function isToolDisabledForRow(raw: unknown, tool: string): boolean {
  return parseToolList(raw).includes(tool);
}

function parseToolList(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
